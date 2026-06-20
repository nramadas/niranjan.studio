# ─── Transcription service (Phase 4) ────────────────────────────────────────
#
# An isolated Cloud Run service that turns a meeting recording into a
# diarized transcript via Deepgram. It is reached ONLY by the obsidian-mcp
# service account over Cloud Run IAM — there is no public invoker, no
# Cloudflare route, and no custom domain. It holds the Deepgram key and an
# app-layer bearer; it never holds the LiveSync passphrase and cannot read
# the vault.
#
#   obsidian-mcp (Cloud Run)
#     ──HTTPS + Google-signed ID token (IAM)──▶  transcription-service (Cloud Run)
#       + X-Transcription-Token: Bearer <app bearer>      │
#                                                          ▼
#                                                       Deepgram /v1/listen

# ─── Service account ────────────────────────────────────────────────────────

resource "google_service_account" "transcription_service" {
  account_id   = "transcription-service"
  display_name = "Transcription service"
  description  = "Service account for the Cloud Run transcription service. Reads the Deepgram key + app bearer only; no vault access."
}

# ─── Artifact Registry repo ─────────────────────────────────────────────────

resource "google_artifact_registry_repository" "transcription_service" {
  location      = var.gcp_region
  repository_id = "transcription-service"
  description   = "Container images for the transcription Cloud Run service."
  format        = "DOCKER"

  depends_on = [google_project_service.artifact_registry]
}

# ─── Deepgram API key ───────────────────────────────────────────────────────
#
# Placeholder; populated out of band with your Deepgram key. This is the
# single credential whose holder sees plaintext meeting audio downstream of
# the bot. Read only by the transcription SA.

resource "google_secret_manager_secret" "transcription_deepgram_api_key" {
  secret_id = "transcription-deepgram-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secret_manager]
}

resource "google_secret_manager_secret_version" "transcription_deepgram_api_key_placeholder" {
  secret      = google_secret_manager_secret.transcription_deepgram_api_key.id
  secret_data = "REPLACE_ME_WITH_DEEPGRAM_API_KEY"

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "transcription_deepgram_api_key_accessor" {
  secret_id = google_secret_manager_secret.transcription_deepgram_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.transcription_service.email}"
}

# ─── App-layer bearer ───────────────────────────────────────────────────────
#
# Defence-in-depth behind Cloud Run IAM. The MCP sends it (in the
# X-Transcription-Token header, NOT Authorization — that carries the IAM ID
# token); the service validates it via `validateBearer`. Read by both SAs.
# `special = false` so it interpolates cleanly into env files.

resource "random_password" "transcription_service_bearer" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "transcription_service_bearer" {
  secret_id = "transcription-service-bearer"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secret_manager]
}

resource "google_secret_manager_secret_version" "transcription_service_bearer" {
  secret      = google_secret_manager_secret.transcription_service_bearer.id
  secret_data = random_password.transcription_service_bearer.result
}

resource "google_secret_manager_secret_iam_member" "transcription_service_bearer_self" {
  secret_id = google_secret_manager_secret.transcription_service_bearer.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.transcription_service.email}"
}

resource "google_secret_manager_secret_iam_member" "transcription_service_bearer_mcp" {
  secret_id = google_secret_manager_secret.transcription_service_bearer.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.obsidian_mcp.email}"
}

# ─── Cloud Run service ──────────────────────────────────────────────────────
#
# INGRESS_TRAFFIC_ALL + IAM-private invoker (below). The MCP reaches it over
# the public *.run.app URL with an ID token, so internal-only ingress would
# block it; IAM is the gate. PORT is injected by Cloud Run (do not set it).

resource "google_cloud_run_v2_service" "transcription_service" {
  name     = "transcription-service"
  location = var.gcp_region

  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.transcription_service.email

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    max_instance_request_concurrency = 4

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
        name  = "TRANSCRIBER"
        value = "deepgram"
      }

      env {
        name  = "DEEPGRAM_MODEL"
        value = "nova-3"
      }

      env {
        name  = "LOG_LEVEL"
        value = "info"
      }

      env {
        name = "DEEPGRAM_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.transcription_deepgram_api_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "AUTH_BEARER_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.transcription_service_bearer.secret_id
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
    google_secret_manager_secret_iam_member.transcription_deepgram_api_key_accessor,
    google_secret_manager_secret_iam_member.transcription_service_bearer_self,
    google_secret_manager_secret_version.transcription_deepgram_api_key_placeholder,
    google_secret_manager_secret_version.transcription_service_bearer,
  ]
}

# ─── Invoker: only the MCP service account ──────────────────────────────────
#
# No allUsers. The obsidian-mcp SA gets run.invoker so the MCP can call
# /transcribe with a Google-signed ID token; nothing else can reach it.

resource "google_cloud_run_v2_service_iam_member" "transcription_service_invoker_mcp" {
  name     = google_cloud_run_v2_service.transcription_service.name
  location = google_cloud_run_v2_service.transcription_service.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.obsidian_mcp.email}"
}
