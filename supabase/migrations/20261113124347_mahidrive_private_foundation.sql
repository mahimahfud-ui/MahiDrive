create schema if not exists mahidrive;
comment on schema mahidrive is 'Private server-only schema for the single-owner MahiDrive application. Never expose this schema through the Supabase Data API.';

revoke all on schema mahidrive from public, anon, authenticated;
grant usage on schema mahidrive to service_role;

create table mahidrive.owner_settings (
  singleton boolean primary key default true check (singleton),
  owner_user_id uuid unique references auth.users(id) on delete restrict,
  owner_email text,
  initialized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mahidrive.google_accounts (
  id uuid primary key default gen_random_uuid(),
  slot smallint not null unique check (slot between 1 and 5),
  label text not null,
  account_email text unique,
  status text not null default 'disconnected'
    check (status in ('disconnected','pending','connected','reauthorization_required','error')),
  scopes text[] not null default '{}',
  refresh_token_ciphertext bytea,
  refresh_token_nonce bytea,
  encryption_key_version smallint,
  quota_limit_bytes bigint check (quota_limit_bytes is null or quota_limit_bytes >= 0),
  quota_used_bytes bigint check (quota_used_bytes is null or quota_used_bytes >= 0),
  quota_checked_at timestamptz,
  connected_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (refresh_token_ciphertext is null and refresh_token_nonce is null and encryption_key_version is null)
    or
    (refresh_token_ciphertext is not null and refresh_token_nonce is not null and encryption_key_version is not null)
  )
);

create table mahidrive.drive_files (
  id uuid primary key default gen_random_uuid(),
  google_account_id uuid not null references mahidrive.google_accounts(id) on delete cascade,
  drive_file_id text not null,
  name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  md5_checksum text,
  parent_drive_file_id text,
  modified_at timestamptz,
  is_trashed boolean not null default false,
  indexed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (google_account_id, drive_file_id)
);
create index drive_files_account_modified_idx
  on mahidrive.drive_files (google_account_id, modified_at desc);
create index drive_files_account_parent_idx
  on mahidrive.drive_files (google_account_id, parent_drive_file_id);

create table mahidrive.sync_state (
  google_account_id uuid primary key references mahidrive.google_accounts(id) on delete cascade,
  page_token text,
  last_full_sync_at timestamptz,
  last_incremental_sync_at timestamptz,
  sync_status text not null default 'idle'
    check (sync_status in ('idle','running','failed')),
  last_error_code text,
  updated_at timestamptz not null default now()
);

create table mahidrive.transfer_jobs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source_account_id uuid not null references mahidrive.google_accounts(id) on delete restrict,
  destination_account_id uuid not null references mahidrive.google_accounts(id) on delete restrict,
  source_drive_file_id text not null,
  destination_drive_file_id text,
  file_name text not null,
  mime_type text,
  expected_size_bytes bigint check (expected_size_bytes is null or expected_size_bytes >= 0),
  transferred_bytes bigint not null default 0 check (transferred_bytes >= 0),
  status text not null default 'queued'
    check (status in ('queued','copying','verifying','deleting_source','completed','failed','cancelled')),
  checksum_verified boolean not null default false,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_account_id <> destination_account_id)
);
create index transfer_jobs_status_created_idx
  on mahidrive.transfer_jobs (status, created_at desc);

create table mahidrive.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  object_type text,
  object_id text,
  outcome text not null default 'success' check (outcome in ('success','failure','denied')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_created_idx
  on mahidrive.audit_events (created_at desc);

alter table mahidrive.owner_settings enable row level security;
alter table mahidrive.google_accounts enable row level security;
alter table mahidrive.drive_files enable row level security;
alter table mahidrive.sync_state enable row level security;
alter table mahidrive.transfer_jobs enable row level security;
alter table mahidrive.audit_events enable row level security;

revoke all on all tables in schema mahidrive from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema mahidrive to service_role;
grant usage, select on all sequences in schema mahidrive to service_role;

alter default privileges for role postgres in schema mahidrive
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema mahidrive
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema mahidrive
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema mahidrive
  grant usage, select on sequences to service_role;
