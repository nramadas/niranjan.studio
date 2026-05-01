# ─── Provider versions and state backend ────────────────────────────────────
#
# Major versions are pinned so a `terraform init` years from now doesn't pull
# in a breaking change. Bump deliberately, not by accident.
#
# The GCS backend block is intentionally empty — the bucket name is supplied
# at init time via `-backend-config=../backend.hcl` so the state location is
# not checked into the repo. backend.hcl is gitignored.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  backend "gcs" {
    # bucket  = "<project-id>-tfstate"   # supplied via backend.hcl
    # prefix  = "personal-infra"
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
  zone    = var.gcp_zone
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# ─── API enablement ─────────────────────────────────────────────────────────
#
# `disable_on_destroy = false` because we don't want `terraform destroy` to
# rip APIs out from under any other infrastructure that happens to share
# this project.

resource "google_project_service" "compute" {
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "secret_manager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}
