#!/usr/bin/env bash
# Container entrypoint for the blancService.
#
# All configuration lives in /app/atm/config/docker.yml, which
# docker-compose.yml mounts from the host at
# `./blancService/atm/config/docker.yml`. The image itself does NOT
# ship a docker.yml — the mount is the source of truth.
#
# We point ATM_CONFIG_PATH at that file and let atm.config_parsers
# do the rest.
set -euo pipefail

CONFIG_FILE=/app/atm/config/docker.yml

if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "✗ Config file not found at $CONFIG_FILE" >&2
    echo "" >&2
    echo "  On the host:" >&2
    echo "    cp blancService/atm/config/docker.yml.example \\" >&2
    echo "       blancService/atm/config/docker.yml" >&2
    echo "  then edit docker.yml (OpenAI key, JWT secret, etc.) and" >&2
    echo "  re-run: docker compose up --build" >&2
    exit 1
fi

# Cheap sanity checks — catches the "user copied the .example and
# forgot to edit it" case with a helpful message instead of a
# cryptic runtime error 30 seconds later.
if grep -q '"sk-REPLACE_ME"' "$CONFIG_FILE"; then
    echo "✗ openaiconfig.api_key still holds the placeholder sk-REPLACE_ME." >&2
    echo "  Edit $CONFIG_FILE and paste your real key." >&2
    exit 1
fi

if grep -q 'CHANGE_ME_to_a_48_char' "$CONFIG_FILE"; then
    echo "✗ jwt_config.secret_key is still the placeholder." >&2
    echo "  Generate one with:" >&2
    echo "    python3 -c 'import secrets; print(secrets.token_urlsafe(48))'" >&2
    echo "  then paste it into $CONFIG_FILE." >&2
    exit 1
fi

export ATM_CONFIG_PATH="$CONFIG_FILE"
export ENV=docker

echo "✓ Config loaded from $CONFIG_FILE"
echo "✓ Starting blancService"

exec "$@"
