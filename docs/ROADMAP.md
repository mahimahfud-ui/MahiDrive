# MahiDrive implementation roadmap

## Phase 0 — Foundation configuration

- [x] Inspect the existing repository and preserve `MahiDrive.html`.
- [x] Document the target architecture, security baseline and service setup.
- [x] Add a secret-free environment template and five-account example.
- [ ] Change repository visibility to Private.
- [ ] Select the Supabase organization and provision a dedicated MahiDrive project after reviewing cost.

## Phase 1 — Real owner authentication and database

- [ ] Implement the web application shell without losing the current UI design.
- [ ] Configure Supabase Auth for the single owner.
- [ ] Create reviewed migrations for owner access, connected accounts, file metadata, sync state, upload jobs and audit events.
- [ ] Apply and verify RLS policies and backend-only token access.

## Phase 2 — Google Drive OAuth

- [ ] Configure the Google Cloud project and Drive API.
- [ ] Implement secure per-account OAuth with state validation.
- [ ] Encrypt and persist each account's refresh token.
- [ ] Connect, refresh, revoke and reconnect each of the five account slots.
- [ ] Read live quota values from every connected account.

## Phase 3 — Real file operations

- [ ] Implement account-scoped file listing and incremental sync.
- [ ] Implement resumable uploads, verified downloads, rename, folder creation and trash/restore.
- [ ] Implement account selection based on live available capacity.
- [ ] Implement safe cross-account copy/verify/delete.
- [ ] Remove all simulated progress and demo-only success messages from production flows.

## Phase 4 — UI integration and quality

- [ ] Connect the existing interface to real server endpoints.
- [ ] Validate desktop and mobile layouts.
- [ ] Add error recovery, empty/loading states and accessibility checks.
- [ ] Test with disposable files before any personal data is used.

## Phase 5 — Production readiness

- [ ] Complete security review and backups.
- [ ] Verify Google OAuth scope and verification requirements.
- [ ] Run end-to-end tests for account disconnect, token revocation, large uploads and interrupted transfers.
- [ ] Configure HTTPS, secrets, monitoring and recovery procedures.
- [ ] Publish only after all release gates pass.
