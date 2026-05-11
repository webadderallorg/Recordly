# Recordly Extension API

Go to https://www.marketplace.recordly.dev/extensions for full, regularly updated documentation

Recordly extensions run in the editor renderer and use a permission-gated host API. They can draw into the render pipeline, react to playback and export events, register cursor effects, add settings panels, and contribute packaged assets such as frames, wallpapers, and cursor styles.

## Quick Start

For local user-installed extensions, use `Extensions -> Open Directory` in the app. Recordly stores them in the app `userData/extensions` directory. This repo also includes installable example bundles under `extension-examples/`.

### Minimum Extension

```text
my-extension/
  recordly-extension.json
  index.js
```

```json
{
  "id": "com.example.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "A short description",
  "author": "Your Name",
  "license": "MIT",
  "main": "index.js",
  "permissions": ["render"]
}
```

```js
export function activate(api) {
  api.log("Hello from my extension");
}

export function deactivate() {}
```

### TypeScript

Extensions can be authored in TypeScript. Import the `RecordlyExtensionAPI` type from `types.ts` in this repo for full IDE auto-complete and compile-time checks:

```ts
import type { RecordlyExtensionAPI } from "./types";

export function activate(api: RecordlyExtensionAPI) {
  api.registerRenderHook("final", (ctx) => {
    ctx.ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.ctx.fillRect(0, 0, ctx.width, 30);
  });
}

export function deactivate() {}
```

Recordly loads the `main` entry from the manifest, which must be a `.js` file. If you author in TypeScript, compile or bundle to JavaScript before packaging. A `tsconfig.json` with `"module": "ESNext"` and `"target": "ESNext"` works well since extensions run in a Chromium renderer.

### Manifest Screenshots

Extensions can include `screenshots` in the manifest to show preview images in the marketplace:

```json
{
  "id": "com.example.my-extension",
  "screenshots": [
    "screenshots/preview-1.png",
    "screenshots/preview-2.png"
  ]
}
```

Paths are relative to the extension root. The marketplace displays screenshots in a carousel on both the in-app detail modal and the web detail page.

## Manifest

`recordly-extension.json` is validated both when the extension loads and when a zip is uploaded to the marketplace.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier, for example `yourname.cool-effect` |
| `name` | `string` | Yes | Human-readable name shown in the UI |
| `version` | `string` | Yes | Strict semver version, for example `1.0.0` |
| `description` | `string` | Yes | One-line summary |
| `author` | `string` | No | Author or organisation |
| `homepage` | `string` | No | HTTPS homepage or repository URL |
| `license` | `string` | No | SPDX license identifier |
| `engine` | `string` | No | Minimum supported Recordly version |
| `icon` | `string` | No | Relative path to a PNG icon |
| `screenshots` | `string[]` | No | Relative paths to preview images shown in the marketplace |
| `main` | `string` | Yes | Relative entry point JS file |
| `permissions` | `string[]` | Yes | Required capabilities |
| `contributes` | `object` | No | Metadata for packaged frames, cursor styles, sounds, wallpapers, and webcam frames |

`contributes` is metadata only today. Recordly does not auto-register runtime behavior from the manifest. Use `activate()` to call APIs such as `registerFrame()`, `registerWallpaper()`, `registerCursorStyle()`, `registerSettingsPanel()`, and `playSound()`.

## Permissions

| Permission | Grants access to |
|-----------|------------------|
| `render` | Render hook registration |
| `cursor` | Cursor telemetry and cursor effect registration |
| `audio` | Bundled sound playback |
| `timeline` | Playback and timeline events |
| `ui` | Settings panels and device frame registration |
| `assets` | Bundled asset resolution plus wallpaper and cursor style registration |
| `export` | Export lifecycle events |

## Render Pipeline

Render hooks draw into `hookCtx.ctx`, a `CanvasRenderingContext2D`, at specific phases.

| Phase | Preview | Export | Notes |
|-------|---------|--------|-------|
| `background` | Reserved | Reserved | Exists in the type surface but is not dispatched yet |
| `post-video` | Yes | Yes | Runs inside the scene transform |
| `post-zoom` | Yes | Yes | Runs inside the scene transform |
| `post-cursor` | Yes | Yes | Runs inside the scene transform |
| `post-webcam` | Yes | Yes | Runs after the built-in transform |
| `post-annotations` | Yes | Yes | Runs after the built-in transform |
| `final` | Yes | Yes | Last pass for HUD-style overlays |

### Inside vs Outside the Scene Transform

- `post-video`, `post-zoom`, and `post-cursor` already follow zoom and motion in preview and export.
- `post-webcam`, `post-annotations`, and `final` run after Recordly restores the canvas transform. Use `sceneTransform` manually if you want those overlays to move with the scene.

### RenderHookContext

```ts
{
  width: number;
  height: number;
  timeMs: number;
  durationMs: number;
  cursor: { cx: number; cy: number; interactionType?: string } | null;
  smoothedCursor?: {
    cx: number;
    cy: number;
    trail: Array<{ cx: number; cy: number }>;
  } | null;
  ctx: CanvasRenderingContext2D;
  videoLayout?: {
    maskRect: { x: number; y: number; width: number; height: number };
    borderRadius: number;
    padding: number;
  };
  zoom?: { scale: number; focusX: number; focusY: number; progress: number };
  sceneTransform?: { scale: number; x: number; y: number };
  shadow?: { enabled: boolean; intensity: number };
  getPixelColor(x: number, y: number): { r: number; g: number; b: number; a: number };
  getAverageSceneColor(): { r: number; g: number; b: number; a: number };
  getEdgeAverageColor(edgeWidth?: number): { r: number; g: number; b: number; a: number };
  getDominantColors(count?: number): Array<{ r: number; g: number; b: number; frequency: number }>;
}
```

