# Recordly landing page and reference archive

This project contains two separate deliverables:

- `extracted/index.original.html`: the public homepage HTML downloaded directly from https://aside.com/.
- `extracted/public-source/`: 61 linked public JavaScript, CSS, font, and image resources, with provenance in `extracted/manifest.json`.
- `src/`: the Recordly landing page, with Recordly demos, recording/editing features, cloud-sharing information, and legal routes. The established layout and locally saved visual assets are preserved.

The extraction is compiled public output, not Aside's original Next.js source or backend. It is a reference archive, not a standalone runnable mirror; additional lazy-loaded routes and API responses are not archived. Original third-party assets retain their owners' rights. The React application does not run the archived scripts or tracking code.

## Run

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5178. Run `npm run build` for production output and `npm run preview` to inspect it.

## Implementation

The blog lives at `/blog` and starts with an empty state. It uses the same
`SiteHeader.jsx`, font, navigation controls, and button styles as the landing page.
The light header preserves the original accent-blue Recordly mark. Blog is a
direct navigation link; there is no Tutorials page or generated article content.

Add hand-written articles to the empty array in `src/blog/posts.js` when needed.
The existing article renderer supports paragraphs, lists, tables, and code blocks.
`npm run build` prerenders the blog and any authored articles with metadata and a
sitemap. Set `VITE_SITE_URL` at build time to the actual deployment origin; its
default matches the existing review host. Run `node scripts/check-blog.mjs` after
building to verify that no generated articles or tutorial routes remain.

The header's Pricing link opens `/pricing`, a dedicated Free/Cloud comparison
based on the source pricing layout. The Cloud amount and numeric limits load
from the public managed-service catalog; an unavailable or invalid response shows
a retry state instead of an invented price. Subscriptions are started in the
Recordly app. `/billing` remains the separate billing-and-refunds policy.

The hero announcement is hidden by default: set `heroAnnouncement` in
`src/main.jsx` to `{ title, href }` when a post should be featured.

The Recordly legal drafts are available at `/privacy`, `/terms`, `/billing` and
`/contact`, with `/policy/privacy` and `/policy/terms` aliases for existing links.
They mirror `services/recordly-share/worker/web/src/pages/`; keep both copies in
sync when changing policy wording. Pages remain marked as drafts and `noindex`
until the `VITE_LEGAL_*` publication details are valid and explicitly approved
after operator review. Production hosting must serve `index.html` for these
client-side routes.

- Responsive desktop/mobile navigation with dropdowns, Escape handling, and outside-click dismissal.
- Recordly hero video, sticky Record/Preview/Share walkthrough, automatic-zoom and cursor demos, pricing overview, privacy information, and footer.
- Reduced-motion support, keyboard focus styling, semantic sections, and a skip link.
- Download buttons lead to the official Recordly GitHub releases page. No unpublished beta artifact is advertised. Availability was checked against GitHub on 2026-10-24: v1.4.0 is the latest public release and 2.0 beta remains in preparation. Update that availability text when the beta is published.
- Pricing amounts are deliberately not duplicated here. The desktop app displays the server-verified `/api/billing/catalog` entry and checks it against the account's checkout price; this page links to the billing policy and directs visitors to the app for current pricing.
- `wrangler.jsonc` deploys this app as the separate `recordly-beta-landing` static-assets Worker, including SPA fallback for legal routes. After `npm run build`, deploy from this directory using the existing Cloudflare CLI (`wrangler deploy`). The review preview is https://recordly-beta-landing.youngchen3442.workers.dev. This configuration does not attach a custom domain. The existing root website and `videos.recordly.dev` service remain separate; root-domain cutover requires an explicit hosting/domain decision.

Public resources were extracted on 2026-09-21. To refresh the reference archive, run `python3 extracted/extract.py` after replacing `extracted/index.original.html` with a fresh download. The script fetches only static resources referenced by that HTML and its linked bundles.
