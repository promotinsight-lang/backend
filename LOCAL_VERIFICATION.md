# Local backend verification

## Configure a local environment

Copy `.env.example` to `.env` and fill in values for your local environment. Never commit `.env` or real credentials.

```powershell
Copy-Item .env.example .env
```

The backend requires one database configuration to start:

- `DATABASE_URL`, or
- all of `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, and `DB_PORT`.

`JWT_SECRET` is required for authentication. In production, set `JWT_RESET_SECRET` (or the supported legacy name `PASSWORD_RESET_SECRET`) separately for password-reset tokens. Set `NODE_ENV`, `PORT`, and `CORS_ORIGINS` for the intended local setup.

Run the backend with:

```powershell
cd backend
npm.cmd start
```

## Optional services

- `RESEND_API_KEY` enables registration OTP, password-reset email, and contact-support email. Without it, those endpoints return HTTP 503 with a controlled message; the server still starts when its required database and auth configuration is present.
- `FIREBASE_SERVICE_ACCOUNT_JSON` and, when needed, `FIREBASE_PROJECT_ID` enable Firebase/social-login token verification.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` are required for backend blog-image uploads.
- `PROXYCHECK_API_KEY` enables production VPN/proxy checks. Without it, that external check is skipped with a safe warning.

## Manual browser/API checklist

Use isolated buyer, seller, and admin test users with a test database. Do not use production accounts or credentials.

- Register a new user, log in, refresh, and verify the HttpOnly-cookie session remains active.
- Log out and verify the cookie session and frontend user state clear.
- Confirm buyer, seller, and admin users each reach only their appropriate dashboard.
- Confirm protected APIs authenticate through the cookie; browser storage must contain no JWT/auth token and frontend requests must not send an `Authorization: Bearer` token.
- As a buyer, confirm product listings omit `seller_email` and `seller_wallet_balance`.
- As a seller, confirm own product details are available and another seller's private product endpoint returns 403.
- As an admin, confirm full product details are available.
- With `RESEND_API_KEY` configured, send a valid contact-support message; verify invalid email and overlong message rejection, escaped HTML/script input, and rate limiting after repeated requests. Without it, verify the controlled 503 response instead.
- As a seller, submit a product with a public HTTPS image URL and confirm it displays. Confirm `http://`, `localhost`, private IP, `javascript:`, `data:`, and `file:` image URLs are rejected.
