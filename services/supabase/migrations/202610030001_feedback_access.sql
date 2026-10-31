-- Applies to already deployed databases; changing migration 001 alone is insufficient.
begin;
revoke all on public.feedback_reports from public, anon, authenticated;
grant select on public.feedback_reports to authenticated;
-- The authenticated Edge Function uses server-only insertion after quota reservation.
grant select, insert on public.feedback_reports to service_role;
commit;
