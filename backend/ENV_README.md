# Environment Variables Setup Guide

Copy `.env.example` to `.env` and fill in the values below. This guide walks you through getting every single one.

```bash
cp .env.example .env
```

---

## `BACKEND_PORT`

The port the backend server runs on. The default is fine — only change it if something else is already using port 8324.

```
BACKEND_PORT=8324
```

---

## `GOOGLE_OAUTH_CLIENT_ID` & `GOOGLE_OAUTH_CLIENT_SECRET`

These let users sign in with their Google account.

### Step 1 — Go to Google Cloud Console

1. Open https://console.cloud.google.com/
2. Sign in with your Google account (or create one).

### Step 2 — Create a project

1. Click the project dropdown at the very top of the page (it says "Select a project" or shows your current project name).
2. Click **New Project** in the top-right of the popup.
3. Name it something like `Maestro`.
4. Click **Create**.
5. Wait a few seconds, then click the project dropdown again and select your new `Maestro` project.

### Step 3 — Enable the Google+ API (required for OAuth)

1. In the left sidebar, click **APIs & Services** > **Library**.
2. Search for `Google+ API` (or `Google Identity`).
3. Click on it, then click **Enable**.

### Step 4 — Configure the OAuth consent screen

1. In the left sidebar, click **APIs & Services** > **OAuth consent screen**.
2. Select **External** (unless you're inside a Google Workspace org and only want internal users).
3. Click **Create**.
4. Fill in the required fields:
   - **App name**: `Maestro`
   - **User support email**: your email
   - **Developer contact email**: your email
5. Click **Save and Continue**.
6. On the **Scopes** page, click **Add or Remove Scopes**.
   - Check `email` and `profile` (the `openid` scope is added automatically).
   - Click **Update**, then **Save and Continue**.
7. On the **Test users** page, click **Add Users**, enter your own email, click **Add**, then **Save and Continue**.
8. Click **Back to Dashboard**.

### Step 5 — Create OAuth credentials

1. In the left sidebar, click **APIs & Services** > **Credentials**.
2. Click **+ Create Credentials** at the top.
3. Select **OAuth client ID**.
4. For **Application type**, select **Web application**.
5. **Name**: `Maestro` (or anything you want).
6. Under **Authorized redirect URIs**, click **+ Add URI** and add:
   ```
   http://localhost:8324/api/auth/google/callback
   ```
   (Replace `8324` with your `BACKEND_PORT` if you changed it.)
7. Click **Create**.

### Step 6 — Copy the values

A popup appears with your credentials:

- **Client ID** — copy this into `GOOGLE_OAUTH_CLIENT_ID`
- **Client Secret** — copy this into `GOOGLE_OAUTH_CLIENT_SECRET`

```
GOOGLE_OAUTH_CLIENT_ID=123456789-xxxxxxxxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxx
```

---

## `GH_TOKEN`

A GitHub Personal Access Token that lets the build script upload release artifacts to GitHub Releases.

### Step 1 — Go to GitHub token settings

1. Go to https://github.com/settings/tokens
2. Sign in if needed.

### Step 2 — Create a token

1. Click **Generate new token** > **Generate new token (classic)**.
2. **Note**: `Maestro Releases` (or whatever you want).
3. **Expiration**: pick a duration (90 days, or "No expiration" if you don't want to rotate it).
4. **Scopes**: check the **`repo`** checkbox (this gives full access to your repositories, which is needed to create releases and upload assets).
5. Click **Generate token** at the bottom.
6. **Copy the token now** — it starts with `ghp_` and you won't be able to see it again.

```
GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Final `.env` example

```
BACKEND_PORT=8324

GOOGLE_OAUTH_CLIENT_ID=123456789-xxxxxxxxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxx

GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Running a production build

Once your `.env` is filled in, just run:

```powershell
pwsh scripts/build-app-win.ps1 -Publish
```

The build script automatically loads `backend/.env`, so you don't need to source it yourself. This builds the Windows app, signs it (Azure Trusted Signing), and uploads the installer + `latest.yml` to a GitHub Release. Windows is the only shipped target; macOS was dropped and its pipeline deleted, so the Apple signing/notarization variables that used to be documented here are gone.
