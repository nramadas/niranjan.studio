# ─── Obsidian MCP server (Phase 2) ──────────────────────────────────────────
#
# A Cloud Run service that exposes the Phase 1 CouchDB vault to Claude over
# the Model Context Protocol (MCP). Connection path:
#
#   Claude (web / iOS / iPad)
#     ──HTTPS──▶  mcp.<domain>      (Cloud Run domain mapping; Google-managed cert)
#                   │
#                   ▼
#                 Cloud Run service (this file)
#                   │
#                   ├──▶ /authorize redirects to accounts.google.com (OIDC)
#                   ├──▶ /oauth/google/callback exchanges + issues our JWTs
#                   ├──▶ /token issues access + refresh tokens
#                   └──▶ /mcp validates our access token, runs the MCP tools
#                          │
#                          ▼
#                        Phase 1 CouchDB at https://vault.<domain>
#
# The server reads/writes documents in the same database as the LiveSync
# clients. It holds the LiveSync E2EE passphrase (in Secret Manager) so it
# can encrypt and decrypt notes the same way LiveSync does. The OAuth
# bearer token is the only auth gate — Cloudflare is no longer in the MCP
# request path. The CouchDB tunnel (vault.<domain>) keeps using Cloudflare
# exactly as in Phase 1.

# ─── Service account ────────────────────────────────────────────────────────
#
# Dedicated SA for the Cloud Run service. Four secret-scoped grants below
# are the only IAM it gets. No project-wide roles.

resource "google_service_account" "obsidian_mcp" {
  account_id   = "obsidian-mcp"
  display_name = "Obsidian MCP server"
  description  = "Service account for the Cloud Run MCP server. Reads four Secret Manager secrets only."
}

# ─── Artifact Registry repo for the server image ────────────────────────────

resource "google_project_service" "artifact_registry" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "cloud_run" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "obsidian_mcp" {
  location      = var.gcp_region
  repository_id = "obsidian-mcp"
  description   = "Container images for the Obsidian MCP Cloud Run service."
  format        = "DOCKER"

  depends_on = [google_project_service.artifact_registry]
}

# ─── CouchDB user dedicated to the MCP server ───────────────────────────────
#
# The Phase 1 CouchDB admin password is reused only as a bootstrap credential
# to provision a scoped user (see scripts/obsidian-mcp/create-couchdb-user.sh).
# The MCP server itself only ever sees this scoped user's credentials.

resource "random_password" "obsidian_mcp_couchdb_password" {
  length  = 32
  special = false
}

resource "google_secret_manager_secret" "obsidian_mcp_couchdb_password" {
  secret_id = "obsidian-mcp-couchdb-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secret_manager]
}

resource "google_secret_manager_secret_version" "obsidian_mcp_couchdb_password" {
  secret      = google_secret_manager_secret.obsidian_mcp_couchdb_password.id
  secret_data = random_password.obsidian_mcp_couchdb_password.result
}

resource "google_secret_manager_secret_iam_member" "obsidian_mcp_couchdb_password_accessor" {
  secret_id = google_secret_manager_secret.obsidian_mcp_couchdb_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.obsidian_mcp.email}"
}

# ─── LiveSync E2EE passphrase ───────────────────────────────────────────────
#
# Same setup as before — Terraform creates the secret resource, the value
# is populated out of band from the Obsidian client.

resource "google_secret_manager_secret" "obsidian_livesync_passphrase" {
  secret_id = "obsidian-livesync-passphrase"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secret_manager]
}

resource "google_secret_manager_secret_version" "obsidian_livesync_passphrase_placeholder" {
  secret      = google_secret_manager_secret.obsidian_livesync_passphrase.id
  secret_data = "REPLACE_ME_WITH_THE_LIVESYNC_PASSPHRASE_FROM_YOUR_CLIENT"

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "obsidian_livesync_passphrase_accessor" {
  secret_id = google_secret_manager_secret.obsidian_livesync_passphrase.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.obsidian_mcp.email}"
}

# ─── OAuth signing key ──────────────────────────────────────────────────────
#
# The RSA-2048 PKCS#8 PEM the server uses to sign every JWT it mints
# (authorization codes, access tokens, refresh tokens, the Google
# round-trip state). Generated out of band by
# scripts/obsidian-mcp/generate-oauth-key.sh — Terraform can't generate
# RSA keys natively in a way that survives reapplies without storing them
# in state, and we'd rather keep the private key out of state.
#
# Rotating the signing key invalidates every issued token (no revocation
# list — the kid changes, validation fails). That's the recovery path on
# any token compromise.

resource "google_secret_manager_secret" "obsidian_mcp_oauth_signing_key" {
  secret_id = "obsidian-mcp-oauth-signing-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secret_manager]
}

