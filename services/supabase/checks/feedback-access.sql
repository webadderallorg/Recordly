-- Baseline check for migration 001 only; migration 002 intentionally removes direct inserts.
-- Run as postgres in the SQL editor after applying migration 001.
-- Requires at least one existing auth user. All test data is rolled back.
begin;
select set_config('recordly.test_owner', (select id::text from auth.users limit 1), true);
select set_config('recordly.test_report', gen_random_uuid()::text, true);
select set_config('request.jwt.claim.sub', current_setting('recordly.test_owner'), true);
set local role authenticated;
insert into public.feedback_reports (id, title, subject, message)
values (current_setting('recordly.test_report')::uuid, 'Setup access check', 'other', 'Temporary test; transaction will roll back.');
do $$
begin
  if not exists (select 1 from public.feedback_reports where id = current_setting('recordly.test_report')::uuid) then
    raise exception 'Owner cannot read their feedback';
  end if;
  begin
    update public.feedback_reports set title = 'Unexpected update' where id = current_setting('recordly.test_report')::uuid;
    raise exception 'Unexpected authenticated update permission';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
do $$
begin
  if exists (select 1 from public.feedback_reports where id = current_setting('recordly.test_report')::uuid) then
    raise exception 'Cross-user feedback read allowed';
  end if;
  begin
    insert into public.feedback_reports (id, user_id, title, subject, message)
    values (gen_random_uuid(), current_setting('recordly.test_owner')::uuid, 'Spoof attempt', 'other', 'Must be rejected');
    raise exception 'Cross-user feedback insert allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.feedback_reports;
    raise exception 'Anonymous feedback read allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
select 'PASS: owner insert/read; update, cross-user read/write and anonymous read blocked; test data rolled back' as result;
