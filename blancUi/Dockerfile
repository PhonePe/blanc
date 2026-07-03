# ── Stage 1: build ───────────────────────────────────────────────────
FROM node:20-bookworm AS builder

WORKDIR /usr/src

# System deps for native npm modules (e.g. dnd-kit's compiled bits)
RUN apt-get update && apt-get install -y --no-install-recommends \
        make g++ curl git libssl-dev && \
    rm -rf /var/lib/apt/lists/*

# Cache-friendly: manifest first, then everything else.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
        npm ci --no-audit --loglevel error --include=optional; \
    else \
        npm install --no-audit --loglevel error --include=optional; \
    fi

COPY . .

# Next.js standalone output (see next.config.ts → output: 'standalone').
RUN npm run build && \
    cp -r .next/static .next/standalone/.next/static && \
    cp -r public .next/standalone/public

# ── Stage 2: runtime ─────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

# Non-root user
RUN useradd -r -u 10002 -m -d /home/atmui atmui

# Copy just the standalone bundle — everything the server needs.
COPY --from=builder --chown=atmui:atmui /usr/src/.next/standalone ./
COPY --from=builder --chown=atmui:atmui /usr/src/run.sh /app/run.sh
RUN chmod +x /app/run.sh

USER atmui

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

ENTRYPOINT ["/app/run.sh"]
