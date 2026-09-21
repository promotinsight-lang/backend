#!/usr/bin/env bash
set -Eeuo pipefail

BRANCH="${DEPLOY_BRANCH:-main}"
FRONTEND_DIR="${FRONTEND_DIR:-/var/www/frontend/frontend}"
BACKEND_DIR="${BACKEND_DIR:-/var/www/backend}"
PUBLIC_DIR="${PUBLIC_DIR:-/var/www/html}"
PM2_APP="${PM2_APP:-promot-backend}"
LOCK_FILE="${LOCK_FILE:-/tmp/promotinsight-deploy.lock}"

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another deployment is already running."
  exit 1
fi

log "Deploying frontend from $FRONTEND_DIR"
git -C "$FRONTEND_DIR" pull origin "$BRANCH"
npm --prefix "$FRONTEND_DIR" ci
npm --prefix "$FRONTEND_DIR" run build

log "Publishing frontend to $PUBLIC_DIR"
run_root mkdir -p "$PUBLIC_DIR"
run_root rm -rf "$PUBLIC_DIR"/*
run_root cp -a "$FRONTEND_DIR/dist/." "$PUBLIC_DIR/"
run_root nginx -t
run_root systemctl reload nginx

log "Deploying backend from $BACKEND_DIR"
git -C "$BACKEND_DIR" pull origin "$BRANCH"
npm --prefix "$BACKEND_DIR" ci --omit=dev
pm2 restart "$PM2_APP" --update-env
pm2 save

log "Deployment completed successfully."
