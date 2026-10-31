-- Apply to the Supabase project used by VITE_SUPABASE_URL before shipping feedback.
begin;
create table public.feedback_reports (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  title text not null check (length(trim(title)) between 1 and 160),
  subject text not null check (subject in ('bug', 'idea', 'question', 'other')),
  message text not null check (length(trim(message)) between 1 and 10000),
  logs text check (octet_length(logs) <= 300000),
  attachments jsonb not null default '[]' check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5)
);
alter table public.feedback_reports enable row level security;
revoke all on public.feedback_reports from public, anon, authenticated;
grant select, insert on public.feedback_reports to authenticated;
create policy "Submit own feedback" on public.feedback_reports for insert to authenticated with check (user_id = auth.uid());
create policy "Read own feedback" on public.feedback_reports for select to authenticated using (user_id = auth.uid());
-- Reports are read by staff using service-role access, never publicly.
insert into storage.buckets (id, name, public, file_size_limit) values ('feedback-attachments', 'feedback-attachments', false, 10485760);
create policy "Upload own feedback files" on storage.objects for insert to authenticated
with check (bucket_id = 'feedback-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Remove unfinished feedback uploads" on storage.objects for delete to authenticated
using (bucket_id = 'feedback-attachments' and (storage.foldername(name))[1] = auth.uid()::text and not exists (
  select 1 from public.feedback_reports where id::text = (storage.foldername(name))[2]
));
-- Allow owners to locate their uploads for cleanup; the bucket remains private.
create policy "Read own feedback uploads" on storage.objects for select to authenticated
using (bucket_id = 'feedback-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
