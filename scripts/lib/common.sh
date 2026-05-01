# Shared bash helpers. Source this file from any script:
#   source "$(dirname "$0")/../lib/common.sh"
#
# Provides: log_info, log_warn, log_error, die.
# Color output is suppressed when stdout is not a terminal or NO_COLOR is set
# (https://no-color.org).

# shellcheck shell=bash

if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
  __c_reset=$'\033[0m'
  __c_red=$'\033[31m'
  __c_yellow=$'\033[33m'
  __c_blue=$'\033[34m'
else
  __c_reset=""
  __c_red=""
  __c_yellow=""
  __c_blue=""
fi

log_info() {
  printf '%s[info]%s %s\n' "${__c_blue}" "${__c_reset}" "$*"
}

log_warn() {
  printf '%s[warn]%s %s\n' "${__c_yellow}" "${__c_reset}" "$*" >&2
}

log_error() {
  printf '%s[error]%s %s\n' "${__c_red}" "${__c_reset}" "$*" >&2
}

die() {
  log_error "$@"
  exit 1
}
