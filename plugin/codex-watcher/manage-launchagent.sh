#!/usr/bin/env bash
set -euo pipefail

LABEL="com.codzr.codex-completion-watcher"
PLIST_NAME="${LABEL}.plist"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_PLIST="${SCRIPT_DIR}/${PLIST_NAME}"
TARGET_DIR="${HOME}/Library/LaunchAgents"
TARGET_PLIST="${TARGET_DIR}/${PLIST_NAME}"
DOMAIN="gui/$(id -u)"
SERVICE="${DOMAIN}/${LABEL}"
PLACEHOLDER_TOKEN="__REPLACE_WITH_LOCAL_OPENCODE_NOTIFY_TOKEN__"

usage() {
  cat <<'EOF'
Usage: manage-launchagent.sh <install|start|status|stop|uninstall>

Commands:
  install    Copy plist into ~/Library/LaunchAgents and (re)load service
  start      Load service from installed plist if needed
  status     Print launchctl service status
  stop       Unload service if running
  uninstall  Unload service and remove installed plist
EOF
}

ensure_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Error: this script only supports macOS launchd." >&2
    exit 1
  fi
}

ensure_source_plist() {
  if [[ ! -f "${SOURCE_PLIST}" ]]; then
    echo "Error: source plist not found: ${SOURCE_PLIST}" >&2
    exit 1
  fi
}

read_plist_env_value() {
  local plist_path="$1"
  local key="$2"

  if [[ ! -f "${plist_path}" ]]; then
    return 0
  fi

  /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:${key}" "${plist_path}" 2>/dev/null || true
}

is_usable_token() {
  local token="$1"
  [[ -n "${token}" && "${token}" != "${PLACEHOLDER_TOKEN}" ]]
}

prepend_path_segment_if_missing() {
  local segment="$1"
  local path_value="$2"

  if [[ -z "${segment}" ]]; then
    printf '%s' "${path_value}"
    return 0
  fi

  case ":${path_value}:" in
    *":${segment}:"*)
      printf '%s' "${path_value}"
      ;;
    *)
      if [[ -n "${path_value}" ]]; then
        printf '%s:%s' "${segment}" "${path_value}"
      else
        printf '%s' "${segment}"
      fi
      ;;
  esac
}

resolve_token_for_install() {
  local existing_token="$1"
  local template_token="$2"

  if [[ -n "${OPENCODE_NOTIFY_TOKEN:-}" ]]; then
    printf '%s' "${OPENCODE_NOTIFY_TOKEN}"
    return 0
  fi

  if is_usable_token "${existing_token}"; then
    printf '%s' "${existing_token}"
    return 0
  fi

  printf '%s' "${template_token}"
}

resolve_path_for_install() {
  local existing_path="$1"
  local node_bin_dir=""
  local system_fallback_path="/usr/bin:/bin:/usr/sbin:/sbin"
  local resolved_path=""

  if command -v node >/dev/null 2>&1; then
    node_bin_dir="$(dirname "$(command -v node)")"
  fi

  if [[ -n "${existing_path}" ]]; then
    resolved_path="${existing_path}"
  elif [[ -n "${node_bin_dir}" ]]; then
    resolved_path="${node_bin_dir}:${system_fallback_path}"
  else
    resolved_path="${system_fallback_path}"
  fi

  resolved_path="$(prepend_path_segment_if_missing "${node_bin_dir}" "${resolved_path}")"
  printf '%s' "${resolved_path}"
}

is_loaded() {
  launchctl print "${SERVICE}" >/dev/null 2>&1
}

stop_service() {
  if is_loaded; then
    launchctl bootout "${SERVICE}" >/dev/null 2>&1 || true
    echo "Stopped ${LABEL}."
  else
    echo "${LABEL} is already stopped."
  fi
}

status_service() {
  if launchctl print "${SERVICE}"; then
    echo "Status: loaded (${LABEL})"
    return 0
  fi

  echo "Status: not loaded (${LABEL})"
  return 1
}

start_service() {
  if [[ ! -f "${TARGET_PLIST}" ]]; then
    echo "Error: installed plist not found: ${TARGET_PLIST}" >&2
    echo "Run: $0 install" >&2
    exit 1
  fi

  if is_loaded; then
    echo "${LABEL} is already loaded."
  else
    launchctl bootstrap "${DOMAIN}" "${TARGET_PLIST}"
    echo "Started ${LABEL}."
  fi

  status_service
}

install_service() {
  ensure_source_plist
  mkdir -p "${TARGET_DIR}"

  local had_existing_plist="false"
  local backup_plist="${TARGET_PLIST}.bak.$$"
  local existing_token=""
  local existing_path=""
  local template_token=""
  local resolved_token=""
  local resolved_path=""

  if [[ -f "${TARGET_PLIST}" ]]; then
    had_existing_plist="true"
    existing_token="$(read_plist_env_value "${TARGET_PLIST}" "OPENCODE_NOTIFY_TOKEN")"
    existing_path="$(read_plist_env_value "${TARGET_PLIST}" "PATH")"
    cp "${TARGET_PLIST}" "${backup_plist}"
  fi

  template_token="$(read_plist_env_value "${SOURCE_PLIST}" "OPENCODE_NOTIFY_TOKEN")"
  resolved_token="$(resolve_token_for_install "${existing_token}" "${template_token}")"
  resolved_path="$(resolve_path_for_install "${existing_path}")"

  cp "${SOURCE_PLIST}" "${TARGET_PLIST}"
  plutil -replace EnvironmentVariables.OPENCODE_NOTIFY_TOKEN -string "${resolved_token}" "${TARGET_PLIST}"
  plutil -replace EnvironmentVariables.PATH -string "${resolved_path}" "${TARGET_PLIST}"

  if ! {
    launchctl bootout "${SERVICE}" >/dev/null 2>&1 || true
    launchctl bootstrap "${DOMAIN}" "${TARGET_PLIST}"
  }; then
    echo "Install failed; rolling back changes." >&2
    if [[ "${had_existing_plist}" == "true" ]]; then
      cp "${backup_plist}" "${TARGET_PLIST}"
      launchctl bootout "${SERVICE}" >/dev/null 2>&1 || true
      launchctl bootstrap "${DOMAIN}" "${TARGET_PLIST}" >/dev/null 2>&1 || true
    else
      rm -f "${TARGET_PLIST}"
      launchctl bootout "${SERVICE}" >/dev/null 2>&1 || true
    fi
    rm -f "${backup_plist}"
    exit 1
  fi

  rm -f "${backup_plist}"
  echo "Installed ${TARGET_PLIST} and loaded ${LABEL}."
  status_service
}

uninstall_service() {
  launchctl bootout "${SERVICE}" >/dev/null 2>&1 || true

  if [[ -f "${TARGET_PLIST}" ]]; then
    rm -f "${TARGET_PLIST}"
    echo "Removed ${TARGET_PLIST}."
  else
    echo "No installed plist to remove at ${TARGET_PLIST}."
  fi

  if is_loaded; then
    echo "Warning: ${LABEL} still appears loaded after uninstall." >&2
    return 1
  fi

  echo "Uninstalled ${LABEL}."
}

main() {
  ensure_macos

  local command="${1:-}"
  case "${command}" in
    install)
      install_service
      ;;
    start)
      start_service
      ;;
    status)
      status_service
      ;;
    stop)
      stop_service
      ;;
    uninstall)
      uninstall_service
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
