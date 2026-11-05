# Browser handoff pages

`renderReturnPage(state, protocol, theme)` supplies the actual static presentation
for the desktop's development sign-in callback. The hosted backend uses the same
presentation for its existing `/billing/return` route, in its private source tree.
The hosted copy must be deliberately refreshed when this shared renderer changes.
This folder contains presentation only, with no billing or account service logic.

Preview all states at `http://127.0.0.1:3500/return-preview.html` after running
`npm run email:preview`. The preview disables app-opening links. Its toolbar also
links back to the email gallery.

- `auth-received`: a sign-in link reached the app; the app still completes sign-in.
- `auth-error`: a link reported an authentication error; request a new link in the app.
- `billing-return`: return from checkout or billing management; the app checks the
  subscription with the server. The browser return does not confirm a payment.

The pages use the actual HeroUI primary Button and default theme, with Recordly's
bundled DM Sans variable font and original blue vector mark. The logo is centred
without a surrounding box; there is no corner wordmark.

Run `npm run return-pages:build` after changing `return-page.css`, the generator,
HeroUI, the font or logo. This compiles HeroUI's real styles and server-renders the
component into `assets.generated.mjs`. It also exports email-compatible HeroUI
colours and button dimensions into `../email/theme.generated.mjs`. The runtime renderer has no React or Node
dependency, so both Electron and the private hosted service can use it. Refresh
both the renderer and generated asset module in the private source tree together.

Static HTML keeps the pages functional without JavaScript. Font data is embedded
and allowed by the narrow `font-src data:` policy; no remote font or asset request
is needed. The default light and dark colours come directly from HeroUI's theme.

App-opening links contain only a fixed app protocol and route, never an auth code,
customer identifier or query-string redirect. `recordly://app/open` brings the app
forward without replacing a pending sign-in callback. Closing a browser tab is left
to the user, with a clear message once they have returned to Recordly.

Source changes require the normal desktop build/restart and hosted deployment to
reach installed apps/production. The preview alone does not publish either.
