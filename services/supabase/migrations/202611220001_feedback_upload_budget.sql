begin;

update storage.buckets set file_size_limit = 52428800 where id = 'feedback-attachments';
-- Only support and the upload service need file access. Owner reads of report rows are unchanged.
drop policy if exists "Read own feedback uploads" on storage.objects;
drop policy if exists "Remove unfinished feedback uploads" on storage.objects;

create table public.feedback_global_usage (
  day date primary key,
  reports integer not null default 0,
  bytes bigint not null default 0,
  notifications integer not null default 0
);
alter table public.feedback_global_usage enable row level security;
revoke all on public.feedback_global_usage from public, anon, authenticated;

create table public.feedback_retention (starts_at timestamptz primary key);
insert into public.feedback_retention values (now());
alter table public.feedback_retention enable row level security;
revoke all on public.feedback_retention from public, anon, authenticated;

create table public.feedback_uploads (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '12 hours',
  files jsonb not null,
  finalized boolean not null default false,
  urls jsonb not null default '{}'
);
alter table public.feedback_uploads enable row level security;
revoke all on public.feedback_uploads from public, anon, authenticated;
grant select on public.feedback_uploads to service_role;
create index on public.feedback_uploads (expires_at);

create function public.take_feedback_budget(account_id uuid, file_count integer, byte_count bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'UTC')::date;
begin
  if account_id is null or file_count is null or byte_count is null
     or file_count not between 0 and 5 or byte_count not between 0 and 52428800 then
    return false;
  end if;
  if byte_count > 0 then
    -- Serialize positive-byte reservations across UTC day boundaries.
    perform pg_catalog.pg_advisory_xact_lock(671848201);
    if (select coalesce(sum(bytes), 0) from public.feedback_global_usage
        where day >= today - 30) + byte_count > 524288000 then
      return false;
    end if;
  end if;
  insert into public.feedback_daily_usage as u (user_id, day, reports, files, bytes)
  values (account_id, today, 1, file_count, byte_count)
  on conflict (user_id, day) do update
    set reports = u.reports + 1, files = u.files + excluded.files, bytes = u.bytes + excluded.bytes
    where u.reports < 10 and u.files + excluded.files <= 25 and u.bytes + excluded.bytes <= 52428800;
  if not found then return false; end if;

  insert into public.feedback_global_usage as u (day, reports, bytes)
  values (today, 1, byte_count)
  on conflict (day) do update set reports = u.reports + 1, bytes = u.bytes + excluded.bytes
    where u.reports < 1000 and u.bytes + excluded.bytes <= 104857600;
  if not found then
    -- Roll back this reservation's account charge if the shared quota is full.
    raise sqlstate 'PGR01';
  end if;
  return true;
exception when sqlstate 'PGR01' then return false;
end;
$$;
revoke all on function public.take_feedback_budget(uuid, integer, bigint) from public, anon, authenticated;

create or replace function public.reserve_feedback_quota(account_id uuid, file_count integer, byte_count bigint)
returns boolean language sql security definer set search_path = '' as $$
  select byte_count <= 10485760 and public.take_feedback_budget(account_id, file_count, byte_count);
$$;

create function public.prepare_feedback_upload(account_id uuid, report_id uuid, manifest jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare prior public.feedback_uploads;
declare total bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(report_id::text, 1));
  select * into prior from public.feedback_uploads where id = report_id;
  if found then
    if prior.user_id = account_id and prior.expires_at > now() and prior.files = manifest
      then return case when prior.finalized then 'saved' else 'ready' end;
    end if;
    return 'invalid';
  end if;
  if jsonb_typeof(manifest) is distinct from 'array' then return 'invalid'; end if;
  if jsonb_array_length(manifest) not between 1 and 5 then return 'invalid'; end if;
  select sum((item->>'size')::bigint) into total from jsonb_array_elements(manifest) item;
  if not public.take_feedback_budget(account_id, jsonb_array_length(manifest), total)
    then return 'limit'; end if;
  insert into public.feedback_uploads (id, user_id, files) values (report_id, account_id, manifest);
  return 'ready';
end;
$$;

