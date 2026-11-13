# MahiDrive architecture

## 1. Product boundary

MahiDrive is a personal, single-owner storage console. It is not a public file-sharing service and does not provide accounts for friends, guests, teams, or other tenants.

The browser UI must never call Google Drive with a long-lived credential. Privileged operations run through an authenticated server endpoint.

## 2. Service layout

| Layer | Responsibility |
| --- | --- |
| Web client | Responsive file manager, previews, upload queue, storage overview |
| Application server | Owner checks, Google OAuth callbacks, Drive API calls, upload orchestration |
| Supabase Auth | Owner sign-in and session management |
| Supabase Postgres | Account metadata, file index, sync cursors, upload jobs, audit events |
| Google Drive API | Actual file bytes, folders, quota, changes and file metadata |

MahiDrive must use a dedicated Supabase project. Do not reuse Mahi-Repair's or MahiCloud's database.

## 3. Five independent Google Drive connections

Each slot is an independent Google identity and OAuth grant:

- Slots 1–5 are separate connections.
- Each connection has its own Google subject ID, email, OAuth grant, refresh-token record, quota and sync cursor.
- The server must never assume every account has 15 GB. Read `storageQuota.limit` and `storageQuota.usage` from the Drive API.
- Store `storage_account_id` with every indexed file and every upload job.
- A disconnected or revoked account must be marked unavailable; do not silently remap or delete its files.

MahiDrive can show a combined view, but the Google accounts remain separate storage destinations. The combined capacity is an application-level total, not a pooled Google quota.

## 4. Google OAuth access modes

Start with the narrow `drive.file` scope and Google Picker for files created by MahiDrive or explicitly selected/opened by the owner.

That scope does **not** grant unrestricted access to every pre-existing file in an account. Full-drive browsing and management requires a broader Drive scope (for example `drive` or `drive.readonly`). Google classifies these as restricted scopes; verification requirements apply, and server-side storage/transmission of restricted-scope data can require a security assessment. Do not enable a broad scope until the product's access needs and Google's current verification requirements are reviewed.

OAuth is performed independently for each of the five storage accounts. Use a server-side authorization-code flow, validate the state/nonce, and request offline access only when required for background sync. Refresh tokens are encrypted before persistence.

## 5. File placement and safety

- Upload routing must check each account's live available quota and whether the individual file fits.
- Select a target account by a documented policy (initially, the account with the most available space that can fit the file).
- Keep the chosen account ID on the upload job and resulting file record.
- Use resumable uploads for large files and idempotency keys for retry safety.
- Never report success until Google confirms the upload and the resulting file metadata has been verified.
- Cross-account move is a copy-verify-delete workflow: copy to the destination, verify size/checksum where available, then offer deletion of the source. It is not an atomic operation.
- A disconnected account must not make indexed files appear deleted.

## 6. Metadata model

The initial database design should include:

- `owner_access`: the single permitted owner identity and active status.
- `storage_accounts`: at most five Google connections, with account identity and live quota metadata only.
- `drive_files`: indexed file/folder metadata, parent ID, MIME type, size, checksums, modified time, starred/trash state and source account.
- `upload_jobs`: resumable upload state, progress, retry count and idempotency key.
- `sync_state`: one Drive changes cursor per storage account.
- `activity_events`: owner-visible audit trail with secrets and file contents excluded.
- `private.google_oauth_tokens`: encrypted token material, not exposed through the public Data API.

Use ownership-aware RLS on every exposed table. Server-only token storage belongs in a non-exposed schema with access restricted to the backend role.

## 7. Authentication and authorization

Supabase Auth establishes the app session. A server-side owner allowlist and database owner record decide whether that identity may use MahiDrive. Hiding a page or button is not authorization. Every API endpoint must validate the session and owner status before doing work.

Do not use user-editable profile metadata as an authorization source.

## 8. Current prototype boundary

`MahiDrive.html` is preserved as the UI prototype. It currently contains demo data and simulated transfer progress. Replace demo data paths with server APIs incrementally; do not imply that prototype-only interactions are connected to Google Drive.
