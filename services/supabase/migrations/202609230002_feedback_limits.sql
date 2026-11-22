begin;
-- Submissions now go through the authenticated submit-feedback Edge Function.
-- No direct client uploads or report inserts may bypass server validation/quotas.
drop policy "Upload own feedback files" on storage.objects;
drop policy "Submit own feedback" on public.feedback_reports;
revoke insert on public.feedback_reports from anon, authenticated;
grant select, insert on public.feedback_reports to service_role;

create table public.feedback_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  reports integer not null default 0,
  files integer not null default 0,
  bytes bigint not null default 0,
  primary key (user_id, day)
);
alter table public.feedback_daily_usage enable row level security;
revoke all on public.feedback_daily_usage from public, anon, authenticated;

-- The upsert takes a row lock, so simultaneous requests cannot overspend quota.
-- Failed attempts consume quota too; deletion/retry must not reset the limit.
create function public.reserve_feedback_quota(account_id uuid, file_count integer, byte_count bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if account_id is null or file_count is null or byte_count is null
     or file_count < 0 or file_count > 5 or byte_count < 0 or byte_count > 10485760 then
    return false;
  end if;
  insert into public.feedback_daily_usage as usage (user_id, day, reports, files, bytes)
  values (account_id, (now() at time zone 'UTC')::date, 1, file_count, byte_count)
  on conflict (user_id, day) do update
    set reports = usage.reports + 1,
        files = usage.files + excluded.files,
        bytes = usage.bytes + excluded.bytes
    where usage.reports < 10
      and usage.files + excluded.files <= 25
      and usage.bytes + excluded.bytes <= 52428800;
  return found;
end;
$$;
revoke all on function public.reserve_feedback_quota(uuid, integer, bigint) from public, anon, authenticated;
grant execute on function public.reserve_feedback_quota(uuid, integer, bigint) to service_role;

commit;
