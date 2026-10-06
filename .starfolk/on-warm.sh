#!/bin/bash
# On-warm for documenso: bring a fresh Starfolk box to a state where work can start.
#
# Runs before anyone is assigned, as `agent`, in a login shell, with this
# environment's secrets in the environment. Keep it under three minutes and
# keep it idempotent: every step is safe to re-run on the same box.
#
# When it finishes:
#   - Node 24 (engines.node) is the box default via mise
#   - dependencies are installed and the Prisma client generated
#   - Postgres (:54320), Redis (:63790) and Inbucket (:9000 UI, :2500 SMTP) are up
#   - the database is migrated and seeded (example@documenso.com / admin@documenso.com)
#   - the Remix dev server is running on :3000, reachable through the Starfolk proxy
#
# Deliberately not started (see the PR for why): gotenberg (DOCX conversion, ~3 min
# image build) and minio (S3 transport; the image is no longer on Docker Hub).
set -euo pipefail

log() { echo "[on-warm] $(date +%H:%M:%S) $*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE=(docker compose -f docker/development/compose.yml)
DEV_LOG="$HOME/.starfolk/logs/documenso-dev.log"
APP_PORT=3000
STARFOLK_PROXY_HOSTS=".proxy.starfolk.ai,.proxy.starfolk.io,.proxy.starfolk.dev"

# ---------------------------------------------------------------------------
log "selecting node 24"
# The image defaults to an older Node; package.json requires >=24 (CI uses 24.x).
mise install --yes node@24
mise use --global --yes node@24
eval "$(mise activate bash --shims)"
hash -r
log "node $(node --version), npm $(npm --version)"

# ---------------------------------------------------------------------------
log "starting service containers"
# `--wait` blocks until each container's healthcheck passes.
"${COMPOSE[@]}" up -d --wait database redis inbucket

# ---------------------------------------------------------------------------
log "writing .env"
if [ ! -f .env ]; then
    cp .env.example .env
    # Listen beyond loopback and accept the Starfolk proxy's hostnames. The proxy
    # hostname is assignment-specific, so the app derives its public origin per
    # request from X-Forwarded-Host rather than from NEXT_PUBLIC_WEBAPP_URL,
    # which stays at localhost for background jobs and ordinary laptop use.
    sed -i \
        -e "s/^HOST=.*/HOST=0.0.0.0/" \
        -e "s/^NEXT_PRIVATE_DEV_ALLOWED_HOSTS=.*/NEXT_PRIVATE_DEV_ALLOWED_HOSTS=${STARFOLK_PROXY_HOSTS}/" \
        -e "s/^NEXT_PRIVATE_TRUSTED_PROXY_HOSTS=.*/NEXT_PRIVATE_TRUSTED_PROXY_HOSTS=${STARFOLK_PROXY_HOSTS}/" \
        .env
else
    log ".env already exists, leaving it alone"
fi

# ---------------------------------------------------------------------------
# `npm ci` deletes node_modules first, so skip it when the lockfile hasn't changed
# since the last install (a re-run would otherwise pull it out from under a
# running dev server).
LOCK_STAMP="node_modules/.on-warm-lock-sha"
lock_sha="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ -f "$LOCK_STAMP" ] && [ "$(cat "$LOCK_STAMP")" = "$lock_sha" ]; then
    log "dependencies already installed for this lockfile"
else
    log "installing dependencies"
    HUSKY=0 npm ci --no-audit --no-fund
    echo "$lock_sha" > "$LOCK_STAMP"
fi

log "generating prisma client"
npm run prisma:generate

log "applying migrations"
npm run prisma:migrate-deploy

# The seed is not idempotent (it creates users unconditionally), so only run it
# against an empty database.
seeded_users="$("${COMPOSE[@]}" exec -T database \
    psql -U documenso -d documenso -tAc "SELECT count(*) FROM \"User\" WHERE email = 'example@documenso.com'")"
if [ "$seeded_users" = "0" ]; then
    log "seeding database"
    npm run prisma:seed
else
    log "database already seeded"
fi

# ---------------------------------------------------------------------------
app_status() {
    curl -s -o /dev/null -w '%{http_code}' --max-time 60 "http://127.0.0.1:${APP_PORT}/signin" || true
}

if [ "$(app_status)" = "200" ]; then
    log "dev server already running on :${APP_PORT}"
else
    log "starting dev server on :${APP_PORT} (log: ${DEV_LOG})"
    mkdir -p "$(dirname "$DEV_LOG")"
    # setsid detaches it from this script so it outlives on-warm.
    setsid nohup npm run dev > "$DEV_LOG" 2>&1 < /dev/null &

    # The first request compiles the app; waiting for it here means the first
    # page load in a session doesn't pay for it.
    for _ in $(seq 1 90); do
        if [ "$(app_status)" = "200" ]; then
            break
        fi
        sleep 2
    done

    if [ "$(app_status)" != "200" ]; then
        log "dev server did not come up; last lines of ${DEV_LOG}:"
        tail -n 40 "$DEV_LOG" >&2
        exit 1
    fi
fi

log "ready: app http://127.0.0.1:${APP_PORT}, mail http://127.0.0.1:9000"
