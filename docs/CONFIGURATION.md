# MahiDrive configuration checklist

This document separates repository setup from provisioning external services. No secret values belong in Git.

## A. GitHub repository

1. Open the repository Settings.
2. Change visibility from Public to **Private** before adding private implementation details.
3. Keep `.env.example` tracked; keep `.env.local` and all real credentials untracked.
4. Protect `main` and use pull requests for implementation work.

Repository settings: https://github.com/mahimahfud-ui/MahiDrive/settings

## B. Supabase

MahiDrive needs its own Supabase project. It must not use the Mahi-Repair project or the MahiCloud database.

The currently connected Supabase accounts do not show a project named MahiDrive. Before creating one, select the Supabase organization and review the quoted cost. Configure Auth for one owner only, and apply the schema/RLS through reviewed migrations. Do not enable anonymous sign-in or public registration.

Supabase dashboard: https://supabase.com/dashboard

## C. Google Cloud

1. Create/select a Google Cloud project dedicated to MahiDrive.
2. Enable the Google Drive API.
3. Configure the OAuth consent screen and authorized domains.
4. Create a Web application OAuth client.
5. Add the exact local and production callback URLs. The local template is `http://localhost:3000/api/google/oauth/callback`.
6. Begin with the narrow `drive.file` access mode and a Picker-based workflow.
7. Request broader Drive scopes only after reviewing the restricted-scope verification and security-assessment requirements.

Google Cloud Console: https://console.cloud.google.com/

## D. Local environment

1. Copy `.env.example` to `.env.local`.
2. Fill the Supabase URL and publishable key from the dedicated MahiDrive project.
3. Add the Supabase secret key only to the server environment.
4. Add the Google OAuth client ID, client secret and exact callback URL.
5. Generate a 32-byte token encryption key with:

   ```bash
   openssl rand -base64 32
   ```

6. Keep the encryption key in a secret manager. Do not paste it into chat, source code, GitHub Actions logs, or a committed file.

## E. Five-account setup

- Connect accounts one at a time using the owner session.
- Record Google subject ID and verified email returned by Google; do not identify accounts only by their display label.
- Pull quota from each account's Drive API response.
- Keep each refresh token isolated and encrypted.
- Allow fewer than five accounts; the app must still work with one connected account.
- Do not claim the target total is 75 GB until live quota values have been read.

## F. Deployment

Set production environment variables in the hosting provider's secret settings. Configure the production OAuth callback URL and Supabase Auth redirect allowlist to match the deployed domain exactly. Use HTTPS. Do not enable production Google connections until owner authentication, token encryption, RLS, callback validation, and backup/restore behavior have been tested.

## Not configured by this repository change

No Supabase project has been created or modified, no Google OAuth client exists yet, and no accounts have been connected. The current HTML prototype remains demo-only.
