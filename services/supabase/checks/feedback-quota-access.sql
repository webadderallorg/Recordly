-- Run as postgres after migration 002. All quota changes are rolled back.
-- Uses an existing auth user with no usage today; no auth users are created.
begin;
do $$
declare account uuid;
begin
  select id into account from auth.users u where not exists (
    select 1 from public.feedback_daily_usage q where q.user_id=u.id and q.day=(now() at time zone 'UTC')::date
  ) limit 1;
  if account is null then raise exception 'Requires an existing user with no feedback usage today'; end if;
  perform set_config('recordly.quota_test_owner', account::text, true);
  if has_function_privilege('authenticated', 'public.reserve_feedback_quota(uuid,integer,bigint)', 'EXECUTE')
    or has_function_privilege('anon', 'public.reserve_feedback_quota(uuid,integer,bigint)', 'EXECUTE')
    or has_table_privilege('authenticated', 'public.feedback_daily_usage', 'UPDATE')
    or has_table_privilege('authenticated', 'public.feedback_reports', 'INSERT')
    or has_table_privilege('authenticated', 'public.feedback_reports', 'UPDATE')
    or has_table_privilege('authenticated', 'public.feedback_reports', 'DELETE')
    or has_table_privilege('anon', 'public.feedback_reports', 'SELECT') then
    raise exception 'Client can bypass server quotas';
  end if;
  if not has_function_privilege('service_role', 'public.reserve_feedback_quota(uuid,integer,bigint)', 'EXECUTE') then
    raise exception 'Server cannot reserve quota';
  end if;
  if public.reserve_feedback_quota(account,6,1) or public.reserve_feedback_quota(account,1,10485761)
    or public.reserve_feedback_quota(account,-1,0) then raise exception 'Submission bounds bypassed'; end if;
end $$;
-- Preserve the server insertion path and owner isolation after the access migration.
select set_config('recordly.quota_test_report', gen_random_uuid()::text, true);
set local role service_role;
insert into public.feedback_reports (id, user_id, title, subject, message)
values (current_setting('recordly.quota_test_report')::uuid, current_setting('recordly.quota_test_owner')::uuid,
        'Server access check', 'other', 'Temporary test; transaction will roll back.');
reset role;
select set_config('request.jwt.claim.sub', current_setting('recordly.quota_test_owner'), true);
set local role authenticated;
do $$
begin
  if not exists (select 1 from public.feedback_reports where id=current_setting('recordly.quota_test_report')::uuid) then
    raise exception 'Owner cannot read feedback after access hardening';
  end if;
end $$;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
do $$
begin
  if exists (select 1 from public.feedback_reports where id=current_setting('recordly.quota_test_report')::uuid) then
    raise exception 'Cross-user read allowed after access hardening';
  end if;
end $$;
reset role;

-- Exercise this bucket under the client role, without rejecting unrelated bucket policies.
select set_config('request.jwt.claim.sub', current_setting('recordly.quota_test_owner'), true);
set local role authenticated;
do $$
begin
  begin
    insert into storage.objects (id, bucket_id, name)
    values (gen_random_uuid(), 'feedback-attachments', current_setting('recordly.quota_test_owner') || '/' || gen_random_uuid()::text || '/test.png');
    raise exception 'Client can upload feedback without reserving quota';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
savepoint empty_usage;
do $$
declare account uuid := current_setting('recordly.quota_test_owner')::uuid;
begin
  for i in 1..5 loop
    if not public.reserve_feedback_quota(account,5,1) then raise exception 'Valid file quota rejected'; end if;
  end loop;
  if public.reserve_feedback_quota(account,1,1) then raise exception 'Daily file quota bypassed'; end if;
end $$;
rollback to savepoint empty_usage;
do $$
declare account uuid := current_setting('recordly.quota_test_owner')::uuid;
begin
  for i in 1..5 loop
    if not public.reserve_feedback_quota(account,1,10485760) then raise exception 'Valid byte quota rejected'; end if;
  end loop;
  if public.reserve_feedback_quota(account,1,1) then raise exception 'Daily byte quota bypassed'; end if;
end $$;
rollback to savepoint empty_usage;
do $$
declare account uuid := current_setting('recordly.quota_test_owner')::uuid;
begin
  for i in 1..10 loop
    if not public.reserve_feedback_quota(account,0,0) then raise exception 'Valid report quota rejected'; end if;
  end loop;
  if public.reserve_feedback_quota(account,0,0) then raise exception 'Daily report quota bypassed'; end if;
  if (select reports from public.feedback_daily_usage where user_id=account and day=(now() at time zone 'UTC')::date) <> 10 then
    raise exception 'Rejected request changed quota';
  end if;
end $$;
rollback;
select 'PASS: server-only quota access, upload bypass blocked, per-report bounds and all three daily limits; test data rolled back' as result;
