#!/usr/bin/env bash
# Launch the Next.js standalone server (see next.config.ts → output: 'standalone').
#
# Reads PORT from the environment; defaults to 3000 when unset (so the
# container works without a privileged --cap-add). Set PORT=80 outside
# the container if you need it — the Dockerfile runs as non-root so the
# container itself can't bind <1024.
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

# When installed via `docker build`, server.js sits at /app/server.js
# (COPY'd from .next/standalone/). Native builds run it from the
# source tree via `npm start` — this script is docker-only.
exec node server.js
