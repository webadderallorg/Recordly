-- Run as migration owner in a disposable Supabase database.
begin;
insert into auth.users (id) values
  ('88000000-0000-0000-0000-000000000001'), ('88000000-0000-0000-0000-000000000002'),
  ('88000000-0000-0000-0000-000000000003'), ('88000000-0000-0000-0000-000000000004');
do $$
declare
  a uuid := '88000000-0000-0000-0000-000000000001';
  b uuid := '88000000-0000-0000-0000-000000000002';
  c uuid := '88000000-0000-0000-0000-000000000003';
  d uuid := '88000000-0000-0000-0000-000000000004';
  report uuid := gen_random_uuid();
  upload_path text := a::text || '/' || report::text || '/0';
  manifest jsonb := '[{"name":"sample.dat","type":"","size":52428800}]';
  payload jsonb := '{"title":"test","message":"test","subject":"other","logs":null}';
begin
  if has_function_privilege('authenticated', 'public.prepare_feedback_upload(uuid,uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finish_feedback_upload(uuid,uuid,jsonb)', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.feedback_uploads', 'SELECT')
     or not has_function_privilege('service_role', 'public.finish_feedback_upload(uuid,uuid,jsonb)', 'EXECUTE')
     then raise exception 'Invalid upload permissions'; end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and (qual ilike '%feedback-attachments%' or with_check ilike '%feedback-attachments%'))
     then raise exception 'Direct feedback file access remains enabled'; end if;
  if public.prepare_feedback_upload(a, report, manifest) <> 'ready'
     or public.prepare_feedback_upload(a, report, manifest) <> 'ready'
     or public.prepare_feedback_upload(b, report, manifest) <> 'invalid'
     or public.reserve_feedback_quota(a, 1, 1)
     then raise exception 'Reservation, retry, ownership or per-account limit failed'; end if;
  -- Read usage in its own statement so it sees the reservations above.
  if (select reports from public.feedback_daily_usage where user_id = a) is distinct from 1
     then raise exception 'Retried reservation was charged twice'; end if;
  if public.finish_feedback_upload(a, report, payload) <> 'incomplete'
     then raise exception 'Missing object passed finalization'; end if;
  insert into storage.objects (bucket_id,name,metadata) values ('feedback-attachments',upload_path,'{"size":1}');
  if public.finish_feedback_upload(a, report, payload) <> 'incomplete'
     then raise exception 'Incorrect object size passed finalization'; end if;
  update storage.objects set metadata = '{"size":52428800}' where name = upload_path;
  if public.finish_feedback_upload(b, report, payload) <> 'invalid'
     then raise exception 'Finalization ownership failure'; end if;
  if public.finish_feedback_upload(a, report, payload) <> 'new'
     then raise exception 'Complete upload did not finalize'; end if;
  if public.finish_feedback_upload(a, report, payload) <> 'saved'
     then raise exception 'Finalize retry did not recognize the existing report'; end if;
  if (select attachments->0->>'path' from public.feedback_reports where id = report) is distinct from upload_path
     then raise exception 'Finalized report lost attachment metadata'; end if;
  if public.prepare_feedback_upload(b, gen_random_uuid(), manifest) <> 'ready'
     or public.prepare_feedback_upload(c, gen_random_uuid(), manifest) <> 'limit'
     or not public.reserve_feedback_quota(d, 0, 0)
     then raise exception 'Shared byte budget failed or blocked text-only feedback'; end if;
  if exists(select 1 from public.feedback_daily_usage where user_id = c)
     then raise exception 'Rejected reservation charged the account'; end if;
  insert into public.feedback_global_usage (day, bytes)
    values ((now() at time zone 'UTC')::date - 10, 524288000);
  update public.feedback_global_usage set bytes = 0 where day = (now() at time zone 'UTC')::date;
  if public.reserve_feedback_quota(c, 1, 1) or not public.reserve_feedback_quota(c, 0, 0)
     then raise exception 'Rolling storage budget failed or blocked text-only feedback'; end if;
  for i in 1..50 loop
    if not public.take_feedback_notification() then raise exception 'Notification capped too early'; end if;
  end loop;
  if public.take_feedback_notification() then raise exception 'Notification cap bypassed'; end if;
  if exists (select 1 from public.expired_feedback_objects() where expired_feedback_objects.path = a::text || '/' || report::text || '/0')
     then raise exception 'Recent attachment selected for cleanup'; end if;
  insert into storage.objects (bucket_id,name,metadata,created_at)
    values ('feedback-attachments',upload_path || '-unreferenced','{"size":1}',now() - interval '25 hours');
  if not exists (select 1 from public.expired_feedback_objects() expired where expired.path = upload_path || '-unreferenced')
     then raise exception 'Abandoned attachment not selected for cleanup'; end if;
  update storage.objects set created_at = now() - interval '31 days' where name = upload_path;
  if exists (select 1 from public.expired_feedback_objects() expired where expired.path = upload_path)
     then raise exception 'Existing attachment was not granted grace at rollout'; end if;
  update public.feedback_retention set starts_at = now() - interval '31 days';
  if not exists (select 1 from public.expired_feedback_objects() where expired_feedback_objects.path = a::text || '/' || report::text || '/0')
     then raise exception 'Expired attachment not selected for cleanup'; end if;
end;
$$;
rollback;
