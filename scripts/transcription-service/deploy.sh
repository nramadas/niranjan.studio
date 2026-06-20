#!/usr/bin/env bash
#
# Builds the transcription-service Docker image, pushes it to Artifact
# Registry, and rolls a new Cloud Run revision tagged with the current git
# short-SHA. Same shape as scripts/obsidian-mcp/deploy.sh.
#
# Idempotent: re-running with no source changes still pushes (the SHA is the
# same) and Cloud Run no-ops the deploy. Source changes ship a new revision.
#
# The service is IAM-private (no public invoker), so /health is not curl-able
# anonymously — the post-deploy hint below uses an identity token (and the
# caller needs roles/run.invoker on the service).
#
# Usage:
#   scripts/transcription-service/deploy.sh \
#     --project <gcp-project> \
#     [--region us-east1] \
#     [--repo transcription-service]
#
# Reads `terraform output` for sensible defaults — no need to type the
# project ID twice — but explicit flags win.

set -euo pipefail

# shellcheck source=../lib/common.sh
source "$(dirname "$0")/../lib/common.sh"

PROJECT=""
REGION="us-east1"
REPO="transcription-service"
SERVICE="transcription-service"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--project <id>] [--region <region>] [--repo <name>]

Builds the transcription-service container image, pushes to Artifact
Registry, and rolls a new Cloud Run revision.

If --project is omitted, reads gcp_project_id from \`terraform output\`.

Options:
  --project <id>      GCP project ID.
  --region <region>   Cloud Run / Artifact Registry region (default: us-east1).
  --repo <name>       Artifact Registry repo name (default: transcription-service).
  -h, --help          Show this help.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project) PROJECT="${2:-}"; shift 2 ;;
      --region)  REGION="${2:-}"; shift 2 ;;
      --repo)    REPO="${2:-}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *)         usage >&2; die "Unknown argument: $1" ;;
    esac
  done

  if [[ -z "$PROJECT" ]]; then
    PROJECT="$(terraform -chdir=terraform output -raw gcp_project_id 2>/dev/null || true)"
    [[ -n "$PROJECT" ]] || die "--project is required (or run inside repo with terraform outputs available)."
  fi
}

main() {
  parse_args "$@"

  command -v gcloud >/dev/null || die "gcloud CLI is required."
  command -v docker >/dev/null || die "docker is required."
  command -v git    >/dev/null || die "git is required."

  local repo_root
  repo_root="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel)"
  local service_dir="${repo_root}/services/transcription-service"
  [[ -d "$service_dir" ]] || die "Service directory not found at ${service_dir}"

  local sha
  sha="$(git -C "$repo_root" rev-parse --short=10 HEAD)"
  local registry="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}"
  local image="${registry}/service:${sha}"
  local image_latest="${registry}/service:latest"

  log_info "Project:  ${PROJECT}"
  log_info "Region:   ${REGION}"
  log_info "Image:    ${image}"

  log_info "Configuring docker auth for ${REGION}-docker.pkg.dev..."
  gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet >/dev/null

  log_info "Building image (linux/amd64 — Cloud Run runs amd64)..."
  # Docker context is the repo root (not the service dir) so the
  # @niranjan/vault-shared workspace package is reachable; the Dockerfile is
  # pointed at explicitly. See services/transcription-service/Dockerfile.
  docker build \
    --platform=linux/amd64 \
    -t "$image" -t "$image_latest" \
    -f "${service_dir}/Dockerfile" \
    "$repo_root"

  log_info "Pushing image..."
  docker push "$image"
  docker push "$image_latest"

  log_info "Rolling Cloud Run revision..."
  gcloud run services update "$SERVICE" \
    --project="$PROJECT" \
    --region="$REGION" \
    --image="$image" \
    --quiet

  cat <<EOF

────────────────────────────────────────────────────────────────────────
Deployed ${image} to Cloud Run service '${SERVICE}'.

Tail logs:
  gcloud run services logs tail ${SERVICE} --project=${PROJECT} --region=${REGION}

Hit health check (IAM-private — needs an identity token + run.invoker):
  CLOUD_RUN_URL=\$(gcloud run services describe ${SERVICE} \
    --project=${PROJECT} --region=${REGION} --format='value(status.url)')
  curl -i -H "Authorization: Bearer \$(gcloud auth print-identity-token)" "\${CLOUD_RUN_URL}/health"
────────────────────────────────────────────────────────────────────────
EOF
}

main "$@"
