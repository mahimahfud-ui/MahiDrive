alter table mahidrive.google_accounts
  add column if not exists google_subject_id text;
create unique index if not exists google_accounts_google_subject_id_uidx
  on mahidrive.google_accounts (google_subject_id)
  where google_subject_id is not null;

alter table mahidrive.drive_files
  add column if not exists is_starred boolean not null default false;
create index if not exists drive_files_account_trashed_modified_idx
  on mahidrive.drive_files (google_account_id, is_trashed, modified_at desc);

insert into mahidrive.google_accounts (slot, label, status)
values
  (1,'Google Drive 1','disconnected'),
  (2,'Google Drive 2','disconnected'),
  (3,'Google Drive 3','disconnected'),
  (4,'Google Drive 4','disconnected'),
  (5,'Google Drive 5','disconnected')
on conflict (slot) do nothing;

alter role authenticator set pgrst.db_schemas = 'public, graphql_public, mahidrive';
notify pgrst, 'reload schema';
