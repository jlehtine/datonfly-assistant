# Installation Guide

## Prerequisites

- **Node.js** 22+
- **pnpm** 10+
- **Docker** and **Docker Compose** (for PostgreSQL, Qdrant, TEI)

## Quick Start (Local Development)

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env
# Edit .env — at minimum set ANTHROPIC_API_KEY

# Start infrastructure services
docker compose up -d

# Build all packages
pnpm build

# Start backend and frontend
pnpm start          # backend on :3000
pnpm dev            # frontend on :5173 (in another terminal)
```

By default, `AUTH_MODE=fake` is used — no login is required for local
development.

## Authentication

Datonfly Assistant supports two authentication modes, controlled by the
`AUTH_MODE` environment variable:

| Mode   | Use case                  | Login required? |
| ------ | ------------------------- | --------------- |
| `fake` | Local development, E2E CI | No              |
| `oidc` | Production                | Yes             |

### Fake Mode (`AUTH_MODE=fake`)

The default. A hardcoded dev user is automatically authenticated on every
request. No OIDC provider is needed.

Optional configuration:

```env
FAKE_USER_EMAIL=dev@localhost
FAKE_USER_NAME=Dev User
```

### OIDC Mode (`AUTH_MODE=oidc`)

Uses OpenID Connect Authorization Code flow with PKCE. Any standards-compliant
OIDC provider works (Google, Azure AD, Keycloak, Auth0, etc.).

Required environment variables:

```env
AUTH_MODE=oidc
OIDC_ISSUER_URL=https://accounts.google.com
OIDC_CLIENT_ID=your-client-id.apps.googleusercontent.com
OIDC_CLIENT_SECRET=your-client-secret
OIDC_REDIRECT_URI=http://localhost:3000/auth/callback
JWT_SECRET=a-strong-random-secret
```

- **`OIDC_ISSUER_URL`** — The OIDC provider's issuer URL. The backend performs
  [discovery](https://openid.net/specs/openid-connect-discovery-1_0.html)
  automatically (`/.well-known/openid-configuration`).
- **`OIDC_CLIENT_ID`** / **`OIDC_CLIENT_SECRET`** — OAuth 2.0 client
  credentials.
- **`OIDC_REDIRECT_URI`** — Must match the redirect URI registered with the
  provider. For local dev: `http://localhost:3000/auth/callback`.
- **`JWT_SECRET`** — Secret used to sign session JWTs. Auto-generated if omitted
  but should be set explicitly in production for persistent sessions across
  restarts.
- **`OIDC_ALLOWED_EMAIL_DOMAIN`** _(optional)_ — If set, only users whose email
  address ends with `@<domain>` are allowed to log in (e.g. `example.com`).
  Useful when the identity provider cannot restrict sign-ins to a single
  organization.

---

## Google Cloud OIDC Setup

### 1. Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.

### 2. Configure the OAuth consent screen

1. Navigate to **APIs & Services → OAuth consent screen**.
2. Choose **External** user type (or **Internal** for Google Workspace orgs).
3. Fill in the required fields:
   - **App name**: Datonfly Assistant
   - **User support email**: your email
   - **Developer contact**: your email
4. Add scopes: `openid`, `email`, `profile`.
5. Add test users if the app is in "Testing" publishing status.

### 3. Create OAuth 2.0 credentials

1. Navigate to **APIs & Services → Credentials**.
2. Click **Create Credentials → OAuth client ID**.
3. Select **Web application**.
4. Set:
   - **Name**: Datonfly Assistant (local) — or any label
   - **Authorized JavaScript origins**:
     - `http://localhost:5173` (local development — Vite dev server)
     - `https://your-domain.com` (production)
   - **Authorized redirect URIs**:
     - `http://localhost:3000/auth/callback` (local development)
     - `https://your-domain.com/auth/callback` (production)
5. Click **Create** and note the **Client ID** and **Client Secret**.

### 4. Configure environment

```env
AUTH_MODE=oidc
OIDC_ISSUER_URL=https://accounts.google.com
OIDC_CLIENT_ID=123456789-abc.apps.googleusercontent.com
OIDC_CLIENT_SECRET=GOCSPX-...
OIDC_REDIRECT_URI=http://localhost:3000/auth/callback
JWT_SECRET=$(openssl rand -base64 32)
```

### 5. Verify

```bash
pnpm build && pnpm start
```

Open `http://localhost:5173` — you should be redirected to Google's login page.
After signing in, you'll be returned to the app authenticated.

---

## End-to-End Tests

E2E tests use `AUTH_MODE=fake` (the default), so no OIDC setup is needed:

```bash
# Start backend + frontend, then:
pnpm test:e2e
```