create function public.set_feedback_upload_url(account_id uuid, report_id uuid, slot text, candidate text)
returns text language plpgsql security definer set search_path = '' as $$
declare existing text;
begin
  update public.feedback_uploads
    set urls = case when urls ? slot then urls else urls || jsonb_build_object(slot, candidate) end
    where id = report_id and user_id = account_id and expires_at > now() and not finalized
    returning urls->>slot into existing;
  return existing;
end;
$$;

create function public.finish_feedback_upload(account_id uuid, report_id uuid, payload jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare pending public.feedback_uploads;
declare attachments jsonb;
begin
  select * into pending from public.feedback_uploads
    where id = report_id and user_id = account_id and expires_at > now() for update;
  if not found then return 'invalid'; end if;
  if pending.finalized then return 'saved'; end if;
  select jsonb_agg(file || jsonb_build_object('path', path) order by ord) into attachments
  from (
    select file, ord, account_id::text || '/' || report_id::text || '/' || (ord - 1)::text as path
    from jsonb_array_elements(pending.files) with ordinality as f(file, ord)
  ) expected
  join storage.objects o on o.bucket_id = 'feedback-attachments' and o.name = expected.path
    and o.metadata->>'size' = file->>'size';
  if coalesce(jsonb_array_length(attachments), 0) <> jsonb_array_length(pending.files)
    then return 'incomplete'; end if;
  insert into public.feedback_reports (id, user_id, title, subject, message, logs, attachments)
    values (report_id, account_id, payload->>'title', payload->>'subject', payload->>'message',
      payload->>'logs', attachments);
  update public.feedback_uploads set finalized = true where id = report_id;
  return 'new';
end;
$$;

create function public.take_feedback_notification()
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into public.feedback_global_usage as u (day, notifications)
  values ((now() at time zone 'UTC')::date, 1)
  on conflict (day) do update set notifications = u.notifications + 1 where u.notifications < 50;
  return found;
end;
$$;

create function public.expired_feedback_objects()
returns table (path text) language sql security definer set search_path = '' as $$
  select o.name from storage.objects o
  where o.bucket_id = 'feedback-attachments' and (
    (o.created_at < now() - interval '30 days' and
      exists (select 1 from public.feedback_retention where starts_at < now() - interval '30 days'))
    or (o.created_at < now() - interval '24 hours' and not exists (
      select 1 from public.feedback_reports r
      where r.id = case
        when split_part(o.name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then split_part(o.name, '/', 2)::uuid
      end and r.attachments @> jsonb_build_array(jsonb_build_object('path', o.name))
    ))
  )
  order by o.created_at limit 100;
$$;

revoke all on function public.prepare_feedback_upload(uuid, uuid, jsonb),
  public.set_feedback_upload_url(uuid, uuid, text, text), public.finish_feedback_upload(uuid, uuid, jsonb),
  public.take_feedback_notification(), public.expired_feedback_objects() from public, anon, authenticated;
grant execute on function public.prepare_feedback_upload(uuid, uuid, jsonb),
  public.set_feedback_upload_url(uuid, uuid, text, text), public.finish_feedback_upload(uuid, uuid, jsonb),
  public.take_feedback_notification(), public.expired_feedback_objects() to service_role;

select cron.schedule('recordly-feedback-prune-budgets', '7 3 * * *', $job$
  delete from public.feedback_uploads where expires_at < now() - interval '1 day';
  delete from public.feedback_daily_usage where day < (now() at time zone 'UTC')::date - 1;
  delete from public.feedback_global_usage where day < (now() at time zone 'UTC')::date - 30;
$job$);

create extension if not exists pg_net;
select cron.schedule('recordly-feedback-expire-attachments', '*/15 * * * *', $job$
  select net.http_post(
    url := base.decrypted_secret || '/functions/v1/submit-feedback?upload=cleanup',
    headers := jsonb_build_object('Authorization', 'Bearer ' || token.decrypted_secret),
    timeout_milliseconds := 15000
  )
  from vault.decrypted_secrets base cross join vault.decrypted_secrets token
  where base.name = 'feedback_cleanup_base_url' and token.name = 'feedback_cleanup_secret';
$job$);
commit;
