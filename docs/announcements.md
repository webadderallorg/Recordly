# In-app announcements

Recordly can show dismissible announcements in the editor as a popup, carousel slide, lightweight live notification, or header banner. Popups can contain images or video; notifications and banners are text-only with optional buttons.

## Remote announcements

Edit [`announcements.json`](../announcements.json) on the `main` branch to publish an announcement without releasing a new app version. Released clients check the raw GitHub file at most once every six hours per running app instance. Fetch failures are silent and never block startup.

```json
{
	"settings": {
		"aspectRatio": "4:3"
	},
	"announcements": [
		{
			"id": "recordly-1.4-release",
			"title": "A faster Recordly is here",
			"body": "Exports are faster and cursor motion is smoother. Thanks for using Recordly!",
			"presentation": "popup",
			"audience": "editor",
			"priority": 10,
			"mediaMode": "cover",
			"displayDurationSeconds": 15,
			"maxImpressions": 3,
			"controls": {
				"close": true,
				"dismiss": false,
				"action": true,
				"navigation": false,
				"indicators": true
			},
			"startsAt": "2026-09-01T00:00:00Z",
			"endsAt": "2026-10-01T00:00:00Z",
			"minVersion": "1.4.0",
			"media": {
				"type": "image",
				"url": "https://example.com/recordly-1.4-banner.jpg",
				"alt": "Recordly 1.4 feature preview"
			},
			"action": {
				"label": "See what changed",
				"url": "https://github.com/webadderallorg/Recordly/releases"
			}
		},
		{
			"id": "recordly-maintenance-notice",
			"title": "Quick service notice",
			"body": "Cloud sharing will undergo brief maintenance tonight.",
			"presentation": "notification",
			"audience": "editor",
			"displayDurationSeconds": 10,
			"maxImpressions": 2,
			"startsAt": "2026-09-05T00:00:00Z",
			"endsAt": "2026-09-06T00:00:00Z"
		},
		{
			"id": "recordly-editor-banner",
			"title": "Try the new editor",
			"body": "The redesigned timeline is now available.",
			"presentation": "banner",
			"audience": "editor",
			"maxImpressions": 3,
			"action": {
				"label": "Open settings",
				"section": "settings"
			}
		}
	]
}
```

Use a new stable `id` whenever an announcement should appear again. Once a user dismisses an ID, it remains dismissed. Remote items with the same ID override bundled items.

Supported fields:

- `settings.aspectRatio` sets one shared `width:height` ratio for the entire popup carousel, such as `16:9`, `4:3`, or `1:1`. All slides keep that same size. If omitted, the bundled default is used.
- `id`, `title`, and `body` are required.
- `presentation` is `popup`, `notification`, or `banner` and defaults to `popup`. Notifications appear as text-only non-modal toasts, while banners appear only in the editor directly beneath its header. Media and `mediaMode` are ignored for notifications and banners. At most five notifications are shown from one feed load; banners are shown one at a time by priority.
- `audience` is `all` or `editor` and defaults to `all`.
- `priority` controls carousel order; larger numbers appear first.
- `mediaMode` is `banner` or `cover`. `banner` is the default current layout; `cover` fills the popup with the media and overlays the text.
- `startsAt` and `endsAt` are optional ISO timestamps.
- `displayDurationSeconds` accepts 3–300 seconds. It auto-advances popup slides; for notifications it controls how long the toast remains visible and defaults to 10 seconds.
- `maxImpressions` optionally limits an announcement to 1–100 app sessions. Each announcement counts at most once per session; an explicit dismissal always hides it permanently.
- `controls` can independently show or hide `close`, `dismiss`, `action`, `navigation`, and `indicators`. Every control defaults to `true`. Notifications and banners use only `close` and `action`; popup carousels use the other controls. Escape and clicking outside a popup remain available even when visible close controls are hidden.
- `minVersion` and `maxVersion` are optional inclusive app-version bounds.
- `media.type` is `image` or `video` for popups. Media URLs must be HTTPS or root-relative bundled assets. Videos can also specify `posterUrl`.
- `action` has a label and exactly one destination: an HTTPS `url` opened in the system browser, or an editor `section` opened inside the app. Supported sections are `scene`, `cursor`, `webcam`, `captions`, `settings`, and `extensions`. An action containing both destinations, neither destination, or an unknown section is ignored.

Set `RECORDLY_ANNOUNCEMENTS_URL` before launching the app to use a different HTTPS feed. Set it to `off` to disable remote announcements.

## Announcements bundled with an update

Add typed entries to `src/content/announcements.ts`. Bundled items use the same schema and are available offline. This is useful when a message should ship atomically with a new release.

Remote content is treated as data only: HTML is not rendered, URLs are restricted, feeds are size-limited and time-limited, and malformed items are ignored.

## Local announcement studio

Run `npm run announcement-studio`, then open `http://127.0.0.1:3000`.
The studio uses the current Recordly renderer and HeroUI styles directly, with an
isolated desktop adapter and sample video. Its iframe has an independent viewport:
choose desktop, laptop, compact or narrow sizes, or enter dimensions. The preview
scales to fit without changing the app's responsive breakpoints. Theme switches
apply inside the preview. **Open full size** opens a live preview window.

Preview popups and notifications against the dashboard or editor. Header banners
use the editor; dashboard image banners use the actual dashboard carousel. Edits
update the preview immediately. Close/dismiss controls work; **Replay** restores
the current draft. Native actions and account services are disabled in the preview.
The dashboard starts with an empty sample library.

Drafts save in this browser at the studio origin. Uploaded images/videos are held
in memory for the server session (50 MB per file, 100 MB total); add the original
file to `public/` at the exported path before integration. Reloading the studio
requires choosing the local file again. Existing public media and HTTPS media can
also be used by URL.

**Copy JSON** and **Download** produce a current-schema feed for popups,
notifications and header banners. Dashboard image banners produce the separate
`AnnouncementConfig` for `src/components/video-editor/dashboard/announcementConfig.ts`.
The preview bypasses delivery dates, audience and impression limits for authoring;
export preserves them. Unsupported repeat/snooze/time-window options from the old
studio are no longer offered. A blank aspect ratio uses the app's bundled default.

Validation: `npx playwright test --config playwright.studio.config.ts` and
`npx vitest run src/dev/announcementStudioModel.test.ts`.
The studio has its own Vite configuration and does not launch Electron or enter the
normal app bundle. Keep it local; it is a development tool, not a publishing flow.

The studio disables source hot reload so background app development cannot close
menus or interrupt authoring. Draft edits still preview immediately. Refresh the
page deliberately when you want to load new application source changes.
