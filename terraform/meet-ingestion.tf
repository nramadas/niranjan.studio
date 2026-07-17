# ─── Google Meet transcript ingestion (Phase 5) ─────────────────────────────
#
# When Google Meet's own transcription finishes a transcript, the Google
# Workspace Events API publishes a
# `google.workspace.meet.transcript.v2.fileGenerated` event. Delivery path:
#
#   Meet transcript generated (in any configured account's meeting)
#     ──▶ Workspace Events subscriptions — ONE PER ACCOUNT (created/renewed
#         by the MCP itself, using each account's OAuth refresh token — see
#         MeetClient.ensureSubscription)
#     ──▶ Pub/Sub topic `meet-events` (this file, shared by all accounts)
#     ──▶ push subscription ──HTTPS──▶ mcp.<domain>/meet/webhook
#         (OIDC token signed as the meet-push service account; the server
#          verifies audience + service-account email before ingesting)
#     ──▶ MCP fetches transcript entries via the Meet REST API and writes an
#         E2EE note; Claude digests todos + person dossiers into the vault.
#
# Terraform owns the durable plumbing (APIs, topic, publish grant, push
# subscription, secrets). The Workspace Events *subscriptions* themselves
# are deliberately NOT Terraform-managed: each must be created with that
# account's user OAuth credentials (not a service account), they expire on
# a Google-controlled TTL, and the service already has those credentials —
# so the service creates and renews them (at boot, on transcript pushes,
# and on Google's expiration-reminder events).

resource "google_project_service" "meet_api" {
  service            = "meet.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "workspace_events_api" {
  service            = "workspaceevents.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "pubsub" {
  service            = "pubsub.googleapis.com"
  disable_on_destroy = false
}

data "google_project" "current" {}

# ─── Topic Google publishes Meet events to ──────────────────────────────────

resource "google_pubsub_topic" "meet_events" {
  name = "meet-events"

  depends_on = [google_project_service.pubsub]
}

# The Workspace Events API publishes as this Google-owned service account.
resource "google_pubsub_topic_iam_member" "meet_events_google_publisher" {
  topic  = google_pubsub_topic.meet_events.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:meet-api-event-push@system.gserviceaccount.com"
}

# ─── Push subscription → /meet/webhook ──────────────────────────────────────
#
# Pub/Sub signs an OIDC token as this dedicated SA on every push; the MCP
# verifies signature + audience + email. The SA has no roles anywhere — it
# exists purely as a verifiable identity.

resource "google_service_account" "meet_push" {
  account_id   = "meet-push"
  display_name = "Meet events Pub/Sub push"
  description  = "Identity Pub/Sub signs OIDC tokens as when pushing Meet events to the MCP /meet/webhook. No roles."
}

# The Pub/Sub service agent mints those OIDC tokens, so it needs
# tokenCreator on the push SA.
resource "google_service_account_iam_member" "meet_push_token_creator" {
  service_account_id = google_service_account.meet_push.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_subscription" "meet_events_push" {
  name  = "meet-events-push"
  topic = google_pubsub_topic.meet_events.id

  # Ingestion is synchronous in the webhook (transcript fetch + note write
  # + Claude digest); give it the maximum before Pub/Sub redelivers. The
  # deterministic note path makes redeliveries idempotent regardless.
  ack_deadline_seconds = 600

  # Keep the subscription alive through idle stretches (no meetings).
  expiration_policy {
    ttl = ""
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  push_config {
    push_endpoint = "https://${var.mcp_subdomain}.${var.domain}/meet/webhook"

    oidc_token {
      service_account_email = google_service_account.meet_push.email
      audience              = "https://${var.mcp_subdomain}.${var.domain}/meet/webhook"
    }
  }

  depends_on = [google_service_account_iam_member.meet_push_token_creator]
}

# ─── Google accounts (user refresh tokens) ──────────────────────────────────
#
# JSON array of the Google accounts whose Meet transcripts are ingested —
# personal and work both feed the one vault. Each entry is
# `{ "name", "refreshToken", "targetResource" }`; the refresh tokens carry
# the meetings.space.readonly scope and the MCP uses them to read
# conference records / transcript entries / participants and to manage one
# Workspace Events subscription per account. Entries are printed by
# scripts/obsidian-mcp/get-google-refresh-token.mjs (run once per account,
# signed in as that account).

resource "google_secret_manager_secret" "obsidian_mcp_meet_accounts" {
  secret_id = "obsidian-mcp-meet-accounts"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secret_manager]
}

resource "google_secret_manager_secret_version" "obsidian_mcp_meet_accounts_placeholder" {
  secret      = google_secret_manager_secret.obsidian_mcp_meet_accounts.id
  secret_data = "REPLACE_ME_WITH_MEET_ACCOUNTS_JSON"

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "obsidian_mcp_meet_accounts_accessor" {
  secret_id = google_secret_manager_secret.obsidian_mcp_meet_accounts.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.obsidian_mcp.email}"
}

# ─── Anthropic API key (transcript digest) ──────────────────────────────────
#
# Powers the todo + dossier extraction. Leaving the placeholder in place
# just disables digestion — transcripts still ingest.

resource "google_secret_manager_secret" "obsidian_mcp_anthropic_api_key" {
  secret_id = "obsidian-mcp-anthropic-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secret_manager]
}

resource "google_secret_manager_secret_version" "obsidian_mcp_anthropic_api_key_placeholder" {
  secret      = google_secret_manager_secret.obsidian_mcp_anthropic_api_key.id
  secret_data = "REPLACE_ME_WITH_ANTHROPIC_API_KEY"

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "obsidian_mcp_anthropic_api_key_accessor" {
  secret_id = google_secret_manager_secret.obsidian_mcp_anthropic_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.obsidian_mcp.email}"
}
