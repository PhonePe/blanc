#!/usr/bin/env bash
# native-build.sh — bootstrap Blanc for a local (non-Docker) run.
#
# What this does:
#   1. Verifies system prereqs (Python 3.12+, Node.js 20+).
#   2. Creates a Python venv under blancService/env and installs requirements —
#      this includes PaddleOCR + paddlepaddle + opencv-python-headless.
#   3. Installs the frontend's node_modules.
#   4. Copies blancService/atm/config/local.yml.example -> local.yml if the
#      real config doesn't exist yet, so the app can boot.
#
# What this does NOT do:
#   * Install MariaDB / RabbitMQ — bring your own, or use `docker compose up
#     mariadb rabbitmq` from the compose file.
#   * Populate secrets — edit blancService/atm/config/local.yml after this
#     script finishes, or export OPENAI_API_KEY / JWT_SECRET_KEY in your
#     shell before running native-run.sh.
#
# Usage: ./native-build.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${REPO_ROOT}/blancService"
FRONTEND_DIR="${REPO_ROOT}/blancUi"
VENV_DIR="${BACKEND_DIR}/env"
CONFIG_DIR="${BACKEND_DIR}/atm/config"

# ── pretty-print helpers ─────────────────────────────────────────────
BOLD="\033[1m"; DIM="\033[2m"; GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; RESET="\033[0m"
step() { printf "\n${BOLD}==> %s${RESET}\n" "$*"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$*"; }
warn() { printf "  ${YELLOW}!${RESET} %s\n" "$*"; }
die()  { printf "\n${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }

# ── 1. Prereqs ───────────────────────────────────────────────────────
step "Checking prerequisites"

command -v python3 >/dev/null 2>&1 || die "python3 not found. Install Python 3.12+ and re-run."
PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PYTHON_MAJOR=$(echo "$PYTHON_VERSION" | cut -d. -f1)
PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f2)
if [[ "$PYTHON_MAJOR" -lt 3 ]] || { [[ "$PYTHON_MAJOR" -eq 3 ]] && [[ "$PYTHON_MINOR" -lt 12 ]]; }; then
    die "Python 3.12+ required (found ${PYTHON_VERSION}). PaddlePaddle wheels target 3.10-3.12."
fi
ok "Python ${PYTHON_VERSION}"

command -v node >/dev/null 2>&1 || die "node not found. Install Node.js 20+ and re-run."
NODE_MAJOR=$(node -v | sed -E 's/v([0-9]+).*/\1/')
if [[ "$NODE_MAJOR" -lt 20 ]]; then
    die "Node.js 20+ required (found $(node -v))."
fi
ok "Node.js $(node -v)"

command -v npm >/dev/null 2>&1 || die "npm not found. Comes with Node.js — reinstall Node."
ok "npm $(npm -v)"

# System libs commonly needed by opencv-python-headless / paddlepaddle.
# We warn rather than error — Docker path sidesteps all of this.
case "$(uname -s)" in
    Linux*)
        if command -v dpkg >/dev/null 2>&1; then
            for pkg in libgomp1 libgl1 libglib2.0-0; do
                if ! dpkg -s "$pkg" >/dev/null 2>&1; then
                    warn "System package '${pkg}' not installed. If PaddleOCR fails at import, run:"
                    printf "      ${DIM}sudo apt install -y libgomp1 libgl1 libglib2.0-0${RESET}\n"
                    break
                fi
            done
        fi
        ;;
    Darwin*)
        ok "macOS detected — PaddlePaddle ships arm64/x86_64 wheels; no system libs needed."
        ;;
esac

# ── 2. Backend venv + Python deps ────────────────────────────────────
step "Setting up backend virtualenv"

if [[ ! -d "${VENV_DIR}" ]]; then
    python3 -m venv "${VENV_DIR}"
    ok "Created venv at ${VENV_DIR#${REPO_ROOT}/}"
else
    ok "Reusing existing venv at ${VENV_DIR#${REPO_ROOT}/}"
fi