Use `videoLayout.maskRect` and `videoLayout.borderRadius` for scene-relative sizing. That gives you true scene borders and correctly shaped rounded corners instead of canvas-wide overlays.

## Cursor Effects

Cursor effect callbacks run each frame after a click until they return `false`.

```js
api.registerCursorEffect((ctx) => {
  const progress = ctx.elapsedMs / 400;
  if (progress >= 1) return false;

  const sceneWidth = ctx.videoLayout?.maskRect.width ?? ctx.width;
  const x = ctx.cx * ctx.width;
  const y = ctx.cy * ctx.height;
  const radius = sceneWidth * 0.03 * progress;

  ctx.ctx.beginPath();
  ctx.ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.ctx.stroke();
  return true;
});
```

`CursorEffectContext` now includes `videoLayout`, `zoom`, and `sceneTransform`, so effects can scale relative to the scene instead of the full canvas.

## API Surface

### Registration

```js
api.registerRenderHook(phase, hook);
api.registerCursorEffect(effect);
api.registerFrame(frame);
api.registerWallpaper(wallpaper);
api.registerCursorStyle(cursorStyle);
api.registerSettingsPanel(panel);
api.on(event, handler);
```

Every registration returns a dispose function.

### Settings

```js
api.getSetting(settingId);
api.setSetting(settingId, value);
api.onSettingChange((settingId, value) => {});
api.getAllSettings();
```

Supported settings field types are `toggle`, `slider`, `select`, `color`, and `text`.

### Assets and Audio

```js
api.resolveAsset("images/overlay.png");
api.playSound("sounds/click.mp3", { volume: 0.8 });
api.log("hello", payload);
```

### Read-only Queries

```js
api.getVideoInfo();
api.getVideoLayout();
api.getCursorAt(timeMs);
api.getSmoothedCursor();
api.getZoomState();
api.getShadowConfig();
api.getKeystrokesInRange(startMs, endMs);
api.getAspectRatio();
api.getActiveFrame();
api.isExtensionActive(extensionId);
api.getPlaybackState();
api.getCanvasDimensions();
api.drawIcon(ctx, "Sparkle", 100, 100, 20, "#2563EB", "regular");
```

### Drawing Icons

Extensions can draw icons from Recordly's bundled Phosphor icon set directly on a canvas context:

```js
api.drawIcon(
  ctx,
  "ArrowClockwise", // icon name from @phosphor-icons/react
  120,              // x (center)
  80,               // y (center)
  18,               // size in px
  "#ffffff",        // color
  "bold",           // optional weight: thin | light | regular | bold | fill
);
```

This is useful for lightweight overlays and avoids bundling your own icon assets.

## Settings Panels

```js
api.registerSettingsPanel({
  id: "my-settings",
  label: "My Extension",
  icon: "sparkles",
  parentSection: "cursor",
  fields: [
    { id: "enabled", label: "Enable", type: "toggle", defaultValue: true },
    { id: "size", label: "Size", type: "slider", defaultValue: 1, min: 0.1, max: 3, step: 0.1 },
    {
      id: "style",
      label: "Style",
      type: "select",
      defaultValue: "ripple",
      options: [{ label: "Ripple", value: "ripple" }, { label: "Pulse", value: "pulse" }],
    },
    { id: "color", label: "Color", type: "color", defaultValue: "#2563EB" },
  ],
});
```

Use `parentSection` to nest your panel inside an existing area such as `cursor` or `scene`.

## Events

| Event | Permission | Description |
|-------|------------|-------------|
| `playback:timeupdate` | `timeline` | Fires each playback tick |
| `playback:play` | `timeline` | Playback started |
| `playback:pause` | `timeline` | Playback paused |
| `cursor:click` | `cursor` | Cursor click detected |
| `cursor:move` | `cursor` | Cursor move detected |
| `timeline:region-added` | `timeline` | Region added |
| `timeline:region-removed` | `timeline` | Region removed |
| `export:start` | `export` | Export started |
| `export:frame` | `export` | A frame was rendered during export |
| `export:complete` | `export` | Export finished |

## Frames, Wallpapers, and Cursor Styles

- `registerFrame()` is the runtime API for device frames. Use a `draw(ctx, width, height)` function when possible for resolution-independent output.
- `registerWallpaper()` contributes scene backgrounds.
- `registerCursorStyle()` contributes cursor image packs.
- All three rely on packaged files relative to the extension root.

## Lifecycle

1. Discovery: Recordly scans built-in extensions and the user extensions directory.
2. Activation: `activate(api)` runs and you register hooks, effects, panels, and assets.
3. Runtime: Registered callbacks execute in preview and export according to their phase.
4. Deactivation: `deactivate()` runs and all registrations are automatically disposed.

## Examples

- `extension-examples/webadderall.more-wallpapers` shows a user-installable wallpaper bundle that registers 180 packaged wallpapers through `registerWallpaper()`.
