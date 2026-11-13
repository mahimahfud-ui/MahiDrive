# MahiDrive security baseline

## Identity

- One owner only; disable public sign-up, anonymous access, invitations and multi-tenant features.
- Validate the authenticated Supabase user and owner authorization on every server endpoint.
- Use secure, HTTP-only, same-site session cookies and HTTPS in production.
- Apply rate limits to sign-in, OAuth callback and file-operation endpoints.

## Google OAuth tokens

- Keep the Google client secret and refresh tokens on the server.
- Encrypt refresh tokens with authenticated encryption (AES-256-GCM or an equivalent managed KMS envelope-encryption design).
- Keep the encryption key outside the database and source repository.
- Bind OAuth state to the initiating session; validate state on callback.
- Never put access tokens, refresh tokens, authorization codes or raw token responses in logs.
- Revoke the provider grant and delete encrypted token material when an account is explicitly disconnected; preserve its file index until the owner chooses a cleanup operation.

## Database

- Enable RLS on every table in exposed schemas.
- Use explicit owner predicates, not merely `TO authenticated`.
- Keep OAuth token material in a non-exposed schema restricted to the backend service role.
- Never expose a Supabase secret/service-role key in browser code or a `NEXT_PUBLIC_*` variable.
- Authorization must not rely on user-editable `user_metadata`.
- Do not create public views or broad grants that bypass the intended row-level access model.

## File safety and privacy

- Do not create public Google Drive permissions or share links.
- Do not expose raw Google Drive file IDs as authorization credentials.
- Check owner access, account ownership and file-account mapping on every read/write.
- Use idempotency keys for retries and verify destination metadata before declaring uploads complete.
- Cross-account moves must not delete the source until destination verification succeeds.
- Record security-relevant activity without logging file contents or credentials.
- Treat previews and downloaded files as untrusted content; set safe content types and download headers.

## Release gate

Do not call MahiDrive production-ready until owner-only access, OAuth state validation, token encryption/decryption, RLS isolation, account revocation, upload retry safety, cross-account move recovery, and backup/restore tests pass against a dedicated staging project.
