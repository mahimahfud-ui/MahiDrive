create index if not exists audit_events_actor_user_id_idx
  on mahidrive.audit_events (actor_user_id);
create index if not exists transfer_jobs_source_account_id_idx
  on mahidrive.transfer_jobs (source_account_id);
create index if not exists transfer_jobs_destination_account_id_idx
  on mahidrive.transfer_jobs (destination_account_id);