# Use the venv's interpreter and pip directly rather than relying on
# `source activate` PATH manipulation. On macOS with a Homebrew-first
# .zshrc, `source activate` can be silently re-shadowed by the login
# hooks so `python3` ends up resolving to /opt/homebrew/bin/python3 —
# which is missing every package we just installed. Explicit paths are
# immune.
VENV_PY="${VENV_DIR}/bin/python3"
VENV_PIP="${VENV_DIR}/bin/pip"

step "Installing Python dependencies (this can take 5-10 minutes — PaddlePaddle is ~1 GB)"
"${VENV_PIP}" install --upgrade pip wheel setuptools >/dev/null
"${VENV_PIP}" install -r "${BACKEND_DIR}/requirements.txt"
ok "Backend dependencies installed"

# Verify the OCR stack actually imports before we call it a day. This
# catches missing system libs (libGL/libgomp) that only surface at runtime.
step "Verifying OCR stack"
"${VENV_PY}" -c "
import sys
try:
    import cv2
    print(f'  cv2 (opencv-python-headless) {cv2.__version__}')
    import numpy as np
    print(f'  numpy {np.__version__}')
    import paddle
    print(f'  paddlepaddle {paddle.__version__}')
    from paddleocr import PaddleOCR
    print(f'  paddleocr imported OK')
except ImportError as e:
    print(f'  IMPORT FAILED: {e}', file=sys.stderr)
    print('  → Check the system-package warning above; on Linux you likely need:', file=sys.stderr)
    print('    sudo apt install -y libgomp1 libgl1 libglib2.0-0', file=sys.stderr)
    sys.exit(1)
"
ok "OCR stack imports cleanly"

# Optional embedder for the local RAG backend. Heavy (~2 GB with torch)
# so we ask before installing. Users on OpenAI embeddings don't need it.
if [[ "${INSTALL_SBERT:-}" == "1" ]]; then
    step "Installing sentence-transformers (local RAG embedder)"
    "${VENV_PIP}" install "sentence-transformers>=2.7.0"
    ok "sentence-transformers installed"
else
    warn "sentence-transformers not installed (adds ~2 GB with torch)."
    printf "      Local RAG needs it. Rerun with ${DIM}INSTALL_SBERT=1 ./native-build.sh${RESET}\n"
    printf "      Or set ${DIM}rag_config.embedder.provider: 'openai'${RESET} in local.yml.\n"
fi

# ── 3. Frontend deps ─────────────────────────────────────────────────
step "Installing frontend dependencies"

pushd "${FRONTEND_DIR}" >/dev/null
if [[ -f package-lock.json ]]; then
    npm ci --no-audit --loglevel error
else
    npm install --no-audit --loglevel error
fi
popd >/dev/null
ok "Frontend dependencies installed"

# ── 4. Config bootstrap ──────────────────────────────────────────────
step "Bootstrapping config"

if [[ ! -f "${CONFIG_DIR}/local.yml" ]]; then
    cp "${CONFIG_DIR}/local.yml.example" "${CONFIG_DIR}/local.yml"
    ok "Copied local.yml.example → local.yml"
    warn "Edit ${CONFIG_DIR#${REPO_ROOT}/}/local.yml before running:"
    printf "      • jwt_config.secret_key → local dev fallback is included; export ${DIM}JWT_SECRET_KEY${RESET} for shared/deployed use\n"
    printf "      • google_auth.client_id / client_secret → from Google Cloud Console\n"
    printf "      • openaiconfig.openai_url + set ${DIM}OPENAI_API_KEY${RESET} env var\n"
    printf "      • dbConfig.mariadbConnectionString → your MariaDB\n"
    printf "      • rmqConfig.hosts → your RabbitMQ\n"
else
    ok "local.yml already exists — leaving untouched"
fi

# ── Done ─────────────────────────────────────────────────────────────
printf "\n${BOLD}${GREEN}✓ Build complete.${RESET}\n\n"
printf "Next steps:\n"
printf "  1. Start MariaDB + RabbitMQ (or run: ${DIM}docker compose up -d mariadb rabbitmq${RESET})\n"
printf "  2. Verify secrets in ${DIM}blancService/atm/config/local.yml${RESET}\n"
printf "  3. Run the stack: ${DIM}./native-run.sh${RESET}\n\n"
