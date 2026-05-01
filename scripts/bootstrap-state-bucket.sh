#!/usr/bin/env bash
#
# Create the GCS bucket that holds Terraform state. Run once per project,
# before the first `terraform init`. Idempotent — re-running on an existing
# bucket only ensures versioning and uniform access are still enabled.
#
# Usage:
#   bootstrap-state-bucket.sh <gcp-project-id> <gcp-region>
#
# Example:
#   bootstrap-state-bucket.sh my-personal-infra us-central1

set -euo pipefail

# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") <gcp-project-id> <gcp-region>

Creates a GCS bucket named <gcp-project-id>-tfstate to hold Terraform state.
Enables object versioning so prior states can be recovered. Enables uniform
bucket-level access (no per-object ACLs).

After running, write a backend.hcl in the repo root:

  bucket = "<gcp-project-id>-tfstate"
  prefix = "personal-infra"

then run:

  terraform -chdir=terraform init -backend-config=../backend.hcl
EOF
}

main() {
  case "${1:-}" in
    -h|--help) usage; exit 0 ;;
  esac

  if [[ $# -ne 2 ]]; then
    usage >&2
    die "Expected 2 arguments, got $#."
  fi

  local project_id="$1"
  local region="$2"
  local bucket="${project_id}-tfstate"

  command -v gcloud >/dev/null || die "gcloud CLI is required. Install: https://cloud.google.com/sdk/docs/install"
  command -v gsutil >/dev/null || die "gsutil CLI is required (ships with the gcloud SDK)."

  log_info "Project:  ${project_id}"
  log_info "Region:   ${region}"
  log_info "Bucket:   gs://${bucket}"

  if gsutil ls -b "gs://${bucket}" >/dev/null 2>&1; then
    log_warn "Bucket gs://${bucket} already exists. Verifying configuration."
  else
    log_info "Creating bucket gs://${bucket} ..."
    gsutil mb -p "${project_id}" -l "${region}" -b on "gs://${bucket}"
  fi

  log_info "Ensuring versioning is enabled (so corrupted state can be rolled back)."
  gsutil versioning set on "gs://${bucket}"

  log_info "Done."
  cat <<EOF

Next steps:

  1. Set up Application Default Credentials for Terraform (separate from gcloud
     auth login — Terraform reads ADC, not the gcloud session):

         gcloud auth application-default login

  2. Write backend.hcl in the repo root (gitignored):

         bucket = "${bucket}"
         prefix = "personal-infra"

  3. Initialise Terraform:

         terraform -chdir=terraform init -backend-config=../backend.hcl
EOF
}

main "$@"
