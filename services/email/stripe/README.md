# Stripe brand assets

- `recordly-icon-512.png`: transparent blue shape for the Icon slot.
- `recordly-logo-with-text.png`: full transparent logo: blue shape plus dark Recordly
  wordmark in the app/website's bundled DM Sans, for the Logo slot.

Regenerate the full logo with `node services/email/stripe/build-logo.mjs`. It uses
the existing app SVG and bundled font, rendering at 2x without a background.
The wordmark follows the existing website's medium weight and -0.04em tracking.
Stripe receives a raster image and needs no external font.
