#!/usr/bin/env bash
set -euo pipefail

LABEL="com.codzr.codex-task-notifier"
PLIST_NAME="${LABEL}.plist"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_PLIST="${SCRIPT_DIR}/${PLIST_NAME}"
TARGET_DIR="${HOME}/Library/LaunchAgents"
TARGET_PLIST="${TARGET_DIR}/${PLIST_NAME}"
DOMAIN="gui/$(id -u)"
SERVICE="${DOMAIN}/${LABEL}"
SYSTEM_FALLBACK_PATH="/usr/bin:/bin:/usr/sbin:/sbin"
INTERVAL_ENV_KEY="CODEX_NOTIFY_INTERVAL_MS"
DEBOUNCE_ENV_KEY="CODEX_NOTIFY_DEBOUNCE_MS"
NODE_BINARY="node"
BUN_BINARY="bun"
BUN_FALLBACK="${HOME}/.bun/bin/bun"
NOTIFIER_BINARY="terminal-notifier"

usage() {
  cat <<'USAGE'
Usage: manage-launchagent.sh <install|start|status|stop|uninstall>

Commands:
  install    Copy plist into ~/Library/LaunchAgents and (re)load service
  start      Load service from installed plist if needed
  status     Print launchctl service status
  stop       Unload service if running
  uninstall  Unload service and remove installed plist
USAGE
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

ensure_dependency() {
  local binary="$1"

  if command -v "${binary}" >/dev/null 2>&1; then
    return 0
  fi

  echo "Error: missing ${binary}. Install it first:" >&2
  echo "brew install terminal-notifier" >&2
  exit 1
}

ensure_js_runtime() {
  if command -v "${NODE_BINARY}" >/dev/null 2>&1; then
    return 0
  fi

  if command -v "${BUN_BINARY}" >/dev/null 2>&1; then
    return 0
  fi

  if [[ -x "${BUN_FALLBACK}" ]]; then
    return 0
  fi

  echo "Error: missing JavaScript runtime (node or bun)." >&2
  echo "Install one runtime, for example: brew install node" >&2
  exit 1
}

read_plist_env_value() {
  local plist_path="$1"
  local key="$2"

  if [[ ! -f "${plist_path}" ]]; then
    return 0
  fi

  /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:${key}" "${plist_path}" 2>/dev/null || true
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

resolve_optional_env_value() {
  local key="$1"
  local existing_value="$2"
  local shell_value="${!key:-}"

  if [[ -n "${shell_value}" ]]; then
    printf '%s' "${shell_value}"
    return 0
  fi

  printf '%s' "${existing_value}"
}

resolve_path_for_install() {
  local existing_path="$1"
  local shell_path="${PATH:-}"
  local node_bin_dir=""
  local bun_bin_dir=""
  local notifier_bin_dir=""
  local resolved_path=""

  if command -v node >/dev/null 2>&1; then
    node_bin_dir="$(dirname "$(command -v node)")"
  fi

  if command -v "${BUN_BINARY}" >/dev/null 2>&1; then
    bun_bin_dir="$(dirname "$(command -v "${BUN_BINARY}")")"
  elif [[ -x "${BUN_FALLBACK}" ]]; then
    bun_bin_dir="$(dirname "${BUN_FALLBACK}")"
  fi

  if command -v "${NOTIFIER_BINARY}" >/dev/null 2>&1; then
    notifier_bin_dir="$(dirname "$(command -v "${NOTIFIER_BINARY}")")"
  fi

  if [[ -n "${existing_path}" ]]; then
    resolved_path="${existing_path}"
  elif [[ -n "${shell_path}" ]]; then
    resolved_path="${shell_path}"
  else
    resolved_path="${SYSTEM_FALLBACK_PATH}"
  fi

  resolved_path="$(prepend_path_segment_if_missing "${node_bin_dir}" "${resolved_path}")"
  resolved_path="$(prepend_path_segment_if_missing "${bun_bin_dir}" "${resolved_path}")"
  resolved_path="$(prepend_path_segment_if_missing "${notifier_bin_dir}" "${resolved_path}")"
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
  ensure_js_runtime
  ensure_dependency "${NOTIFIER_BINARY}"

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
  ensure_js_runtime
  ensure_dependency "${NOTIFIER_BINARY}"
  mkdir -p "${TARGET_DIR}"

  local had_existing_plist="false"
  local backup_plist="${TARGET_PLIST}.bak.$$"
  local existing_path=""
  local existing_interval=""
  local existing_debounce=""
  local resolved_path=""
  local resolved_interval=""
  local resolved_debounce=""

  if [[ -f "${TARGET_PLIST}" ]]; then
    had_existing_plist="true"
    existing_path="$(read_plist_env_value "${TARGET_PLIST}" "PATH")"
    existing_interval="$(read_plist_env_value "${TARGET_PLIST}" "${INTERVAL_ENV_KEY}")"
    existing_debounce="$(read_plist_env_value "${TARGET_PLIST}" "${DEBOUNCE_ENV_KEY}")"
    cp "${TARGET_PLIST}" "${backup_plist}"
  fi

  resolved_path="$(resolve_path_for_install "${existing_path}")"
  resolved_interval="$(resolve_optional_env_value "${INTERVAL_ENV_KEY}" "${existing_interval}")"
  resolved_debounce="$(resolve_optional_env_value "${DEBOUNCE_ENV_KEY}" "${existing_debounce}")"

  cp "${SOURCE_PLIST}" "${TARGET_PLIST}"
  plutil -replace EnvironmentVariables.PATH -string "${resolved_path}" "${TARGET_PLIST}"

  if [[ -n "${resolved_interval}" ]]; then
    plutil -replace "EnvironmentVariables.${INTERVAL_ENV_KEY}" -string "${resolved_interval}" "${TARGET_PLIST}"
  fi

  if [[ -n "${resolved_debounce}" ]]; then
    plutil -replace "EnvironmentVariables.${DEBOUNCE_ENV_KEY}" -string "${resolved_debounce}" "${TARGET_PLIST}"
  fi

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
