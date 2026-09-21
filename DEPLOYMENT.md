# Production Deployment

This repo contains the one-command deployment script for both PromotInsight frontend and backend.

## Server One-Command Deploy

Run this on the DigitalOcean server:

```bash
cd /var/www/backend
git pull origin main
chmod +x scripts/deploy-production.sh
./scripts/deploy-production.sh
```

The script runs the same deployment flow as the manual commands:

- Pulls `/var/www/frontend/frontend` from `main`
- Runs `npm ci` and `npm run build`
- Publishes `dist` to `/var/www/html`
- Tests and reloads Nginx
- Pulls `/var/www/backend` from `main`
- Runs `npm ci --omit=dev`
- Restarts `pm2` app `promot-backend`
- Saves the PM2 process list

## GitHub One-Click Deploy

The workflow is in `.github/workflows/deploy-production.yml`.

Add these GitHub repository secrets in the backend repo:

- `DO_HOST`: server IP or host
- `DO_USER`: SSH user, for example `root`
- `DO_SSH_KEY`: private SSH key that can access the server
- `DO_PORT`: optional SSH port, usually `22`

Then go to:

`GitHub backend repo -> Actions -> Deploy Production -> Run workflow`

## Optional Overrides

The script supports these environment variables:

```bash
DEPLOY_BRANCH=main
FRONTEND_DIR=/var/www/frontend/frontend
BACKEND_DIR=/var/www/backend
PUBLIC_DIR=/var/www/html
PM2_APP=promot-backend
```

Example:

```bash
PM2_APP=promot-backend ./scripts/deploy-production.sh
```
