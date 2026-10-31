-- Run as migration owner in a disposable Supabase database after both migrations.
begin;
insert into auth.users (id) values
  ('77000000-0000-0000-0000-000000000001'),
  ('77000000-0000-0000-0000-000000000002'),
  ('77000000-0000-0000-0000-000000000003');
do $$
declare
  account uuid := '77000000-0000-0000-0000-000000000001';
begin
  if has_function_privilege('authenticated', 'public.reserve_feedback_quota(uuid,integer,bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.reserve_feedback_quota(uuid,integer,bigint)', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.feedback_daily_usage', 'UPDATE')
     or has_table_privilege('authenticated', 'public.feedback_reports', 'INSERT') then
    raise exception 'Client can bypass server quotas';
  end if;
  if not has_function_privilege('service_role', 'public.reserve_feedback_quota(uuid,integer,bigint)', 'EXECUTE') then
    raise exception 'Edge Function cannot reserve quota';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'Upload own feedback files') then
    raise exception 'Direct attachment uploads remain enabled';
  end if;
  if public.reserve_feedback_quota(account, 6, 1)
     or public.reserve_feedback_quota(account, 1, 10485761)
     or public.reserve_feedback_quota(account, -1, 0) then
    raise exception 'Per-submission bounds bypassed';
  end if;
  for i in 1..5 loop
    if not public.reserve_feedback_quota(account, 5, 1) then raise exception 'Valid file quota rejected'; end if;
  end loop;
  if public.reserve_feedback_quota(account, 1, 1) then raise exception 'Daily file cap bypassed'; end if;
  account := '77000000-0000-0000-0000-000000000002';
  for i in 1..5 loop
    if not public.reserve_feedback_quota(account, 1, 10485760) then raise exception 'Valid byte quota rejected'; end if;
  end loop;
  if public.reserve_feedback_quota(account, 1, 1) then raise exception 'Daily byte cap bypassed'; end if;
  account := '77000000-0000-0000-0000-000000000003';
  for i in 1..10 loop
    if not public.reserve_feedback_quota(account, 0, 0) then raise exception 'Valid report quota rejected'; end if;
  end loop;
  if public.reserve_feedback_quota(account, 0, 0) then raise exception 'Daily report cap bypassed'; end if;
  if (select reports from public.feedback_daily_usage where user_id = account) <> 10 then
    raise exception 'Rejected reservation changed quota';
  end if;
  -- A prior day's usage does not block today's quota.
  update public.feedback_daily_usage set day = day - 1 where user_id = account;
  if not public.reserve_feedback_quota(account, 1, 1) then raise exception 'Daily quota did not reset'; end if;
end;
$$;
rollback;
