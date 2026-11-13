# MahiDrive configuration checklist

MahiDrive's dedicated Supabase backend has been provisioned. No Mahi-Repair or MahiCloud project is used.

## 1. Project and owner

- Supabase project ref: `ymfsjqobgefiagenaibi`
- Region: Mumbai (`ap-south-1`)
- Project URL: https://ymfsjqobgefiagenaibi.supabase.co
- Owner: `mahimahfud@gmail.com`
- Edge Function: `mahidrive-api`, deployed and active (version 5)
- Database: private `mahidrive` schema; all six tables have RLS enabled; `anon` and `authenticated` have no table access. Server-side function uses the injected Supabase secret key.

## 2. Serve the HTML

Serve these files from the same HTTPS origin. With this repository's GitHub Pages project site, the expected page URL is `https://mahimahfud-ui.github.io/MahiDrive/MahiDrive.html` once Pages is enabled. Add that exact page URL to Supabase Auth URL Configuration / Redirect URLs.\n\nServe these files:

- `MahiDrive.html`
- `mahidrive-config.js`
- `mahidrive-app.js`

The HTML loads Supabase JS v2.119.0 and the two local scripts. Enable GitHub Pages or deploy the three files to a static HTTPS host. Then add the exact origin/page to Supabase Auth URL Configuration / Redirect URLs.

Supabase Dashboard: https://supabase.com/dashboard/project/ymfsjqobgefiagenaibi

## 3. Add Supabase Edge Function secrets

Open https://supabase.com/dashboard/project/ymfsjqobgefiagenaibi/functions/secrets and add:

| Secret name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth Web application client ID from Google Cloud |
| `GOOGLE_CLIENT_SECRET` | OAuth Web application client secret |
| `GOOGLE_REDIRECT_URI` | `https://ymfsjqobgefiagenaibi.supabase.co/functions/v1/mahidrive-api/oauth/callback` |
| `MAHIDRIVE_OAUTH_STATE_SECRET` | Random secret, at least 32 characters (generate with `openssl rand -hex 32`) |
| `MAHIDRIVE_TOKEN_ENCRYPTION_KEY` | Base64 encoding of exactly 32 random bytes (generate with `openssl rand -base64 32`) |

Supabase injects its project URL and server secret-key environment into Edge Functions. Do not put those secrets into `mahidrive-config.js`, the browser, or Git.

## 4. Create the Google OAuth client

1. Open https://console.cloud.google.com/ and create/select a dedicated MahiDrive project.
2. Enable **Google Drive API**.
3. Configure the OAuth consent screen and add `mahimahfud@gmail.com` as a test user while the app is in Testing.
4. Create an OAuth Client ID with application type **Web application**.
5. Add this exact Authorized redirect URI:

   `https://ymfsjqobgefiagenaibi.supabase.co/functions/v1/mahidrive-api/oauth/callback`

6. Copy its Client ID and Client Secret into the Supabase Edge Function secrets above.
7. Start with `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/drive.file`.

The current app intentionally uses `drive.file`: MahiDrive can access files it creates or files explicitly selected/opened by the owner. Google Picker integration has not yet been added, so files already in Drive may not appear. Do not advertise full-drive access with this scope.

Broader Drive access scopes can be restricted and may require Google verification and a security assessment. Review Google's current scope requirements before requesting them.

## 5. Supabase Auth URL and sign-in

- Keep the existing confirmed Owner user `mahimahfud@gmail.com`.
- The HTML sends an email magic link with `shouldCreateUser: false`; no sign-up flow is offered in the app.
- Add the deployed static page URL to Supabase Auth URL Configuration / Redirect URLs.
- Confirm the Email provider is enabled.
- Every API call validates the user session and matches its user ID and email to the single Owner record. A signed-in non-owner is rejected.

If Supabase's project-wide signup setting is still enabled, disable public sign-ups in Authentication settings as an additional safeguard. The API owner check remains mandatory regardless.

## 6. What is connected and what is pending

Already provisioned and deployed:
- Owner record and verified Supabase Auth identity.
- Private database schema, five disconnected Google account slots and owner-only Edge Function API.
- HTML client files wired to Supabase Auth and API routes.
- Server-side token encryption code, Google OAuth callback and resumable upload proxy.

Pending until secrets are added and OAuth is tested:
- Real Google account consent and all five account connections.
- Google Picker for explicitly selecting existing Drive files.
- Cross-account copy/verify/delete transfer workflow.
- Google Workspace document export/preview and encrypted private vault.
- Production hosting and end-to-end smoke tests for sign-in, upload, download, retry and account revocation.

Do not store important files until real Google OAuth and transfer tests pass.