resource "google_secret_manager_secret_version" "obsidian_mcp_oauth_signing_key_placeholder" {
  secret      = google_secret_manager_secret.obsidian_mcp_oauth_signing_key.id
  secret_data = "REPLACE_ME_WITH_RSA_2048_PKCS8_PEM_FROM_GENERATE_OAUTH_KEY_SH"

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "obsidian_mcp_oauth_signing_key_accessor" {
  secret_id = google_secret_manager_secret.obsidian_mcp_oauth_signing_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.obsidian_mcp.email}"
}

# ─── Google OAuth client secret ─────────────────────────────────────────────
#
# We use Google as the OIDC identity provider for the human-auth step at
# /authorize. You create a "Web application" OAuth 2.0 client in
# GCP Console → APIs & Services → Credentials, with the redirect URI set
# to https://mcp.<domain>/oauth/google/callback. The client_id goes into
# tfvars (`google_oauth_client_id`); the client_secret goes into this
# secret out of band.

resource "google_secret_manager_secret" "obsidian_mcp_google_oauth_client_secret" {
  secret_id = "obsidian-mcp-google-oauth-client-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secret_manager]
}

resource "google_secret_manager_secret_version" "obsidian_mcp_google_oauth_client_secret_placeholder" {
  secret      = google_secret_manager_secret.obsidian_mcp_google_oauth_client_secret.id
  secret_data = "REPLACE_ME_WITH_GOOGLE_OAUTH_CLIENT_SECRET"

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "obsidian_mcp_google_oauth_client_secret_accessor" {
  secret_id = google_secret_manager_secret.obsidian_mcp_google_oauth_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.obsidian_mcp.email}"
}

# ─── Cloud Run service ──────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "obsidian_mcp" {
  name     = "obsidian-mcp"
  location = var.gcp_region

  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.obsidian_mcp.email

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    max_instance_request_concurrency = 10

    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      resources {
        cpu_idle          = true
        startup_cpu_boost = true

        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      env {
        name  = "COUCHDB_URL"
        value = "https://${var.vault_subdomain}.${var.domain}"
      }

      env {
        name  = "COUCHDB_DB"
        value = var.obsidian_db_name
      }

      env {
        name  = "COUCHDB_USER"
        value = var.obsidian_mcp_couchdb_user
      }

      env {
        name  = "OAUTH_ISSUER"
        value = "https://${var.mcp_subdomain}.${var.domain}"
      }

      env {
        name  = "GOOGLE_OAUTH_CLIENT_ID"
        value = var.google_oauth_client_id
      }

      env {
        name  = "GOOGLE_OAUTH_REDIRECT_URI"
        value = "https://${var.mcp_subdomain}.${var.domain}/oauth/google/callback"
      }

      env {
        name  = "ALLOWED_EMAILS"
        value = join(",", var.mcp_allowed_emails)
      }

      env {
        name  = "LOG_LEVEL"
        value = "info"
      }

      env {
        name = "COUCHDB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.obsidian_mcp_couchdb_password.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "LIVESYNC_PASSPHRASE"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.obsidian_livesync_passphrase.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "OAUTH_SIGNING_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.obsidian_mcp_oauth_signing_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "GOOGLE_OAUTH_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.obsidian_mcp_google_oauth_client_secret.secret_id
            version = "latest"
          }
        }
      }

      ports {
        container_port = 8080
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.cloud_run,
    google_secret_manager_secret_iam_member.obsidian_mcp_couchdb_password_accessor,
    google_secret_manager_secret_iam_member.obsidian_livesync_passphrase_accessor,
    google_secret_manager_secret_iam_member.obsidian_mcp_oauth_signing_key_accessor,
    google_secret_manager_secret_iam_member.obsidian_mcp_google_oauth_client_secret_accessor,
  ]
}

# ─── Public invoker ─────────────────────────────────────────────────────────
#
# Cloud Run IAM is `allUsers` — auth is enforced inside the server by the
# OAuth bearer-token check. /mcp will return 401 with a WWW-Authenticate
# header pointing at /.well-known/oauth-protected-resource for clients
# that need to start the OAuth dance. /authorize, /token, /register, and
# the metadata endpoints are intentionally public — OAuth bootstraps
# trust, so the discovery and token-issuance endpoints have to be reachable
# without credentials.

resource "google_cloud_run_v2_service_iam_member" "obsidian_mcp_invoker_public" {
  name     = google_cloud_run_v2_service.obsidian_mcp.name
  location = google_cloud_run_v2_service.obsidian_mcp.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─── Custom domain mapping ──────────────────────────────────────────────────
#
# Maps mcp.<domain> directly to the Cloud Run service with a Google-managed
# cert. Provisioning the cert can take 15–30 minutes after the DNS record
# resolves. There is no Cloudflare in this path — the DNS record (in
# cloudflare.tf) is set to DNS-only (proxied=false) and points at
# ghs.googlehosted.com.

resource "google_cloud_run_domain_mapping" "mcp" {
  location = var.gcp_region
  name     = "${var.mcp_subdomain}.${var.domain}"

  metadata {
    namespace = var.gcp_project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.obsidian_mcp.name
  }

  depends_on = [google_cloud_run_v2_service.obsidian_mcp]
}
