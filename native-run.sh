#!/usr/bin/env bash
# native-run.sh — start the backend and frontend from a native (non-Docker)
# install produced by ./native-build.sh.
#
# The backend runs from blancService/env, the frontend runs `npm run dev`.
# Ctrl+C stops both.
#
# Prereqs (bring your own):
#   • MariaDB reachable per dbConfig.mariadbConnectionString
#   • RabbitMQ reachable per rmqConfig.hosts
#   • Secrets set in blancService/atm/config/config.yml (or OPENAI_API_KEY env)
#
# Usage: ./native-run.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${REPO_ROOT}/blancService"
FRONTEND_DIR="${REPO_ROOT}/blancUi"
VENV_DIR="${BACKEND_DIR}/env"

BOLD="\033[1m"; DIM="\033[2m"; GREEN="\033[32m"; RED="\033[31m"; RESET="\033[0m"
die() { printf "\n${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }

[[ -d "${VENV_DIR}" ]] || die "No venv at ${VENV_DIR}. Run ./native-build.sh first."
[[ -f "${BACKEND_DIR}/atm/config/config.yml" ]] || die "Missing blancService/atm/config/config.yml — run ./native-build.sh."
[[ -d "${FRONTEND_DIR}/node_modules" ]] || die "No frontend node_modules. Run ./native-build.sh first."

# Track child pids so Ctrl+C tears everything down.
PIDS=()
cleanup() {
    printf "\n${BOLD}Stopping…${RESET}\n"
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── Backend ──────────────────────────────────────────────────────────
printf "${BOLD}==> Starting backend (uvicorn) on http://127.0.0.1:8000${RESET}\n"
(
    cd "${BACKEND_DIR}"
    export ENV="${ENV:-config}"
    # Explicit path to the venv interpreter — `source activate` +
    # bare `python3` can silently reach for the wrong interpreter when
    # /opt/homebrew/bin is prepended by shell login hooks.
    exec "${VENV_DIR}/bin/python3" main.py
) &
PIDS+=("$!")

# ── Frontend ─────────────────────────────────────────────────────────
printf "${BOLD}==> Starting frontend (next dev) on http://127.0.0.1:3000${RESET}\n"
(
    cd "${FRONTEND_DIR}"
    export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-http://127.0.0.1:8000}"
    exec npm run dev
) &
PIDS+=("$!")

printf "\n${GREEN}Both services started.${RESET} ${DIM}Ctrl+C to stop.${RESET}\n\n"

# Wait for either child to exit; if one dies, break out and let the trap
# tear down the other. Using `wait -n` would be cleaner but macOS ships
# with bash 3.2 which doesn't support it — poll every second instead.
while true; do
    for pid in "${PIDS[@]}"; do
        if ! kill -0 "$pid" 2>/dev/null; then
            break 2
        fi
    done
    sleep 1
done
