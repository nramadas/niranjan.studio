# ─── Outputs ────────────────────────────────────────────────────────────────
#
# Nothing sensitive here. Passwords and signing keys are deliberately NOT
# exposed as outputs — fetch them with the `*_fetch_command` outputs
# instead, which go through Secret Manager and IAM rather than putting
# plaintext in the state-output.

output "ssh_command" {
  description = "Command to SSH into the Obsidian VM via gcloud (handles IAP / OS Login automatically)."
  value       = "gcloud compute ssh ${google_compute_instance.obsidian.name} --project=${var.gcp_project_id} --zone=${var.gcp_zone}"
}

output "vm_external_ip" {
  description = "Ephemeral external IP of the VM. Useful only for diagnostics — there are no inbound firewall rules, so you can't reach any port directly."
  value       = google_compute_instance.obsidian.network_interface[0].access_config[0].nat_ip
}

output "couchdb_secret_name" {
  description = "Secret Manager secret ID holding the CouchDB admin password."
  value       = google_secret_manager_secret.obsidian_couchdb_password.secret_id
}

output "couchdb_password_fetch_command" {
  description = "Run this locally (with appropriate IAM) to print the CouchDB admin password."
  value       = "gcloud secrets versions access latest --project=${var.gcp_project_id} --secret=${google_secret_manager_secret.obsidian_couchdb_password.secret_id}"
}

output "couchdb_admin_user" {
  description = "CouchDB admin username (paired with the password above)."
  value       = var.obsidian_admin_user
}

output "vault_url" {
  description = "Public HTTPS URL the Obsidian LiveSync plugin connects to. Resolves only after the tunnel is up and the DNS record applied."
  value       = "https://${var.vault_subdomain}.${var.domain}"
}

output "vm_service_account_email" {
  description = "Service account email attached to the VM (Secret Manager IAM grant target)."
  value       = google_service_account.obsidian_vm.email
}

# ─── Convenience outputs for shell scripting ────────────────────────────────

output "gcp_project_id" {
  description = "GCP project ID (mirrors the input variable, exposed for shell scripting)."
  value       = var.gcp_project_id
}

output "gcp_zone" {
  description = "GCP zone (mirrors the input variable, exposed for shell scripting)."
  value       = var.gcp_zone
}

output "instance_name" {
  description = "VM name (mirrors the input variable, exposed for shell scripting)."
  value       = google_compute_instance.obsidian.name
}

# ─── Obsidian MCP server (Phase 2) ──────────────────────────────────────────

output "obsidian_mcp_service_url" {
  description = "Cloud Run *.run.app URL — the underlying service hostname. Public clients should use the obsidian_mcp_public_url instead, which goes through the Google-managed cert on mcp.<domain>."
  value       = google_cloud_run_v2_service.obsidian_mcp.uri
}

output "obsidian_mcp_public_url" {
  description = "Public URL Claude connects to. Resolves once the Cloudflare DNS record is applied and the Cloud Run domain mapping cert finishes provisioning (~30 min after first apply)."
  value       = "https://${var.mcp_subdomain}.${var.domain}"
}

output "obsidian_mcp_oauth_metadata_url" {
  description = "OAuth 2.0 authorization-server metadata URL. Useful for verifying discovery works once DNS + cert are live."
  value       = "https://${var.mcp_subdomain}.${var.domain}/.well-known/oauth-authorization-server"
}

output "obsidian_mcp_artifact_repo" {
  description = "Artifact Registry repo URL used by scripts/obsidian-mcp/deploy.sh."
  value       = "${google_artifact_registry_repository.obsidian_mcp.location}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.obsidian_mcp.repository_id}"
}

output "obsidian_mcp_service_account_email" {
  description = "Service account attached to the Cloud Run MCP service."
  value       = google_service_account.obsidian_mcp.email
}

output "obsidian_mcp_couchdb_user" {
  description = "CouchDB username the MCP server authenticates as. Pair with the password from obsidian_mcp_couchdb_password_fetch_command."
  value       = var.obsidian_mcp_couchdb_user
}

output "obsidian_mcp_couchdb_password_fetch_command" {
  description = "Locally fetch the MCP server's CouchDB password (used by create-couchdb-user.sh)."
  value       = "gcloud secrets versions access latest --project=${var.gcp_project_id} --secret=${google_secret_manager_secret.obsidian_mcp_couchdb_password.secret_id}"
}

output "obsidian_mcp_oauth_signing_key_set_command" {
  description = "One-time command to populate the OAuth signing key. Run scripts/obsidian-mcp/generate-oauth-key.sh which wraps this; or pipe an RSA-2048 PKCS#8 PEM in directly."
  value       = "scripts/obsidian-mcp/generate-oauth-key.sh --project ${var.gcp_project_id}"
}

output "obsidian_mcp_google_oauth_client_secret_set_command" {
  description = "One-time command to populate the Google OAuth client secret. Get the value from GCP Console → APIs & Services → Credentials → your OAuth 2.0 Client ID."
  value       = "printf '%s' '<paste google client secret here>' | gcloud secrets versions add ${google_secret_manager_secret.obsidian_mcp_google_oauth_client_secret.secret_id} --project=${var.gcp_project_id} --data-file=-"
}

output "obsidian_mcp_livesync_passphrase_set_command" {
  description = "One-time command to populate the LiveSync E2EE passphrase. Run AFTER `terraform apply` and BEFORE deploying the server, with the same passphrase you typed into the LiveSync plugin."
  value       = "printf '%s' '<paste passphrase here>' | gcloud secrets versions add ${google_secret_manager_secret.obsidian_livesync_passphrase.secret_id} --project=${var.gcp_project_id} --data-file=-"
}

output "obsidian_mcp_logs_command" {
  description = "Tail Cloud Run logs for the MCP service."
  value       = "gcloud run services logs tail obsidian-mcp --project=${var.gcp_project_id} --region=${var.gcp_region}"
}

# ─── Vault indexer (Phase 3) ────────────────────────────────────────────────

output "vault_indexer_url" {
  description = "Internal URL the MCP server uses to reach the vault-indexer /search endpoint. Cloudflare Access gates it; not a public address."
  value       = "https://${var.indexer_subdomain}.${var.domain}"
}

output "vault_indexer_artifact_repo" {
  description = "Artifact Registry repo URL used by scripts/vault-indexer/deploy.sh."
  value       = "${google_artifact_registry_repository.vault_indexer.location}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.vault_indexer.repository_id}"
}

output "vault_indexer_search_token_fetch_command" {
  description = "Locally fetch the indexer's /search bearer token. Used by scripts/vault-indexer/deploy.sh when populating the VM .env file."
  value       = "gcloud secrets versions access latest --project=${var.gcp_project_id} --secret=${google_secret_manager_secret.vault_indexer_search_token.secret_id}"
}

output "vault_indexer_openai_key_set_command" {
  description = "One-time command to populate the OpenAI API key used by the evaluation harness. Leave the placeholder in place if you never plan to run a hosted-model comparison."
  value       = "printf '%s' '<paste openai key here>' | gcloud secrets versions add ${google_secret_manager_secret.vault_indexer_openai_key.secret_id} --project=${var.gcp_project_id} --data-file=-"
}

output "vault_indexer_logs_command" {
  description = "Tail indexer container logs over SSH."
  value       = "gcloud compute ssh ${google_compute_instance.obsidian.name} --project=${var.gcp_project_id} --zone=${var.gcp_zone} --command 'cd /opt/obsidian && docker compose logs --tail 200 -f vault-indexer'"
}
