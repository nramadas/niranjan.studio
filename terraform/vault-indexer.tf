# ─── Vault indexer (Phase 3) ────────────────────────────────────────────────
#
# The vault-indexer is an always-on container that runs ON THE PHASE 1
# e2-micro VM, next to the CouchDB container, in the same docker-compose
# stack. It owns the sqlite-vec vector store (a file on the VM's disk),
# subscribes to the CouchDB _changes feed, embeds note chunks in-process
# via bge-small-en-v1.5, and exposes a private /search endpoint that the
# Cloud Run MCP server calls through a Cloudflare Access-gated tunnel
# hostname.
#
# Because the indexer runs on the existing VM, this file contains NO
# `google_compute_instance` resource. What Terraform manages here is:
#   - Secrets (search bearer token, OpenAI key placeholder, Cloudflare
#     Access service-token credentials).
#   - IAM bindings against those secrets for the VM SA and the MCP SA.
#   - A new Artifact Registry repo for the indexer image.
#   - The Cloudflare DNS record, Access application, service token,
#     and policy for `indexer.<domain>`.
#
# Cloudflared ingress on the VM still gets configured manually via
# scripts/vault-indexer/add-tunnel-route.sh — matching Phase 1's pattern
# where setup-tunnel.sh runs on the VM. The two routes (vault, indexer)
# share a tunnel config.yml maintained on the VM, not in Terraform.

# ─── Search bearer token ────────────────────────────────────────────────────
#
# Shared secret between the MCP server and the indexer, used as a
# second defence-in-depth layer behind the Cloudflare Access gate. The
# indexer enforces it via `validateBearer`; the MCP sends it as
# `Authorization: Bearer <token>`. `special = false` because the token
# may be interpolated into env files and curl URLs.

resource "random_password" "vault_indexer_search_token" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "vault_indexer_search_token" {
  secret_id = "vault-indexer-search-token"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secret_manager]
}

resource "google_secret_manager_secret_version" "vault_indexer_search_token" {
  secret      = google_secret_manager_secret.vault_indexer_search_token.id
  secret_data = random_password.vault_indexer_search_token.result
}

# Two readers: the VM (which exports it into the indexer container's env)
# and the Cloud Run MCP service (which sends it as the Bearer header).
resource "google_secret_manager_secret_iam_member" "vault_indexer_search_token_vm" {
  secret_id = google_secret_manager_secret.vault_indexer_search_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.obsidian_vm.email}"
}

resource "google_secret_manager_secret_iam_member" "vault_indexer_search_token_mcp" {
  secret_id = google_secret_manager_secret.vault_indexer_search_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.obsidian_mcp.email}"
}

# ─── OpenAI API key (optional, evaluation harness) ──────────────────────────
#
# Only consumed when the indexer is started with EMBEDDER=openai-small or
# EMBEDDER=openai-large — typically the evaluation harness rather than
# the production runtime. Created as a placeholder secret; populated
# out of band when the user actually wants to run a comparison. Same
# `lifecycle.ignore_changes` pattern as the LiveSync passphrase.

resource "google_secret_manager_secret" "vault_indexer_openai_key" {
  secret_id = "vault-indexer-openai-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secret_manager]
}

resource "google_secret_manager_secret_version" "vault_indexer_openai_key_placeholder" {
  secret      = google_secret_manager_secret.vault_indexer_openai_key.id
  secret_data = "REPLACE_ME_WITH_OPENAI_API_KEY_OR_LEAVE_EMPTY"

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "vault_indexer_openai_key_vm" {
  secret_id = google_secret_manager_secret.vault_indexer_openai_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.obsidian_vm.email}"
}

# ─── VM SA reads on MCP-owned secrets ───────────────────────────────────────
#
# The indexer container runs on the Phase 1 VM and connects to CouchDB as
# the scoped `obsidian-mcp` user (not the admin), and decrypts LiveSync
# E2EE content with the same passphrase the MCP uses. Both secrets are
# defined in obsidian-mcp.tf with grants only to the MCP SA — the indexer
# was added later and needs the VM SA to read them too so deploy.sh can
# pull them down into /opt/vault-indexer/.env.

resource "google_secret_manager_secret_iam_member" "obsidian_mcp_couchdb_password_vm" {
  secret_id = google_secret_manager_secret.obsidian_mcp_couchdb_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.obsidian_vm.email}"
}

resource "google_secret_manager_secret_iam_member" "obsidian_livesync_passphrase_vm" {
  secret_id = google_secret_manager_secret.obsidian_livesync_passphrase.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.obsidian_vm.email}"
}

