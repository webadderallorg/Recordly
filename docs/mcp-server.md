# Recordly AI agent control (MCP)

Recordly can expose its recorder to local AI tools over the Model Context Protocol, so an agent such as Claude Code or Codex can select a window, record a demo, and export the finished video with automatic zooms applied. If you allow it, the agent can also drive the window it records — open a web page, look at it, click, drag, type, press shortcuts and scroll — so a whole demo of any website or app needs nothing but Recordly. The connection is off by default, listens only on the loopback interface, and requires a token that is generated on your own computer. Nothing is sent anywhere: the agent and Recordly both run on your machine.

## Platform support

Recording works everywhere; driving the window works on macOS, Windows and Linux with X11.

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Record, pause, stop, export | Yes | Yes | Yes. Unattended on X11; on Wayland a person confirms the share dialog |
| Driving the window (`open_url`, `screenshot`, `find_elements`, input tools, `perform`) and its switch | Yes — see [macOS](#macos) | Yes — see [Windows](#windows) | Yes on X11 — see [Linux](#linux); not yet on Wayland |
| The `record_demo` prompt | Plans a demo the agent drives itself | Plans a demo the agent drives itself | On X11, a demo the agent drives itself; on Wayland, one the user performs while Recordly records |
| `list_sources` fields | `id`, `name`, `type`, `appName`, `pid`, `windowTitle`, `onScreen`, bounds; windows on every desktop | `id`, `name`, `type` | `id`, `name`, `type`; on Wayland only the **Screen** entry |
| How a window is captured | The display cropped to the window, so keep the window uncovered | The window itself, through Windows Graphics Capture | The screen entry `screen:linux-portal`, listed first (**Entire screen** on X11; **Screen (chosen in the system share dialog)** on Wayland) |

**Linux.** On X11 the **Entire screen** entry records with no prompt. On Wayland, `list_sources` returns only the **Screen (chosen in the system share dialog)** entry, marked `needsUser`, and `start_recording` opens the system share dialog, which a person must confirm — the agent is told to ask you, and the start waits up to 120 seconds for you to do it.

**WSL2.** Recordly listens on `127.0.0.1` on the Windows side. With WSL2's default NAT networking an agent running inside WSL cannot reach that address; set `networkingMode=mirrored` in `.wslconfig`, or run the agent natively on Windows.

## Turning it on

1. Open **Settings → Advanced → AI agent control (MCP)**.
2. Turn on **Let AI agents control Recordly**. Recordly generates a private token and starts listening; the panel then shows **Running at `http://127.0.0.1:43831/mcp`**.
3. Press **Copy setup command** and paste it into a terminal. That one command registers Recordly with Claude Code, token included. For other tools, use the configuration below.
4. Optionally turn on **Let agents use the mouse and keyboard**, which appears once the connection is on — on macOS, Windows and Linux with X11. On Wayland the row still appears, but the switch is disabled and the reason stands in place of the description. It is off by default. Until you turn it on, an agent can record but not open pages or touch the window: `open_url` and every input tool refuse.

**Regenerate token** issues a new token and invalidates the old one. Every tool you have already configured stops working until you re-add it with the new token.

The address depends on the build, so that a packaged app and a development build can run side by side:

| Build | Address |
| --- | --- |
| Installed app (.dmg, .exe, AppImage) | `http://127.0.0.1:43831/mcp` |
| Development build (`npm run dev`) | `http://127.0.0.1:43832/mcp` |

Settings always shows the address the running app is actually using — prefer it over the table.

## What an agent can do

Two groups of tools — ten for recording and reviewing on every platform, and eleven more for driving the window, registered wherever mouse and keyboard control is supported (macOS, Windows and Linux with X11) — plus one prompt, [`record_demo`](#the-record_demo-prompt). The tools return plain JSON (`screenshot` and `review_recording` also return an image) and refuse with an explanatory message instead of opening a dialog, so an agent never leaves a prompt waiting for a human to click something.

### Recording

| Tool | What it does | Arguments |
| --- | --- | --- |
| `get_status` | Recorder state (`idle`, `starting`, `countdown`, `recording`, `paused`, `stopping`, `finalizing`), the selected source, the path of the last recording, macOS permission status, and the state and progress of the last export. Read-only. | — |
| `list_sources` | Lists capturable screens and windows with their `id`, `name` and `type`. Each screen also carries its bounds (`x`, `y`, `width`, `height` in screen points, in global coordinates so `y` can be negative and you can work out which monitor is left, right or above), its `scaleFactor`, its pixel resolution and `primary` — so with two monitors connected you can tell them apart and pick one. Resolution matters: framing one window out of a recorded display stays sharp at 2× and goes soft at 1×. On Linux a display whose id does not match gets no geometry rather than a guessed one. On macOS, windows on every desktop are listed, not just the current one, each with its `appName`, `pid`, `windowTitle`, `onScreen` flag and bounds, so two windows of the same app can be told apart. On Wayland it returns only the **Screen** entry. Read-only. | — |
| `select_source` | Chooses what to record, by exact `id` or by a case-insensitive substring of the source or app name. Refuses if nothing matches or several things do, listing the candidates. Raises the window. On macOS, if the window is on another desktop, macOS switches to that desktop, and the tool waits until the window is on screen. | `id`, `name` (one of) |
| `start_recording` | Starts capture and returns once it is genuinely running, after the countdown. While mouse and keyboard control is on it also refuses without `scenes`, the scene list the agent rehearsed. Refuses if no source is selected (on Linux it records the screen entry instead), screen-recording permission is missing, the window is on another desktop or minimized, or a recording is already running or still saving. On Wayland it waits up to 120 seconds for a person to confirm the system share dialog. | `countdownSeconds` (0–10, defaults to your setting), `scenes` (the rehearsed scene list, 1–12 lines; required while mouse and keyboard control is on) |
| `pause_recording` | Pauses the running recording. | — |
| `resume_recording` | Resumes a paused recording. | — |
| `stop_recording` | Stops and saves, returning the saved video path once it is written. The editor then opens with automatic zooms already applied. | — |
| `cancel_recording` | Discards the running recording, or aborts the countdown before capture starts. | — |
| `review_recording` | Checks the edited video before export, once the editor shows the latest recording: a contact sheet of up to nine frames (the start, the last frame before each cut and the end, left to right and top to bottom) and a summary — each frame's time and label, raw and final duration, time removed, cuts, zooms, captions, scenes, failed scenes and the longest still stretch left. | — |
| `arm_recording` | Waits until the screen has been still for a moment, then starts recording — so a notification, an animation or a late-loading page doesn't land in the first frames. Takes the same `scenes` as `start_recording`. If the screen never settles it starts nothing and says so. | `wait_for_still_ms` (defaults to 1000), `timeout_ms` (defaults to 30000), `countdownSeconds`, `scenes` |
| `set_cursor` | Leaves the cursor out of the **next** recording, for scenes where the pointer is noise. The user can turn it back on in the editor. | `hidden` |
| `set_overlay` | Moves, hides or unsticks the floating control pill, which sits over the recorded window and is excluded from both the recording and `screenshot` — so a control underneath it is unreachable *and* invisible to the agent. It already lets clicks through while an agent acts; this is for when it still blocks something. `hidden: true` removes the on-screen Stop and Pause, leaving only the tray menu's Stop. Everything resets when the recording ends, and nothing applies until the pill exists, so call it after `start_recording`. | `position` (a corner, or `default`), `hidden`, `click_through` (`auto`, `on`, `off`) |
| `set_do_not_disturb` | Silences notification banners for a take and restores them afterwards. **Best effort:** no operating system offers a stable way to do this, so it reports what happened rather than failing, and on macOS it needs two Shortcuts named `Recordly Do Not Disturb On` and `Recordly Do Not Disturb Off`. If it says it could not, ask the user to set it themselves. | `enabled` |
| `export_video` | Exports the last recording with no save dialog, using the editor's current look — automatic zooms, cursor smoothing, background and frame — and returns the saved path. A long export returns `{ "status": "still-exporting" }`; poll `get_status` until `export.state` is `done` or `failed`. Reports progress to clients that ask for it. | `outputPath`, `format` (`mp4`, `gif`), `quality` (`medium`, `good`, `high`, `source`), `overwrite`, `videoPath` (export a recording other than the last; the editor must have it loaded, so call `recover_recording` first), `aspect` (e.g. `16:9`) or `padTo` (e.g. `2880x1600`) — letterboxed with bars, never stretched; `scale` (0.05–1, shrink only, and not with `padTo`); `fps` (1–120); `posterAtMs` (the frame to use as the file's cover, instead of the first). All five are mp4 only. Returns `width`, `height`, `durationMs` and `fps` of the file it wrote, or a `probeNote` if it could not be read back. `fromMs`/`toMs` render only that span of the **edited** timeline — the cheap way to check a change, since you pay for the seconds you render instead of the whole file. The result is marked `fragment: true` with a note saying it is not the finished video and that every time inside it is measured from the fragment's start. Annotation, caption and zoom *timings* are exact, but a zoom already under way at `fromMs` settles in from rest instead of arriving mid-flight, and the result says so. It also samples the written frames and returns `warnings` naming any moment with no picture — black, or a single flat colour, which is what a broken render leaves behind. A check that could not run is a warning too, never silence |

### The recording library

| Tool | What it does | Arguments |
| --- | --- | --- |
| `list_recordings` | Lists the recordings in the library, newest first, with path, size and date. Use it to find a take that was interrupted. Read-only. | — |
| `verify_export` | Checks a video file for frames with no picture. `export_video` already does this to what it writes; this is for a file exported earlier. It samples frames across the file and names the moments that are black or a single flat colour — a file can have the right size and length and still be minutes of bare wallpaper. It cannot tell a deliberate fade or a plain card from a fault, so it reports and you decide. | `path`, `samples` (1–32, default 8) |
| `open_editor` | Opens the editor on a recording — which every editing tool and `export_video` needs, and none of them can do for itself. After an app restart there may be no editor window at all, and the only way in used to be recording a throwaway clip, which then left the wrong recording loaded. Pass a `path`, or omit it for the current recording or the newest one. It opens or focuses the window and waits for the editor to report **the recording you asked for**, polling for up to 15 seconds rather than believing the first answer — an editor already open on another take replies instantly with that one. Only trust the reply when `showing` equals the path you asked for; editing anyway would act on the wrong recording. `editorReady: false` means only the window is guaranteed, and `showing` names the recording the editor actually answered with, which may not be the one you asked for. Refused, changing nothing, for a relative path, a file that is not a decodable video, no recordings at all, or while a recording or export is running. | `path` |
| `recover_recording` | Adopts a recording Recordly lost track of, so `review_recording` and `export_video` can see it. This is the fix for an interrupted take: the file is on disk but no tool can find it. It validates that the file decodes, then loads it as the current recording. The editor window must be open for `export_video` to follow. | `path` |
| `delete_recording` | **Refuses, naming them, when saved projects use that recording** — a project can hold hours of edits that restoring the video would not bring back; `force` moves it anyway and keeps the projects, which then show a missing-video error until the recording is restored. The reply lists the projects found and any project file it could not read. | Moves a recording to Recordly's own trash, which `restore_recording` undoes. Use this rather than deleting the file yourself. Only accepts a recording inside the library folder. | `path` |
| `restore_recording` | Puts a recording deleted with `delete_recording` back. | `path` |
| `get_editor_state` | Lists what the editor is about to export: the loaded recording, raw and edited durations, and every clip, zoom, annotation, audio region and caption with its times. Read-only. The whole state runs to thousands of tokens on a long take, so ask for a part of it: `include` names the sections to return and the reply says what it left out. | `include` (`clips`, `zooms`, `annotations`, `audio`, `captions`, `speeds`, `sourceAudio`, `scenes`, `look`, `motion`), `clips` (`full`, `summary`, `none`) |
| `get_frame` | Returns one frame, to check that a particular scene landed — `review_recording` only shows the frames before each cut, so it cannot answer "what was on screen at 48 s". `atMs` is a time in the edited timeline by default, mapped through the cuts and speed changes to the moment it came from; `source: "raw"` uses the untouched recording. It shows the recorded screen at that moment, **not** zooms, annotations, captions or background, so use it to check *what* was on screen rather than how the export will look. A time in a cut gap or past the end is refused. | `atMs`, `source` (`edited`, `raw`) |

### Recording a whole screen and driving the apps on it

Select a screen with `select_source` and Recordly records that entire display — not one window, and not a browser tab. With two monitors connected, `list_sources` gives each its own id, bounds and resolution, so an agent can pick the right one.

While a screen is the recorded source, `select_source` with a **window** id no longer changes what is captured: it chooses which window the mouse and keyboard act on. The display keeps recording throughout, so an agent can work in one app, switch to another and carry on in a single take — there is no second file and no gap.

Each switch also moves the camera. Recordly notes the new window's rectangle and the finished video glides from framing the previous app to framing the new one, using the same eased zoom it already applies to clicks; a click zoom takes precedence while it lasts and the framing resumes afterwards. A window that nearly fills the display gets no zoom at all, and the framing is chosen never to crop the app being shown. Framing lives in the edit rather than in the capture, so it can be changed or removed afterwards.

Two limits are worth knowing. The window being driven must be on the display being recorded — otherwise nothing it does would appear in the video, and the tools refuse rather than record a demo of nothing. And two *different* displays cannot be one continuous video: record them separately and join the files.

`screenshot` still shows the window being driven, and its coordinates still mean window points, so existing flows are unchanged. Pass `of: "display"` to see the whole recorded screen instead — useful for finding an app before switching to it. That view reports `scope`, the driven window's rectangle within the display, and a note on converting between the two; steps always aim in window points.

### Editing the video

These change the edit the editor holds, so the editor window must be open. Every one of them is
reversible with `history`, **except `set_look`** — the look is not part of the editor's history, and
each look change says so rather than implying otherwise. Times are milliseconds in the *edited*
timeline, after cuts, not positions in the original recording.

| Tool | What it does | Arguments |
| --- | --- | --- |
| `annotate` | *(takes `preview`)* Puts something over the video for a stretch of time: a **blur** to hide anything private, text, an image, or an arrow. Blur is the one to reach for first — a demo of a real application shows real names, addresses and figures, and nothing else here hides them. Geometry is percent of the frame, origin top-left. | `op` (`add`, `update`, `remove`, `clear`), `kind` (`blur`, `text`, `image`, `figure`), `startMs`, `endMs`, `x`, `y`, `width`, `height`, `space`, plus the fields of that kind. `space` decides what the geometry is measured against: `frame` (the default) sits on the recorded picture and moves with the zoom, which is what a blur must do to keep covering what it hides; `screen` pins it to the output frame, so a title or a logo cannot be cropped away by an active zoom. A blur cannot be pinned |
| `history` | Undoes or redoes the last edit, over the editor's own 100-step history. Covers clips, zooms, annotations, audio and captions. Refuses when there is nothing to undo rather than reporting a success that did nothing. | `op` (`undo`, `redo`) |
| `edit_timeline` | Trims, splits, removes a span, re-speeds a clip, reorders clips, joins another recording on — and aims at a length. `set_scene_duration` gives one rehearsed scene a target length and `fit` brings the whole video to one. Both only shorten and never cut into action, taking time in order: the idle stretches first, then the reading pause after each click down to a floor that stays readable, then the kept footage up to 1.25×. The automatic edit has usually compressed the idle stretches already, which is why the later two levers exist. If the target is still out of reach nothing changes and the error names every lever it tried and by how much it fell short. `join` adds another recording as **one continuous video** — both share a single media source, so the cursor does not jump at the seam and neither clip needs re-scaling. It joins straight, with no crossfade. Recording a whole screen already keeps two apps in one take, so `join` is for genuinely separate takes or two different displays. `freeze` holds the frame at `atMs` for `ms`, which is what gives an end card something to sit on instead of stopping on a live screen — a freeze at the very end holds a frame from up to 50 ms earlier, because the last frame of the media cannot be read exactly. `transition` dips through black across a cut: `atMs` on the cut (it snaps within 250 ms) or `betweenClips`, and `ms` 100–2000, or `0` to remove it. **A crossfade is refused rather than quietly downgraded** — the export decodes one frame at a time and never holds both clips at once, so they cannot overlap. A dip takes its time from the clips it joins, so the video does not get longer. | `op`, `startMs`, `endMs`, `timeMs`, `clipIndex`, `speed`, `fromIndex`, `toIndex`, `index`, `ms`, `targetMs`, `path`, `atMs`, `betweenClips`, `kind` |
| `edit_zoom` | *(takes `preview`)* Overrides the automatic zoom where it guessed wrong. Depth 1–6 is 1.25× to 5×; focus is a fraction of the frame. A new zoom is `manual`, so it keeps the focus given; `auto` follows the cursor instead. Zooms may touch but not overlap. | `op`, `id`, `startMs`, `endMs`, `depth`, `focus`, `mode` |
| `set_look` | *(takes `preview`)* The frame (wallpaper, padding, corner radius, shadow, background blur, crop, webcam) and the motion (zoom durations and easings, cursor style, size, smoothing, click effects, camera and cursor springs). Only the fields passed change; an unknown field is refused rather than ignored. **Not undoable.** `padding` and `borderRadius` are percentages, not pixels, and padding is damped by `PADDING_SCALE_FACTOR` (0.2): 0–100 becomes an inset of 0–20% per side, so `padding: 4` is subtle and even `padding: 100` still leaves the picture at 60% of the frame's width and height. Padding cannot make the video vanish — if the picture is missing, look elsewhere. `borderRadius` is a percent of the shorter side (max 50), `shadowIntensity` is a 0–1 multiplier, and `backgroundBlur` is a blur radius in pixels at a 640px-wide reference, scaled to the export size. `op preset` takes a whole frame in one call. | `op` (`set`, `motion`, `preset`), `fields` (for `preset`, `{name}` — `clean`, `dark` or `none`) |
| `edit_captions` | *(scene captions now work: scene titles passed to `start_recording` survive the capture, and a failure says which of three reasons applies — no scene list, scenes with no titles, or titled scenes that were cut)* | *(takes `preview`)* `generate` with `from: "scenes"` turns the rehearsed scene list into captions at their scene boundaries — a narrated feel with no audio and no voice recording. `from: "audio"` transcribes speech instead, which is slow and needs the Whisper model. `fit_to_scenes` takes one line of text per scene and places each cue wholly inside a single shot, which is the easy way to caption a rehearsed demo: it never crosses a cut, skips scenes with no room and names them, and refuses the call outright if the number of lines does not match the number of scenes rather than truncating. Also set, update, remove, style and animation. Captions show one at a time, so cues may not overlap, and a cue inside a cut is refused. | `op`, `from`, `cues`, `id`, `text`, `startMs`, `endMs`, `all`, `style`, `fields`, `texts` (one line per scene, 80 characters each), `padMs` (0–2000, default 200) |
| `edit_audio` | Adds music or a narration file from an absolute path, sets volumes, silences what the recording captured, or picks which captured track to use. There is no text-to-speech: record or generate the audio elsewhere and pass the file. | `op`, `path`, `startMs`, `durationMs`, `volume`, `trackIndex`, `id`, `muted`, `clipId`, `track`, `normalize` |

**`preview: true` on an edit.** `annotate`, `edit_zoom`, `set_look` and `edit_captions` accept it. The edit is applied as usual and the reply also carries a composited frame of the moment that changed, so checking stops being a separate step. The moment is the midpoint of the region added or changed; `set_look` has no region, so it uses the middle of the timeline and says so. If the picture cannot be made the edit still stands — the reply says `previewError` and explains why, and the edit remains in the undo history. Removals do not take it, since there is nothing to show.

| `edit_project` | Saves the edit under a name, opens a saved one, or starts again. Until now an edit lived only in the editor's memory against the current recording — no name, no second version — so a restart lost the work. `save` writes clips, zooms, annotations, captions, audio and the look and reports the counts; `open` loads one by name or absolute path; `new` clears back to the untouched recording. Opening refuses while there are unsaved changes unless you pass `discard`, and opening a project made from a different recording switches the editor to it and says so. Saving under a name belonging to a different project is refused rather than overwriting. The look is saved and restored; the thumbnail is not. | `op` (`save`, `open`, `new`), `name`, `path`, `discard` |
| `add_card` | A title or end card. It is **new time** — the timeline grows by `durationMs` — and the card sits on a held frame behind an opaque fill rather than on empty space, so it composites everywhere the rest of the video does. `op` only picks the title size and the default position; `position` overrides it, so `op: "end"` with `position: "start"` is a chapter card. `background` is hex only and anything else is refused rather than defaulted; a `logo` must be an absolute path to an image that reads, checked before anything changes. One undo takes back the card, its text and the region shifts together. | `op` (`title`, `end`), `text`, `subtitle`, `background`, `logo`, `durationMs`, `position` |
| `check_edits` | Looks for mistakes in the current edit **without rendering anything** — instant and free, so run it after a batch of edits and before any preview or export. It catches what is most expensive to find late: a title or logo in the default `frame` space that an active zoom will crop out of view, a crop or padding that leaves too little picture, a blur over a moving zoom, geometry off the frame, an empty or inverted region, and a caption that was legal when written and was made illegal by a later trim or split (the cut rule runs only at write time, so nothing else re-checks it). Every problem carries the moment to look at, so pass its `atMs` straight to `render_preview`. `severity: "error"` is certainly wrong, `"warning"` is worth a look; the reply also lists the checks that ran, so nothing-wrong is distinguishable from not-checked. Read-only. | — |
| `render_preview` | Shows what the **export** will look like, before paying for one. `get_frame`, `sample_frames` and `review_recording` all return the recorded screen; this composites the frame through the export renderer — cuts and speed, zooms, the look, the cursor, annotations and captions. It is how you check a blur covers the right thing, where a caption sits, or whether an active zoom crops a title. Each frame is a full composite rather than an ffmpeg tile, so a sheet of 6 can take tens of seconds. The first call loads the recording and starts the renderer; both are then kept warm for 60 seconds, so a following single frame returns quickly and `reused` reports which half was warm. An edit that changes the picture invalidates the renderer, which is what stops a stale frame being served. The reply lists which layers it drew and which it could not, with the reason, so a partly composited frame is never passed off as the finished look. It is the **same renderer module the export instantiates**, and it now composites on the canvas shape the editor's export aspect ratio will use, so there is no pipeline difference left to account for. `aspect`, `padTo` and `scale` letterbox it exactly as the export's own pass would — measured against real ffmpeg, down to ffmpeg truncating pad offsets to the chroma grid. | `atMs` (one frame, edited time) **or** `count` (2–6) **or** `everyMs` (≥17, total 2–6), plus `aspect`/`padTo`/`scale` |
| `sample_frames` | Sweeps the whole video as a contact sheet of evenly spaced frames. `review_recording` shows only the frames before each cut and `get_frame` only one moment, so this is the only way to check a long take for a leaked address or a stray window. 2 to 12 frames; tiles are small, so use it to spot a suspect moment and `get_frame` to read it. | `everyMs` or `count` (exactly one), `source` |

### Driving the window

These tools are offered on macOS, Windows and Linux with X11. On Wayland they aren't offered, so the agent never sees them; [Mouse and keyboard control](#mouse-and-keyboard-control) describes each platform. Every tool in this section refuses while **Let agents use the mouse and keyboard** is off.

| Tool | What it does | Arguments |
| --- | --- | --- |
| `set_window_bounds` | Moves and resizes a window, in the screen coordinates `list_sources` reports. Use it to frame a demo before recording: put the window on the main display at a landscape size, at least 1.2 × as wide as tall so automatic zooms work. It is also the fix for an app that opens off-screen or on another display. The window manager may adjust the rectangle; the result says what it ended up as. | `source` (defaults to the selected window), `x`, `y`, `width`, `height`, `raise` |
| `open_file` | Opens a file in its usual app (or `with_app`), waits for its window and, with `then_select_source`, selects it as the capture source — one call for "open the file that was just downloaded and record it". Refused while recording. | `path`, `with_app`, `then_select_source` |
| `wait_for_download` | Waits until a file matching a path pattern has finished downloading, then returns it. A part-written file never matches, and nor does a file that was already there. | `glob` (absolute path with `*` or `?` in the file name), `timeout_ms` (defaults to 60000) |
| `undo_last_input` | Asks the focused app to undo, by sending its undo shortcut. **Best effort and nothing more:** it cannot take back a click, only ask the app to undo what the click did, and an app with nothing to undo ignores it. | — |
| `open_url` | Opens an `http` or `https` address in your default browser — the one you are already signed in to — and selects the window showing it, so the next step can be `screenshot`. Refused while recording; the agent navigates inside the page with `perform` instead. | `url` |
| `screenshot` | A picture of the selected window, exactly the pixels a recording would capture, plus `width` and `height` of the image and `scale`, the number of window points per image pixel. If part of the window is off screen it also returns `originX` and `originY`. With `region`, it shows only that rectangle of the window at up to the display's full resolution, for aiming at small controls, and always returns `originX` and `originY`: window point = origin + image pixel × `scale`. Read-only. | `region` (optional: `x`, `y`, `width`, `height` in window points) |
| `find_elements` | Finds buttons, links, fields and other controls in the selected window by visible text or accessibility role, and returns each one's `role`, `label` and frame (`x`, `y`, `width`, `height`) in window points. Apps that draw their own interface, such as canvas editors and games, may expose few elements; the agent then picks points off a screenshot. Read-only. | `text`, `role`, `limit` (all optional) |
| `click` | Glides the pointer to a point — or to a `target`, an element found by its text when the step runs — and clicks there. `count` 2 double-clicks and 3 triple-clicks, which selects a line or paragraph in most apps. Modifiers are held during the click, so `["cmd"]` makes a cmd-click; a modifier click needs the recorded window frontmost. | `x`, `y` or `target`, `button` (`left`, `right`, `middle`), `count` (1–3), `modifiers`, `durationMs` |
| `drag` | Glides to the start point, presses the button, holds, moves to the end point with easing and releases — to move or reorder items, resize a pane, draw, or select a range. Its speed follows the distance unless `durationMs` says otherwise. Each end can be a point or an element (`from`, `to`), and both must be inside the window, and the button is always released, even when you take over. A drag with modifiers needs the recorded window frontmost. | `fromX`, `fromY` or `from`, `toX`, `toY` or `to`, `button`, `modifiers`, `durationMs` |
| `move_pointer` | Glides the pointer to a point or element without clicking, for hovering. | `x`, `y` or `target`, `durationMs` |
| `scroll` | Scrolls whatever is under a point, in pixels: positive `deltaY` scrolls down, positive `deltaX` scrolls right. Modifiers are held while it scrolls and need the recorded window frontmost; shift-scroll scrolls sideways in many apps. | `x`, `y` or `target`, `deltaY`, `deltaX`, `modifiers` |
| `type_text` | Types text into the focused field, a character at a time at a natural pace. Any text works — other languages, emoji, symbols — whatever your keyboard layout. A newline (`\n` or `\r\n`) presses Return and a tab (`\t`) presses Tab; nothing else is pressed, so end the text with `\n` to submit it. With `into`, it first clicks that field. | `text`, `into` |
| `press_key` | Presses one key or shortcut, optionally several times in a row, about 35 ms apart. See [Keys and modifiers](#keys-and-modifiers). | `key`, `modifiers`, `repeat` (1–100) |
| `wait_for` | Waits until an element appears (`text`, `role`), disappears (`gone`), or the screen stops changing (`settled`). Element waits fail after `timeoutMs` (10 seconds by default); `settled` carries on. | `text`, `role`, `gone`, `settled`, `timeoutMs` |
| `perform` | Runs a list of steps — `move`, `click`, `drag`, `scroll`, `type`, `key`, `wait`, `hold`, `expect` and `waitFor` — back to back with exact timing. Targets let one call cross several pages. Left without durations, Recordly glides at a natural speed and, after a click or Enter, waits for the screen to settle and holds the result for reading; `pace` makes that brisk, normal or relaxed. `dryRun` acts on nothing: it probes the targets up to and including the first step that can change the page, reporting each one numbered from 1 like `Step n`, and marks the steps after it `found: null` with the note `validated at run time` — they are checked as they run. A `found: false` with `candidates > 1` means the target is ambiguous, not missing. `then: "elements"` returns the visible controls afterwards, and both it and `dryRun` return a `page` signature, so the agent can tell whether the take started on the page the rehearsal ended on. Up to 200 steps, waits of up to 30 seconds, and 10 minutes per call. An optional `title` names the scene and becomes an on-screen caption. A failed step's message starts with `Step n`.<br><br>Three levers are worth knowing because they are easy to miss. `hold {ms}` — the same thing as `wait {ms}` — is kept whole in the finished video, so it is how you give one screen eight seconds of reading time; `waitFor` is shortened to a brief pause instead, because it is for slow content rather than for the viewer. `durationMs` sets the glide of a single move, click or drag. `expect {target}` fails the scene the moment a target is missing, rather than carrying on into a page that has diverged. `safeRegion` refuses any click, drag or move whose point falls outside a window-relative rectangle, including the small re-aim nudge — use it when a stale coordinate could hit something destructive. | `steps`, `title`, `pace`, `dryRun`, `then`, `safeRegion` (all but `steps` optional) |

**Targets are found when the step runs.** A target is `{ "text": …, "role": …, "index": … }`: part of the element's label or text in any case, optionally its kind (`button`, `link`, `textfield`, `checkbox`, `tab`, `menuitem` and so on) and, when several match, which one counting from 0 top to bottom. Recordly waits up to 5 seconds for it to appear, scrolls it into view if it is hidden below or above, and refuses with the candidates when it is ambiguous. Because the element is looked up at that moment, one `perform` can click a link, land on the next page and carry on there.

**Coordinates are window-relative points.** `0, 0` is the top-left corner of the selected window, whatever desktop or display it is on, and a point is the unit macOS uses for window sizes, not a screen pixel. `find_elements` already answers in points; for a spot picked off a screenshot, multiply its image pixel position by `scale`. Every target, including both ends of a drag, must fall inside the selected window, which Recordly re-measures before each step, so the pointer cannot wander onto anything else.

**Use `perform` while recording.** Each separate tool call waits for the agent to think. Recordly cuts that time from the video, but a scene split across many calls turns into many small cuts. One `perform` per scene — click, wait two seconds or so for the page to settle, type, scroll — keeps the motion continuous and the pacing even. Each step takes the same arguments as the matching single tool, plus `action`; `wait` takes `ms`:

```json
{
  "steps": [
    { "action": "click", "x": 412, "y": 296 },
    { "action": "wait", "ms": 2500 },
    { "action": "click", "x": 640, "y": 118 },
    { "action": "type", "text": "Quarterly report\n" },
    { "action": "wait", "ms": 2000 },
    { "action": "key", "key": "down", "repeat": 3 },
    { "action": "key", "key": "s", "modifiers": ["cmd"] },
    { "action": "wait", "ms": 2000 },
    { "action": "drag", "fromX": 300, "fromY": 420, "toX": 300, "toY": 220, "durationMs": 900 },
    { "action": "move", "x": 520, "y": 380, "durationMs": 800 },
    { "action": "scroll", "x": 520, "y": 380, "deltaY": 480 }
  ]
}
```

**Clicks are real.** Recordly moves your actual pointer and posts actual clicks, so they reach the recording exactly like yours: the cursor glides, changes shape over links and fields, and the editor adds its automatic zooms where the agent clicked. Automatic zooms need a landscape window — at least 1.2 times as wide as it is tall.

**Keep the window in front and uncovered.** On macOS a recording is the display cropped to the window's frame, so anything on top of it — another window, a notification banner — ends up in the video. Recordly raises the window before recording and before every action, but don't drag other windows over it, and consider a Focus mode to hold back notifications.

A recording-only run is `list_sources` → `select_source` → `start_recording` → perform the demo → `stop_recording` → `export_video`. Recordly ships these instructions to the agent itself, so in practice you can just ask for the recording you want.

### Keys and modifiers

`press_key` and the `key` step of `perform` take a key name, an alias, or one character.

| Keys | Names | Also accepted |
| --- | --- | --- |
| Editing | `enter`, `tab`, `escape`, `backspace`, `delete`, `space` | `return`; `esc`; `del`, `forwarddelete`; `spacebar` |
| Arrows | `up`, `down`, `left`, `right` | `arrowup`, `uparrow`, and the same for the other three |
| Navigation | `home`, `end`, `pageup`, `pagedown` | `pgup`, `pgdn` |
| Punctuation keys | `minus`, `equal`, `leftbracket`, `rightbracket`, `backslash`, `semicolon`, `quote`, `comma`, `period`, `slash`, `grave` | `hyphen`, `dash`; `equals`; `apostrophe`; `backtick` |
| Function keys | `f1`–`f20` | — |
| Keypad | `keypad0`–`keypad9`, `keypaddecimal`, `keypadplus`, `keypadminus`, `keypadmultiply`, `keypaddivide`, `keypadenter`, `keypadequals`, `keypadclear` | — |
| Letters and digits | `a`–`z`, `0`–`9` | — |

Names ignore case, spaces, `_` and `-`, so `Page Up`, `page_up` and `pageup` are the same key. A single character is pressed with the key that types it on your current keyboard layout, and Recordly adds Shift or Option when the layout needs them: `?` works, and `A` means Shift-a. A character that isn't a single key on the layout — `é` on a US layout, for example — is typed as text when no modifiers are given; with modifiers it is refused. A key of `\n` or `\t` means `enter` or `tab`; other control characters are refused. A combined string such as `"cmd+c"` is refused too, with a hint to pass the modifiers separately.

`backspace` deletes the character before the caret; `delete` is forward delete, the ⌦ key (fn-Backspace on a laptop keyboard).

Modifiers are held down during a key press, click, drag or scroll, at most five at a time: `cmd` (also `command`, `meta`, `super`, `win`, `windows`), `shift`, `alt` (also `option`, `opt`), `ctrl` (also `control`) and `fn` (also `function`). `ctrl`, `alt`, `shift` and `cmd` are pressed as real modifier keys; `fn` is only a flag on the event. Key presses, typing and any action with modifiers go only to the recorded window, so they need it frontmost — if another window is in front, the tool refuses and the agent brings the window forward with `select_source` before trying again.

| Shortcut | Call |
| --- | --- |
| cmd-S | `{ "key": "s", "modifiers": ["cmd"] }` |
| cmd-shift-Z | `{ "key": "z", "modifiers": ["cmd", "shift"] }` |
| cmd-comma, an app's settings | `{ "key": ",", "modifiers": ["cmd"] }` |
| Right arrow five times | `{ "key": "right", "repeat": 5 }` |
| A question mark | `{ "key": "?" }` |
| Shift-Tab | `{ "key": "tab", "modifiers": ["shift"] }` |

To enter words, use `type_text` rather than one `press_key` per character.

## Recording a demo with only Recordly

With both switches on, an agent can produce a finished demo of any website or desktop app with no browser automation tool of its own. Ask for it in plain words, for example *"Record a demo of signing up at https://example.com and changing the profile photo, and save it to ~/Movies"*. The agent then works through these steps:

1. **`open_url`** with the page — or, for a desktop app, **`list_sources`** and **`select_source`**. A page opens in your default browser, already signed in, and its window becomes the selected source. For a demo that crosses two apps, it selects a **screen** instead: the whole display records while `select_source` with a window id chooses which window the mouse and keyboard act on, and that can change mid-take.
2. **`screenshot`** and **`find_elements`** to learn the screen and write out the scenes and the exact target for every step. Nothing is being recorded yet, so this can take as long as it needs.
3. **Rehearse the whole flow unrecorded**, one page at a time: `perform` with `dryRun` for that page's targets, then the page's steps for real with `then: "elements"` to confirm the page went where the plan said. Anything with a side effect — submitting, deleting — happens here.
4. **Reset to the starting state**, **`move_pointer`** to where the first scene begins, then **`start_recording`** with the rehearsed scene list.
5. **`perform`** once per scene, replaying only steps the rehearsal proved, aimed at targets. Recordly paces the motion and holds each result for reading.
6. **`stop_recording`**. The editor opens with the agent's thinking time already cut and zooms on its clicks (see [Automatic edits](#automatic-edits-for-agent-recordings)).
7. **`review_recording`** to check the contact sheet and summary, and **`sample_frames`** to sweep the parts between the cuts. Anything private still on screen is covered with **`annotate`** blur — nothing else hides it, and `history` undoes a blur that landed wrong.
8. **`export_video`** with the destination and format you asked for. It reports the written file's `width`, `height`, `durationMs` and `fps`, so the agent can confirm the result without another tool. If the file cannot be read back the export still succeeds and a `probeNote` says why.

The cut is not fixed at this point. `edit_timeline` trims, splits, re-speeds and can bring the whole video to a target length; `edit_zoom` overrides a zoom that guessed wrong; `edit_captions` can caption from the scene list without any audio; `edit_audio` adds music or narration; `set_look` sets the frame and the motion. Every one of those is reversible with `history`, except `set_look`, which the editor does not track.

Keep your hands off the mouse and keyboard while it runs: touching either stops the agent (see [Mouse and keyboard control](#mouse-and-keyboard-control)). If you do take over, only that scene ends: Recordly cuts it from the video and the agent waits until you are done, re-aims from a fresh screenshot and continues with the next `perform`. It asks you only if you clearly want the machine back.

### The `record_demo` prompt

Recordly also offers an MCP prompt, `record_demo`, that hands the agent this plan step by step for whatever you want to show. Claude Code lists it as the slash command `/mcp__recordly__record_demo`, taking the arguments in this order, for example `/mcp__recordly__record_demo "signing up and changing the profile photo" https://example.com`. Other clients list it with their prompts.

| Argument | Required | What it is |
| --- | --- | --- |
| `goal` | Yes | What the demo should show, in plain words |
| `url` | No | The web page to start from |
| `app` | No | The desktop app or window to record, when it isn't a web page |
| `output_path` | No | Where to save the video: an absolute path ending in `.mp4` or `.gif` |

Where driving the window is available, the plan has the agent drive it itself. On Wayland it is a recording-only plan: the agent selects the source and records while you perform the demo, and asks you to confirm the share dialog.

## Asking for a demo

The agent plans the scenes, rehearses the whole flow unrecorded and then records it, so your request should
say **what to show and what must not happen** — not how to click. This shape works for any app or site:

```
Record a demo video with Recordly.

Start at: <URL, or the name of the app window>
Show: <the one thing a viewer should come away understanding>
Path: <the steps, in order, in plain words>
For: <who watches it>
Don't: <anything that would change data>
Hide: <anything on screen that must not be published>
Save to: <absolute path>.mp4
```

Two lines are worth adding when they apply. **Hide** matters whenever the demo runs against real data: the
agent can blur names, addresses and figures, but only if it knows they are sensitive — it cannot tell a
real customer from test data by looking. And if the flow **crosses two apps** (download a file, then open
it), say so: the agent records the whole screen for that instead of one window, and the result is a single
continuous take rather than two clips joined.

A filled-in example:

```
Record a demo video with Recordly.

Start at: https://example.com/orders
Show: how to find an unpaid order and open its payment history.
Path:
  1. From the orders list, filter to unpaid.
  2. Pause on the list so the viewer can read the columns.
  3. Open the first order and show the payment history panel.
For: a new support agent.
Don't: edit, refund or save anything. Navigation only.
Save to: ~/Movies/unpaid-orders.mp4
```

**Leave these out.** The agent handles them, and naming them makes the result worse:

- **Coordinates or internal element names.** It finds controls by their visible text and checks them before clicking.
- **Timings and waits.** It paces the motion and holds each result long enough to read. A `wait` you ask for
  *replaces* that reading hold rather than adding to it.
- **"Screenshot after every step."** It does that while rehearsing; during the take each extra call is another cut.

**What spoils a take**

- **A vague goal.** "Show me the product" gives a tour with no point. Name the one thing the viewer should learn.
- **Asking for side effects.** Anything that submits, deletes or completes changes real data and cannot be
  rehearsed safely. If the demo needs it, say so and use test data.
- **Not saying where to start.** Without a URL or a window name the agent has to guess which window to drive.
- **Touching the mouse or keyboard.** Any input of yours stops the agent at once. Stay hands-off from the start
  of recording until the export finishes.
- **An empty or shifting screen.** If a list has no rows, or a count changes between the rehearsal and the take,
  targets whose text contains that number stop matching. Load the data first.

**Two optional extras.** Ask for captions and each scene gets a title on screen (off by default); say "keep it
brisk" or "take it slowly" to change how long results are held.

## Writing a good demo

These habits make a clean video of any app or site, whether you ask in plain words or use `record_demo`:

- **Tell one story.** One goal per video, split into a few scenes that each show one thing. Say in the request what the viewer should come away knowing.
- **Prepare the window.** Make it landscape — at least 1.2 times as wide as tall — so automatic zooms work, and keep it uncovered. `set_window_bounds` can do this for the agent. Sign in, load any sample data, and close what you don't want seen before the agent starts.
- **Say what must not be published.** A demo against real data shows real names, addresses and figures. The agent can blur them, but it cannot tell real data from test data by looking, so name what is sensitive in the request. `sample_frames` is what catches the rest: `review_recording` only shows the frames around each cut, so a leak in the middle of a long take will not appear there.
- **Rehearse before recording.** The agent never records a flow it has not already run, on any platform where it can drive the window. It works in three phases. It *plans* with `screenshot` and `find_elements` while nothing is recorded, writing out the scenes and the exact target for every step. It *rehearses* the flow for real but unrecorded, one page at a time: `perform` with `dryRun: true` to check that page's targets — a dry run only probes the page the agent is on — then the page's steps with `then: "elements"` to confirm the page went where the plan said. Side effects — submitting, deleting — happen in the rehearsal, not in the take. Then it resets to the starting state and *takes* the video, replaying only steps it has already watched work.
- **Aim by text.** Targets name the element to click, so the click lands on its centre wherever the page puts it. For a control with no label, the agent screenshots a small region around it (about 300 × 200 points), which comes back at the display's full resolution, instead of guessing from the whole-window image.
- **Start with the cursor in place.** The agent moves the pointer to where the first scene begins before `start_recording`, so the video does not open with the cursor somewhere else.
- **Leave the timing to Recordly.** Glides follow the distance, each click or Enter waits for the screen to settle and then holds the result for reading, and the pointer rests on the target briefly before pressing so the drawn cursor is on it when the click lands. A `wait` or `waitFor` straight after a click replaces that hold, so the agent adds a `wait` only for longer reading time and a `waitFor` only for slow content.
- **Captions only when you want them.** Ask for captions or a step-by-step tutorial and the agent gives each scene a `title`, shown at the bottom of the video as the scene starts.
- **Check the result before exporting.** `review_recording` shows the edited video as a contact sheet, so the agent can spot an error page or a covered window and offer to record that part again.
- **Words with `type_text`, shortcuts with `press_key`.** Typed text appears at a natural pace in any language; shortcuts read as instant actions.
- **Recover, don't push on.** A step that fails during the take almost always means the page diverged earlier — a click that landed on the wrong element — so the scenes already recorded are wrong too. The agent does not retry the step or carry on from where it broke: it diagnoses the cause, and if that can be fixed off camera it uses `pause_recording`, fixes it and `resume_recording`. If it cannot, it calls `cancel_recording`, fixes the plan so the cause cannot recur, rehearses again and takes the video again. A ruined take is re-taken, not patched.

## Automatic edits for agent recordings

While an agent drives the window, Recordly notes what it does and when. When the recording opens in the editor, Recordly uses those notes to edit it:

- **Thinking time is cut.** The time between the agent's tool calls — while it looks at the screen and decides the next step — is removed, as is the wait before the first action. A short lead and tail are kept around every action so the cuts don't feel abrupt.
- **Waiting is shortened.** A window coming to the front shrinks to a brief beat.
- **Actions and reading time stay.** Every movement, click, scroll, keystroke and the agent's own `wait` steps are kept in full.
- **Zooms follow the actions.** Each click zooms in from the moment the pointer heads for it until the result has been on screen, close clicks share one zoom, and nothing zooms on a large target or while scrolling.
- **An interrupted scene is removed.** A takeover ends the scene, not the recording, and any scene that fails, for whatever reason, is cut from the video automatically. The agent carries on with the next `perform`. When a step fails, the steps before it stay in the recording, so you can see where the take diverged before the agent discards it.

The edits are ordinary clips, zooms and captions on the timeline, so you can change or undo any of them, and `export_video` exports them. Recordings you make yourself are not affected. To turn this off, clear **Tighten agent recordings** in the editor settings.

## Adding Recordly to your AI tool

Every example needs two values from the settings panel: the **address** and the **token**. Replace `YOUR_TOKEN` throughout.

### Claude Code

The **Copy setup command** button produces exactly this:

```bash
claude mcp add --scope user --transport http recordly http://127.0.0.1:43831/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
```

To write it by hand instead, add this to `~/.claude.json` for every project, or to a project's `.mcp.json` to share it with a repository:

```json
{
  "mcpServers": {
    "recordly": {
      "type": "http",
      "url": "http://127.0.0.1:43831/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

### Codex CLI

Codex reads the token from an environment variable rather than from its configuration file:

```bash
export RECORDLY_MCP_TOKEN=YOUR_TOKEN
codex mcp add recordly --url http://127.0.0.1:43831/mcp \
  --bearer-token-env-var RECORDLY_MCP_TOKEN
```

That writes the following to `~/.codex/config.toml`, which you can also add by hand:

```toml
[mcp_servers.recordly]
url = "http://127.0.0.1:43831/mcp"
bearer_token_env_var = "RECORDLY_MCP_TOKEN"
```

Export `RECORDLY_MCP_TOKEN` from your shell profile, or Codex will start the server without credentials and every call will fail with `401`.

### Other clients that speak streamable HTTP

Most MCP clients accept a URL and a set of headers. The shape of the file differs but the two values do not:

```json
{
  "mcpServers": {
    "recordly": {
      "url": "http://127.0.0.1:43831/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

Some clients name the field `httpUrl` or require `"type": "http"` alongside the URL; check your client's documentation for which of the two it expects.

### Clients that only speak stdio

A client that can only launch a command can reach Recordly through the `mcp-remote` bridge. Pass `--transport http-only`, because Recordly serves streamable HTTP and has no SSE endpoint:

```json
{
  "mcpServers": {
    "recordly": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://127.0.0.1:43831/mcp",
        "--transport",
        "http-only",
        "--header",
        "Authorization: Bearer YOUR_TOKEN"
      ]
    }
  }
}
```

## How the connection is secured

Anything able to reach the port can start a recording of your screen, so the server is deliberately narrow:

- It binds `127.0.0.1` only, so nothing outside this computer can reach it, and it stays closed until you turn the setting on.
- Every request must carry `Authorization: Bearer <token>`, compared in constant time. Anything else gets `401`.
- The `Host` header must be `127.0.0.1` or `localhost` at the expected port, which blocks DNS rebinding.
- Requests carrying an `Origin` header are refused with `403`. This is why a web page cannot drive Recordly even though the port is local — only a local process can.
- Only the `/mcp` path answers; everything else is `404`. Bodies over 1 MB are rejected with `413`.
- The token lives in `mcp-server.json` in Recordly's user-data folder, written with `0600` permissions, and never in the shared application settings.

Treat the token like a password. If you paste it somewhere public, press **Regenerate token**.

### Mouse and keyboard control

Driving your mouse and keyboard is far more powerful than recording, so it has its own switch and its own limits. It works on macOS, Windows and Linux with X11; the sections below describe each platform.

#### Every platform

- **Let agents use the mouse and keyboard** is off by default and stored with the connection settings. While it is off, `open_url` and every input tool refuse; `screenshot` and `find_elements` still work.
- Input goes only into the selected window. Pointer targets must fall inside it, re-measured before every step, and typing and key presses go to it only while its app is frontmost — never to Recordly's own editor or to whatever happened to be in front.
- You can always take back control. Moving the mouse, clicking, scrolling or pressing any key yourself stops the running action or `perform` at once, and pressing **Esc** does the same. A pointer drift of a few points, such as a hand resting on the trackpad, does not count, and neither do two fingers resting on it without scrolling. The agent is told *stopped: the user took over*, along with what Recordly noticed, and is instructed to wait until you are done, re-aim and continue with the next `perform`; the interrupted scene is cut from the video. Esc, or a clear request for the machine back, makes it stop and ask.
- `set_input_policy { onTakeover, autoResumeAfterMs?, tolerancePx? }` changes the reaction. The default, `abort`, ends the `perform` at once. `pause` stops acting, waits until the pointer has been still for `autoResumeAfterMs` (default 2000), then re-arms and carries on with the interrupted step and the rest of that `perform`; the pause is logged as waiting, so the editor shortens it. `tolerancePx` (default 8, macOS only) is how far the pointer may drift in one second before it counts as a takeover. Esc always aborts, under either policy.
- **Pacing levers.** `wait {ms}` is the hold: it is logged as a hold and kept whole in the video, so use it for longer reading. `waitFor` is logged as waiting and shortened, so use it only for slow content. `durationMs` on `move`, `click` and `drag` sets that step's glide. There is no separate `hold` step.
- Clicks are real posted events, not simulated inside a page, so the recording shows the cursor moving and the editor adds automatic zooms where the agent clicked.
- `open_url` accepts only `http` and `https` addresses.
- `perform` is capped at 200 steps, 30 seconds per wait and 10 minutes per call; a key may repeat at most 100 times.

#### macOS

- Recordly needs two macOS permissions: **Screen Recording**, to record and to take screenshots, and **Accessibility**, to post input and read controls for `find_elements`. macOS grants both to the app, not to the agent, and when one is missing the tools say so instead of failing silently.
- The window must stay uncovered, because the recording is the display cropped to the window.
- In a development build (`npm run dev`) macOS checks the Accessibility permission of the terminal app that started Recordly, not Recordly itself, so input fails there even when Recordly is allowed. Use the installed app to test agent control.

#### Windows

[Platform support](#platform-support): driving the window works on Windows with the same tools and the same switch.

- A native helper posts input with `SendInput` and tags every event, so Recordly can tell its own input from yours. Text is typed as Unicode characters, so any language and emoji work whatever the keyboard layout; single-character keys follow the layout of the window in front.
- `find_elements` and targets read controls through UI Automation. Roles come back as UI Automation names such as `Button`, `Edit` and `Heading`; the role names used on macOS are accepted too. Browsers built on Chromium expose their page to UI Automation once Recordly asks for it, which the first lookup in a window does. Text inside rich-edit documents, such as Notepad's page, is not searchable.
- The helper works with the foreground rules to raise the selected window, restoring it if it is minimized.
- Low-level mouse and keyboard hooks detect when you take over, with the same tolerance as on macOS.
- No special permission is needed. Windows blocks input from a normal process into windows that run as administrator, so the tools refuse an elevated window with a clear message unless Recordly itself runs elevated.
- `cmd` is the Windows key here: shortcuts use `ctrl`, for example `{"key":"c","modifiers":["ctrl"]}`.
- The recording captures the window itself, but clicks land wherever the window is on screen, so keep it in front and uncovered while the agent acts.

#### Linux

[Platform support](#platform-support): on Linux, driving the window works on X11. On Wayland it is refused with a clear message, and recording works as described above.

- A native helper posts input through XTest and detects takeover through XInput2. XTest events can't carry a tag, so the helper keeps a short record of what it just posted and treats any other input as yours, with the same tolerance as on macOS.
- `find_elements` and targets read controls through AT-SPI, the Linux accessibility bus, which most desktops run. Chromium-based browsers and Electron apps join it only when started with `ACCESSIBILITY_ENABLED=1`, for example `ACCESSIBILITY_ENABLED=1 google-chrome`; otherwise the agent aims with region screenshots instead.
- The whole screen is recorded. `open_url`, or `select_source` with a window's `id`, picks the window the agent acts on; the recording stays on the screen. With no window picked, the control tools refuse rather than type into whatever is in front.
- A window manager that follows the EWMH standard raises the selected window; GNOME, KDE, Xfce, Cinnamon and most others do.
- No special permission is needed.
- `cmd` is the Super key here: shortcuts use `ctrl`, for example `{"key":"c","modifiers":["ctrl"]}`.
- **Wayland later.** Wayland blocks synthetic input by design; it needs the RemoteDesktop portal, which asks the user for permission in a dialog every session. Until that is supported, **Let agents use the mouse and keyboard** is turned off there with the reason shown, and the control tools aren't offered.

## Troubleshooting

**"Port 43831 is already in use."** Another program holds the port. Close it, then turn the setting off and on again.

**Every call returns `401`.** The token is wrong or missing. With Codex, check that `RECORDLY_MCP_TOKEN` is actually exported in the shell that starts it. If you pressed **Regenerate token**, re-add Recordly everywhere with the new one.

**Every call returns `403`.** The client is sending an `Origin` header, or reaching the app through a hostname other than `127.0.0.1` or `localhost`. Browser-based clients cannot connect by design.

**Tools refuse with a permission error.** macOS screen recording and accessibility permissions are granted to applications, not to agents. Open System Settings and grant them to Recordly, then try again.

**The agent cannot see Recordly at all.** Confirm the panel says *Running at …*, and that the port in your configuration matches it — an installed app and a development build use different ports.

**An agent inside WSL2 can't connect.** Recordly listens on `127.0.0.1` on Windows, which WSL2's default NAT networking does not share. Add `networkingMode=mirrored` under `[wsl2]` in `%UserProfile%\.wslconfig` and run `wsl --shutdown`, or run the agent natively on Windows.

**`start_recording` waits on Linux.** On Wayland, the system share dialog has to be confirmed by a person; the agent asks you to, and the start gives up after 120 seconds. On X11, the **Entire screen** entry records with no prompt.

**The agent has no `open_url`, `screenshot` or input tools.** They aren't offered on Wayland (see [Mouse and keyboard control](#mouse-and-keyboard-control)); the agent can still record while you perform the demo. On Linux, check that the session is X11. Everywhere else the tools are offered whether or not the build actually ships its mouse and keyboard helper — a build missing the helper offers them and every call fails with *Recordly's input helper could not start.*

**`find_elements` finds nothing in a browser on Linux.** Chromium-based browsers and Electron apps join the accessibility bus only when started with `ACCESSIBILITY_ENABLED=1`. Quit the browser and start it that way, or let the agent aim with region screenshots.

**"The window is on another desktop or minimized."** On macOS, capture can only see windows on the current desktop. Un-minimize the window, or have the agent call `select_source` again, which switches to the window's desktop. If the same app has two windows, select by `id` and use `windowTitle` and `pid` from `list_sources` to pick the right one.

**Input tools say mouse and keyboard control is off.** Turn on **Let agents use the mouse and keyboard** under the connection switch. `open_url` refuses for the same reason.

**"Recordly can't post input."** Open **System Settings → Privacy & Security → Accessibility**, turn Recordly on, then quit and reopen it. In a development build (`npm run dev`) macOS checks the terminal app that started Recordly instead, so input fails even though Recordly itself is allowed — test agent control with the installed app.

**"Stopped: the user took over."** You moved the mouse, scrolled, clicked or pressed a key while the agent was acting, or pressed **Esc**. The message ends with what Recordly noticed, such as *the mouse moved* or *a key was pressed*. Typing in another app, such as replying to the agent while a demo runs, counts too. This is the safety stop working. Keep your hands off while a demo runs; the scene you interrupted is cut from the video, and the agent waits, re-aims from a fresh `screenshot` and continues with the next `perform`.

**A key is refused as unknown.** Use a name from [Keys and modifiers](#keys-and-modifiers) or one character, and pass shortcuts as a key plus `modifiers` — `"cmd+c"` in one string is refused. A character that isn't on the current layout can't be combined with modifiers. For words and other scripts, `type_text` works whatever the layout.

**"Typing, keys and modifier clicks go only to the recorded window."** Another window is in front of the recorded one. The agent calls `select_source` again to bring it forward; if a dialog or another app keeps covering it, close that first.

**Other windows or notifications appear in the video.** On macOS the recording is the display cropped to the window, so whatever covers it is captured too. Keep the window frontmost and uncovered, and hold back notifications with a Focus mode. Windows captures the window itself, so this does not happen there.

**Agent clicks don't produce automatic zooms.** Automatic zooms need a landscape window; resize a tall window to be wider than it is high. Clicks sent through another tool, such as a browser automation server, never move the real pointer, so Recordly cannot see them — use Recordly's own `click` and `perform`.
