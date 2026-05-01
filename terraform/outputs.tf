# ─── Outputs ────────────────────────────────────────────────────────────────
#
# Nothing sensitive here. The CouchDB password is intentionally NOT exposed
# as an output — fetch it with the `couchdb_password_fetch_command` instead,
# which goes through Secret Manager and IAM rather than putting plaintext in
# the state-output.

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
# So you can pull these values in `gcloud compute scp/ssh` invocations
# without having to remember which zone you picked.

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
