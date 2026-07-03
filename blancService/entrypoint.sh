#!/usr/bin/env bash
# Container entrypoint for the blancService.
#
# Renders /app/atm/config/docker.yml.template → docker.yml with
# `envsubst`, substituting only the vars listed below. Everything else
# in the template (YAML anchors, colons, etc.) passes through verbatim.
#
# Fail-fast if any required secret is unset.
set -euo pipefail

TEMPLATE=/app/atm/config/docker.yml.template
RENDERED=/app/atm/config/docker.yml

REQUIRED=(
    JWT_SECRET_KEY
    GOOGLE_CLIENT_ID
    GOOGLE_CLIENT_SECRET
    GOOGLE_REDIRECT_URI
    ALLOWED_DOMAIN
    FRONTEND_BASE_URL
    ADMIN_EMAIL
    MARIADB_USER
    MARIADB_PASSWORD
    MARIADB_DATABASE
    RABBITMQ_USER
    RABBITMQ_PASSWORD
)

missing=()
for var in "${REQUIRED[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        missing+=("$var")
    fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
    echo "✗ Missing required environment variables:" >&2
    for v in "${missing[@]}"; do echo "    - $v" >&2; done
    echo "" >&2
    echo "  Set them in .env (see .env.example) before running compose." >&2
    exit 1
fi

# Additional safety: refuse to boot with the placeholder JWT secret.
if [[ "$JWT_SECRET_KEY" == "CHANGE_ME"* ]] || [[ ${#JWT_SECRET_KEY} -lt 32 ]]; then
    echo "✗ JWT_SECRET_KEY looks like a placeholder or is < 32 chars." >&2
    echo "  Generate one with:" >&2
    echo "    python3 -c 'import secrets; print(secrets.token_urlsafe(48))'" >&2
    exit 1
fi

# Substitute only the vars we know about — leaves other '$foo' alone.
SUBST_VARS='$JWT_SECRET_KEY $GOOGLE_CLIENT_ID $GOOGLE_CLIENT_SECRET $GOOGLE_REDIRECT_URI $ALLOWED_DOMAIN $FRONTEND_BASE_URL $ADMIN_EMAIL $MARIADB_USER $MARIADB_PASSWORD $MARIADB_DATABASE $RABBITMQ_USER $RABBITMQ_PASSWORD'
envsubst "$SUBST_VARS" < "$TEMPLATE" > "$RENDERED"

export ATM_CONFIG_PATH="$RENDERED"
export ENV=docker

echo "✓ Config rendered to $RENDERED"
echo "✓ Starting blancService"

exec "$@"
