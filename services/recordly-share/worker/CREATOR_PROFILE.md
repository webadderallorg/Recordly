# Public creator profile

This single-owner share service displays an optional public creator profile on recordings. Configure the following Worker environment variables (in `.dev.vars` for local development or Cloudflare for deployment):

- `CREATOR_NAME`: public display name (100 characters maximum)
- `CREATOR_BIO`: optional short description (200 characters maximum)
- `CREATOR_WEBSITE`: optional public HTTP(S) website

These values are returned by the share data endpoint after the recording access checks. They apply to existing and future recordings on this service. No account email or operating-system identity is inferred. Unconfigured services display “Creator not provided”.
