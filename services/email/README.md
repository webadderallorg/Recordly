# Recordly transactional email designs

All 27 authentication, security, subscription and billing designs use the shared
renderer. Its colour and large-button values are generated from the installed
`@heroui/styles` default theme and Button CSS by `scripts/build-return-pages.mjs`,
then exported as concrete inline values in `theme.generated.mjs`. The emails keep
the approved full-width banner, original Recordly mark and flat layout.

HTML email cannot run HeroUI's React/JavaScript components. It also cannot reliably
use CSS variables, OKLCH colours or flex layout across clients. The build converts
HeroUI colours to hex and button dimensions to pixels, keeping presentation tables,
inline styles and Outlook fallbacks. The app's DM Sans is explicitly applied to
text and table cells; clients that block web fonts use system/Arial fallbacks.
A plain-text alternative preserves content and links without visual styling.

Copy is warm, lightly playful and concise. Payment and security messages keep
the required action clear. Each catalog item also includes inbox preview text
(`preheader`); the shared renderer uses it rather than repeating the subject.
Keep user-approved exact copy and provider placeholders when adjusting tone.

Run `npm run email:build` after changing a catalog, the renderer or HeroUI. It
regenerates the HeroUI theme snapshot before the email files. This generates
HTML and plain-text files for all 27 messages. Run `npm run email:preview` and open
`http://127.0.0.1:3500/` to inspect them or make browser-local copy drafts.

## Delivery status

The 13 authentication/security HTML templates in `../supabase/templates/` were
published separately through Supabase. All seven optional security notifications
were enabled and verified after reload on 28 October 2026. Their generated `.txt` files are reference
alternatives; this build does not configure Supabase's MIME parts. The received
authentication email's plain-text part has not been inspected.

The 14 subscription/billing messages in `billing/` have been connected in the
private hosted backend to verified Stripe events, a durable D1 outbox, scheduled
renewal/trial/card reminders and a Resend HTML/text sender. That implementation
has passed local Worker/D1 tests. **Production billing delivery remains off pending
deployment, webhook configuration and a provider delivery check. A sending-only
Resend key restricted to the verified auth subdomain is now stored as a Cloudflare
Worker secret.** The private backend keeps credentials and recipient selection outside this
public desktop source. This folder itself has no queue or network side effects;
building or previewing never sends mail. All 27 manual previews were sent separately
to the owner's inbox; those previews did not test production billing delivery.
Trial messaging is conditional on a real trial; it does not create or enable trials.

| Design | Intended trigger |
| --- | --- |
| Subscription activated | First verified paid activation, not merely subscription creation |
| Plan changed | Verified plan change at its effective date |
| Upcoming renewal | Upcoming invoice with the actual expected total and renewal date |
| Cancellation scheduled | Cancellation newly scheduled for period end |
| Cancellation reversed | Previously scheduled cancellation removed |
| Subscription ended | Cancellation effective and account returned to Free |
| Trial ending | Trial ending, only if trials are offered; use the actual post-trial outcome |
| Payment received / renewal paid | Verified successful payment; distinguish from activation |
| Payment failed | Failed subscription invoice payment |
| Payment needs confirmation | Payment awaiting customer authentication |
| Card expiring | Default payment method approaching expiry |
| Refund issued | Confirmed issued refund, including the actual refunded amount |
| Invoice available / payment reminder | Open invoice or reminder; current amount due and due date |
| Credit note issued | Issued credit note; never imply a cash refund without confirmation |

Stripe receipts, invoices and recovery emails remain separately controlled in
Stripe. Before connecting these designs, choose one sender for each notification
to avoid sending duplicate receipts or reminders.

The prepared billing sender is `Recordly <notifications@auth.recordly.dev>` on
the existing verified sending subdomain, with `support@recordly.dev` as reply-to.
Support mail now forwards to the owner's inbox. `notifications@recordly.dev` can
be used later after verifying the root sending domain. The existing Supabase
SMTP sender (`noreply@auth.recordly.dev`) is unchanged; this source does not create
mailboxes, set up forwarding or verify domains. The verified auth subdomain can
also support a notifications address on that same subdomain.

Stripe's shared icon, brand blue (`#006fee`) and dark accent (`#18181b`) were updated
through the dashboard on 28 October 2026. Checkout has explicit matching colours,
Inter (DM Sans isn't offered in its font menu), with provider controls for
background colour and rounded/pill shapes.
This branding does not activate billing, change prices, turn on email notifications
or replace Stripe's own component layout. The 512-pixel PNG in `stripe/` is rendered
from the existing Recordly SVG mark for Stripe's icon size requirements.

## Render a billing email

Import `renderBillingEmail` from `render-billing-email.mjs` and pass a trusted item
from `billing/catalog.json` plus its required values. It returns
`{ subject, html, text }`. Include **both** `html` and `text` when sending with
Resend (or the equivalent `multipart/alternative` parts with SMTP).

```js
const message = renderBillingEmail(activationTemplate, {
  PlanName: "Recordly Cloud",
  Amount: formattedActualPrice,
  Interval: formattedActualBillingInterval,
  RenewalDate: formattedActualRenewalDate,
  ActionURL: authenticatedBillingPageOrStripeLink,
});
```

Use server-verified subscription/payment data and real formatted currency/taxes,
dates and customer locale. Preview prices and dates are illustrative only. The
renderer requires all fields, escapes HTML, rejects header line breaks and permits
HTTPS action links only on the managed Recordly origin and listed Stripe payment
hosts. Stripe links must be obtained from Stripe for the intended customer; do not
construct them from arbitrary webhook metadata. Use a durable outbox and event
deduplication before production delivery; the rendering helper does not implement
those billing responsibilities. Persist delivery state independently of entitlement
processing, handle event ordering, and do not let an email failure change access.
Never put secret billing links or customer records in this catalog.

## Failure previews

The **Rendering** menu offers:

- **Normal:** HTML, images and web fonts as supported by the browser.
- **Images blocked:** a CSP blocks image and font requests in the preview frame.
  Text and actions remain. Clients may reserve different amounts of image space.
- **No formatting:** removes CSS and decorative images; HTML text and links remain.
- **Plain text:** the generated text alternative, including amounts/dates, actions
  and URLs. Edited browser drafts derive a text approximation from their current
  HTML, without changing the generated text files.

These are browser simulations, not certification for Gmail, Outlook or Apple Mail.
HTML is included in the message rather than fetched as a remote webpage. A failed
image/font request does not remove the email body. A client that only shows text
needs a text MIME part; generating a `.txt` file alone does not send that part.

Renderer checks: `node --test services/email/render-billing-email.test.mjs`.
