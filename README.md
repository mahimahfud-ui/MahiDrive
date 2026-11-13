# MahiDrive

**MahiDrive** is a private, single-owner storage console for up to five independent Google Drive accounts.

## Dedicated backend provisioned

- Supabase project: `MahiDrive` — `ymfsjqobgefiagenaibi` (Mumbai, `ap-south-1`)
- Owner identity: `mahimahfud@gmail.com` (Supabase Auth user confirmed and linked)
- Private database schema: `mahidrive`, with RLS enabled and browser roles denied direct table access
- Five Google Drive connection slots are pre-created and currently disconnected
- Applied database migrations are checked into `supabase/migrations/` with their original version identifiers
- Supabase CLI configuration records the Edge Function callback's custom JWT validation mode
- Owner-only Supabase Edge Function: `mahidrive-api` (deployed version 4)

MahiDrive is separate from Mahi-Repair and MahiCloud.

## HTML application

`MahiDrive.html` keeps the existing responsive UI and loads:

- `mahidrive-config.js` — public Supabase URL, publishable key and owner email
- `mahidrive-app.js` — owner sign-in, API client, live account/quota screens, file index, folder operations and resumable uploads
- Supabase JS v2.119.0 from a pinned CDN version

The browser contains only a Supabase **publishable** key. Supabase secret/service-role keys and Google OAuth tokens are never placed in HTML or JavaScript shipped to browsers.

## Current integrated features

- Owner-only email magic-link sign-in. The API independently checks the authenticated Supabase user against the single Owner record.
- Five Google Drive slots, with live per-account quota retrieval.
- Server-side Google OAuth authorization-code callback and AES-256-GCM refresh-token encryption.
- File/folder listing for files visible under the granted Google scope.
- Create folder, resumable upload, download, rename, copy, move within one Drive, star/unstar, trash, restore and permanent delete.
- Owner audit events and per-account connection status.

## Google OAuth setup still required

Google connections will not work until the following Edge Function secrets are entered in the Supabase Dashboard:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `MAHIDRIVE_OAUTH_STATE_SECRET`
- `MAHIDRIVE_TOKEN_ENCRYPTION_KEY`

The exact callback URI is:

`https://ymfsjqobgefiagenaibi.supabase.co/functions/v1/mahidrive-api/oauth/callback`

See [Configuration](docs/CONFIGURATION.md) for the Google Cloud and Supabase setup steps. Do not commit secret values.

## Important scope and feature boundaries

- The current OAuth scope is `drive.file`. It does not provide unrestricted browsing of every existing file in a Google Drive. It allows access to files created by MahiDrive or explicitly selected/opened by the owner. Google Picker integration is still pending.
- Full Drive access needs broader Google Drive scopes; Google classifies relevant scopes as restricted and may require app verification and a security assessment.
- Google Docs, Sheets and Slides export/preview is not implemented in this first integration.
- Cross-account transfer with copy/verify/delete recovery is not implemented yet.
- The prototype's PIN vault is disabled; it did not encrypt files. A real encrypted vault is not available yet.
- Public sharing, guest access, teams and multi-tenant accounts are intentionally disabled.

## Deploying the HTML

The repository currently contains the static HTML client. Serve `MahiDrive.html`, `mahidrive-config.js` and `mahidrive-app.js` from the same HTTPS origin. Configure that exact origin/page in Supabase Auth's URL Configuration / Redirect URLs. GitHub Pages hosting must be enabled for the repository before a Pages URL can be used.

## Not yet production-ready

Google OAuth secrets have not been configured, no Google Drive account has completed OAuth, and end-to-end upload/download flows have not yet been tested against a real Google account. Do not store important files until the remaining setup and smoke tests are complete.
