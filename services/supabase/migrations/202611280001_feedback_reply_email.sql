begin;

alter table public.feedback_reports add column reply_email text;

create or replace function public.finish_feedback_upload(account_id uuid, report_id uuid, payload jsonb)
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
  insert into public.feedback_reports (id, user_id, title, subject, message, logs, attachments, reply_email)
    values (report_id, account_id, payload->>'title', payload->>'subject', payload->>'message',
      payload->>'logs', attachments, payload->>'reply_email');
  update public.feedback_uploads set finalized = true where id = report_id;
  return 'new';
end;
$$;

commit;
