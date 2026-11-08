begin;
-- The existing support endpoint now accepts bounded, user-requested diagnostic logs
-- for application failures as well as legacy export summaries. Keep the same RLS,
-- service-role-only access, global write quota and 30-day retention.
alter table public.export_error_reports
  drop constraint export_error_reports_diagnostics_check;
alter table public.export_error_reports
  add constraint export_error_reports_diagnostics_check
  check (jsonb_typeof(diagnostics) = 'object' and octet_length(diagnostics::text) <= 1000000);
commit;