# ─── Artifact Registry repo for indexer images ──────────────────────────────
#
# Separate from the Phase 2 `obsidian-mcp` repo. Two repos means image
# tags like `server:abc123` and `indexer:abc123` never collide, and the
# VM's SA can be granted read access to the indexer repo only (not the
# whole project).

resource "google_artifact_registry_repository" "vault_indexer" {
  location      = var.gcp_region
  repository_id = "vault-indexer"
  description   = "Container images for the vault-indexer service running on the Phase 1 VM."
  format        = "DOCKER"

  depends_on = [google_project_service.artifact_registry]
}

resource "google_artifact_registry_repository_iam_member" "vault_indexer_vm_reader" {
  location   = google_artifact_registry_repository.vault_indexer.location
  repository = google_artifact_registry_repository.vault_indexer.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.obsidian_vm.email}"
}

# ─── Cloudflare: DNS, Access, service token, policy ─────────────────────────
#
# The MCP server reaches the indexer at https://indexer.<domain>. The
# DNS record routes through the existing tunnel (same UUID as the vault
# subdomain). Cloudflare Access enforces that only a request carrying
# our service token's CF-Access-Client-Id/Secret pair gets through to
# the cloudflared origin; behind that, the indexer also checks the
# bearer token. Both must succeed.

resource "cloudflare_record" "indexer" {
  count = var.cloudflare_tunnel_id == "" ? 0 : 1

  zone_id = data.cloudflare_zone.main.id
  name    = var.indexer_subdomain
  content = "${var.cloudflare_tunnel_id}.cfargotunnel.com"
  type    = "CNAME"
  proxied = true
  ttl     = 1
  comment = "Cloudflare Tunnel target for the on-VM vault-indexer /search endpoint"
}

# Access application — protects the hostname at the edge. Type
# `self_hosted` is the right shape for a non-SaaS app behind cloudflared.
#
# We deliberately do NOT add a human-identity policy: the only caller
# is the Cloud Run MCP service account. A human visiting indexer.<domain>
# in a browser hits the policy and is rejected — that's the desired
# outcome (it's not a UI).
resource "cloudflare_access_application" "indexer" {
  zone_id          = data.cloudflare_zone.main.id
  name             = "vault-indexer"
  domain           = "${var.indexer_subdomain}.${var.domain}"
  type             = "self_hosted"
  session_duration = "24h"
}

resource "cloudflare_access_service_token" "mcp_to_indexer" {
  zone_id = data.cloudflare_zone.main.id
  name    = "obsidian-mcp-to-vault-indexer"
}

resource "cloudflare_access_policy" "indexer_allow_service_token" {
  application_id = cloudflare_access_application.indexer.id
  zone_id        = data.cloudflare_zone.main.id
  name           = "Allow MCP service token"
  precedence     = 1
  decision       = "non_identity"

  include {
    service_token = [cloudflare_access_service_token.mcp_to_indexer.id]
  }
}

# ─── Persist the service-token credentials to Secret Manager ────────────────
#
# Cloudflare exports `client_secret` ONLY at create-time. We write both
# halves into Secret Manager so the Cloud Run MCP service can mount them
# at request time, and so they survive `terraform plan/apply` cycles
# without re-rolling the token.

resource "google_secret_manager_secret" "vault_indexer_cf_access_client_id" {
  secret_id = "vault-indexer-cf-access-client-id"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secret_manager]
}

resource "google_secret_manager_secret_version" "vault_indexer_cf_access_client_id" {
  secret      = google_secret_manager_secret.vault_indexer_cf_access_client_id.id
  secret_data = cloudflare_access_service_token.mcp_to_indexer.client_id
}

resource "google_secret_manager_secret" "vault_indexer_cf_access_client_secret" {
  secret_id = "vault-indexer-cf-access-client-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secret_manager]
}

resource "google_secret_manager_secret_version" "vault_indexer_cf_access_client_secret" {
  secret      = google_secret_manager_secret.vault_indexer_cf_access_client_secret.id
  secret_data = cloudflare_access_service_token.mcp_to_indexer.client_secret
}

resource "google_secret_manager_secret_iam_member" "vault_indexer_cf_access_client_id_mcp" {
  secret_id = google_secret_manager_secret.vault_indexer_cf_access_client_id.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.obsidian_mcp.email}"
}

resource "google_secret_manager_secret_iam_member" "vault_indexer_cf_access_client_secret_mcp" {
  secret_id = google_secret_manager_secret.vault_indexer_cf_access_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.obsidian_mcp.email}"
}
