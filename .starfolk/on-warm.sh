#!/bin/bash
# On-warm for documenso: bring a fresh Starfolk box to a state where work can start.
#
# Runs before anyone is assigned, as `agent`, in a login shell, with this
# environment's secrets in the environment. Keep it under three minutes and
# keep it idempotent.
#
# When it finishes:
#   - Postgres (54320), Inbucket (9000 web / 2500 smtp), Redis (63790) and
#     Gotenberg (3005) are up via docker/development/compose.yml
#   - the database is migrated and seeded (example@documenso.com / password)
#   - the Remix dev server is listening on :3000, log in $DEV_LOG
set -euo pipefail

log() { echo "[on-warm] $(date -u +%H:%M:%S) $*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE=(docker compose -f docker/development/compose.yml)
# MinIO is left out: its images are no longer published on Docker Hub, and the
# default NEXT_PUBLIC_UPLOAD_TRANSPORT ("database") does not need it.
SERVICES=(database inbucket redis gotenberg)
DEV_PORT=3000
DEV_LOG="$HOME/.devbox/logs/documenso-dev.log"
PROXY_HOSTS=".proxy.starfolk.ai,.proxy.starfolk.io,.proxy.starfolk.dev"

export HUSKY=0

log "node: ensuring Node 24 (package.json engines: node >=24, npm >=11.17)"
mise use -g node@24 >/dev/null
eval "$(mise env -s bash)"
hash -r
log "node $(node -v), npm $(npm -v)"

# Pulls and the Gotenberg image build take about a minute on a fresh box, so
# run them alongside the npm install.
log "services: starting ${SERVICES[*]} in the background"
compose_log="$(mktemp)"
"${COMPOSE[@]}" up -d --wait "${SERVICES[@]}" >"$compose_log" 2>&1 &
compose_pid=$!

log "env: .env and .env.local"
if [ ! -f .env ]; then
    cp .env.example .env
fi
# Serve the app from Starfolk's per-box proxy hosts as well as localhost.
if ! grep -q '^NEXT_PRIVATE_ALLOWED_PROXY_HOSTS=' .env.local 2>/dev/null; then
    echo "NEXT_PRIVATE_ALLOWED_PROXY_HOSTS=\"$PROXY_HOSTS\"" >>.env.local
fi
# The proxy connects over the box's network interface, not loopback.
if ! grep -q '^DEV_SERVER_HOST=' .env.local 2>/dev/null; then
    echo 'DEV_SERVER_HOST="0.0.0.0"' >>.env.local
fi

# `npm ci` wipes node_modules, so skip it when the lockfile and Node version
# match what the last run installed.
stamp_file="node_modules/.on-warm-stamp"
stamp="$(node -v) $(sha256sum package-lock.json | cut -d' ' -f1)"
if [ -f "$stamp_file" ] && [ "$(cat "$stamp_file")" = "$stamp" ]; then
    log "deps: node_modules matches package-lock.json, skipping npm ci"
else
    log "deps: npm ci"
    npm ci --no-audit --no-fund
    echo "$stamp" >"$stamp_file"
fi

# dotenv gives .env precedence over .env.local, so check the value that wins.
effective="$(npx --no-install dotenv -e .env -e .env.local -p NEXT_PRIVATE_ALLOWED_PROXY_HOSTS 2>/dev/null || true)"
if [ -z "$effective" ]; then
    echo "[on-warm] NEXT_PRIVATE_ALLOWED_PROXY_HOSTS is empty after loading .env and .env.local;" \
        "remove the empty entry from .env so the proxy hosts in .env.local apply" >&2
    exit 1
fi

log "prisma: generate"
npm run prisma:generate >/dev/null

log "translations: compile"
npm run translate:compile >/dev/null

log "services: waiting for ${SERVICES[*]} to be healthy"
if ! wait "$compose_pid"; then
    cat "$compose_log" >&2
    echo "[on-warm] docker compose failed" >&2
    exit 1
fi
rm -f "$compose_log"

log "database: migrate"
npm run prisma:migrate-deploy >/dev/null

log "database: seed (no-op when the seed users exist)"
npm run prisma:seed >/dev/null

if curl -fsS -o /dev/null "http://127.0.0.1:$DEV_PORT/signin" 2>/dev/null; then
    log "dev server: already running on :$DEV_PORT"
else
    log "dev server: starting on :$DEV_PORT (log: $DEV_LOG)"
    mkdir -p -m 0700 "$(dirname "$DEV_LOG")"
    setsid nohup npm run dev >"$DEV_LOG" 2>&1 </dev/null &

    # The first request compiles the app; make it here rather than in someone's
    # first session.
    for _ in $(seq 1 90); do
        if curl -fsS -o /dev/null "http://127.0.0.1:$DEV_PORT/signin" 2>/dev/null; then
            break
        fi
        sleep 2
    done
    if ! curl -fsS -o /dev/null "http://127.0.0.1:$DEV_PORT/signin"; then
        tail -50 "$DEV_LOG" >&2
        echo "[on-warm] dev server did not come up on :$DEV_PORT" >&2
        exit 1
    fi
fi

log "ready: http://127.0.0.1:$DEV_PORT (sign in as example@documenso.com / password)"
