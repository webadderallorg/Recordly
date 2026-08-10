# Recording HUD Click-Through Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the visible recording HUD interactive while allowing clicks through every transparent part of its Electron window.

**Architecture:** Express the main-process decision as a pure mouse-policy function beside the existing HUD bounds policy. The Electron window manager will use that policy for both native window bounds and `setIgnoreMouseEvents`, preserving the renderer's existing hover-driven requests during recording instead of overriding them.

**Tech Stack:** Electron 43, TypeScript, Vitest 4, Biome 2

## Global Constraints

- Transparent HUD areas must pass clicks through while recording on platforms where Electron mouse forwarding is supported.
- The visible HUD bar, popovers, drag interactions, and webcam preview must remain interactive.
- Linux and Windows versions without forwarding support must retain the compact interactive fallback.
- Do not modify recording backends, cursor telemetry, project state, editor behavior, or export behavior.

---

## File structure

- `electron/hudOverlayBounds.ts`: owns pure HUD native-window geometry and mouse-policy decisions.
- `electron/hudOverlayBounds.test.ts`: covers geometry and recording-time mouse-policy behavior without constructing Electron windows.
- `electron/windows.ts`: applies the pure policy to the live `BrowserWindow` and preserves renderer-requested passthrough state across recording transitions.

### Task 1: Add the recording-safe HUD mouse policy

**Files:**
- Modify: `electron/hudOverlayBounds.ts`
- Test: `electron/hudOverlayBounds.test.ts`

**Interfaces:**
- Consumes: `mousePassthroughSupported`, `requestedIgnore`, and `recordingActive` booleans.
- Produces: `resolveHudOverlayMousePolicy(options): { usePassthroughWindow: boolean; ignoreMouseEvents: boolean }`.

- [x] **Step 1: Write the failing regression tests**

Add the new export to the existing import and add this suite:

```ts
describe("resolveHudOverlayMousePolicy", () => {
	it("keeps transparent HUD pixels click-through while recording", () => {
		expect(
			resolveHudOverlayMousePolicy({
				mousePassthroughSupported: true,
				requestedIgnore: true,
				recordingActive: true,
			}),
		).toEqual({ usePassthroughWindow: true, ignoreMouseEvents: true });
	});

	it("keeps visible HUD controls interactive while recording", () => {
		expect(
			resolveHudOverlayMousePolicy({
				mousePassthroughSupported: true,
				requestedIgnore: false,
				recordingActive: true,
			}),
		).toEqual({ usePassthroughWindow: true, ignoreMouseEvents: false });
	});

	it("retains the interactive compact fallback when passthrough is unsupported", () => {
		expect(
			resolveHudOverlayMousePolicy({
				mousePassthroughSupported: false,
				requestedIgnore: true,
				recordingActive: true,
			}),
		).toEqual({ usePassthroughWindow: false, ignoreMouseEvents: false });
	});
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `npx vitest --run electron/hudOverlayBounds.test.ts`

Expected: FAIL because `resolveHudOverlayMousePolicy` is not exported.

- [x] **Step 3: Implement the minimal pure policy**

Add to `electron/hudOverlayBounds.ts`:

```ts
export function resolveHudOverlayMousePolicy({
	mousePassthroughSupported,
	requestedIgnore,
}: {
	mousePassthroughSupported: boolean;
	requestedIgnore: boolean;
	recordingActive: boolean;
}) {
	return {
		usePassthroughWindow: mousePassthroughSupported,
		ignoreMouseEvents: mousePassthroughSupported && requestedIgnore,
	};
}
```

Recording state remains part of the interface to make the invariant explicit: starting a recording does not disable a platform capability.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest --run electron/hudOverlayBounds.test.ts`

Expected: all tests in `electron/hudOverlayBounds.test.ts` pass.

### Task 2: Apply the policy to the live Electron HUD

**Files:**
- Modify: `electron/windows.ts:7-13`
- Modify: `electron/windows.ts:196-209`
- Modify: `electron/windows.ts:289-327`
- Modify: `electron/windows.ts:505-515`
- Modify: `electron/windows.ts:631-665`

**Interfaces:**
- Consumes: `resolveHudOverlayMousePolicy` from Task 1 and the existing renderer-requested `hudOverlayIgnoringMouse` state.
- Produces: recording transitions that preserve click-through outside visible HUD controls.

- [x] **Step 1: Import and use the pure policy for window geometry**

Import `resolveHudOverlayMousePolicy` from `./hudOverlayBounds`. In `getHudOverlayBounds`, resolve the policy with the current support, request, and recording state, then pass `policy.usePassthroughWindow` to `getHudOverlayWindowBounds` instead of `isHudOverlayMousePassthroughSupported() && !hudOverlayRecordingActive`.

```ts
const mousePolicy = resolveHudOverlayMousePolicy({
	mousePassthroughSupported: isHudOverlayMousePassthroughSupported(),
	requestedIgnore: hudOverlayIgnoringMouse,
	recordingActive: hudOverlayRecordingActive,
});
```

- [x] **Step 2: Stop recording state from overriding renderer requests**

In `setHudOverlayMousePassthrough`, keep the source-selection override but remove the `hudOverlayRecordingActive ? false` branch. Resolve the pure policy and:

- keep fallback expansion and `setIgnoreMouseEvents(false)` when `usePassthroughWindow` is false;
- call `setIgnoreMouseEvents(true, { forward: true })` when `ignoreMouseEvents` is true;
- otherwise call `setIgnoreMouseEvents(false)`.

- [x] **Step 3: Preserve the requested state across creation and recording transitions**

Use the pure policy during initial window setup. Remove the recording-only `setIgnoreMouseEvents(false)` shortcut from `reassertHudOverlayMousePassthrough`. Update `setHudOverlayRecordingActive` to reapply `hudOverlayIgnoringMouse` rather than passing `!hudOverlayRecordingActive`.

```ts
setHudOverlayMousePassthrough(hudOverlayIgnoringMouse);
```

- [x] **Step 4: Run focused HUD tests**

Run: `npx vitest --run electron/hudOverlayBounds.test.ts src/components/launch/hudMousePassthrough.test.ts src/components/launch/floatingWebcamPreview.test.ts`

Expected: all focused tests pass.

- [x] **Step 5: Commit the behavioral change**

```bash
git add electron/hudOverlayBounds.ts electron/hudOverlayBounds.test.ts electron/windows.ts
git commit -m "fix: keep recording HUD transparent to clicks"
```

### Task 3: Verify and publish

**Files:**
- Verify: all changed files and repository checks
- Publish: `tanmayapex/Recordly` head branch to `webadderallorg/Recordly:main`

**Interfaces:**
- Consumes: the complete branch diff from Tasks 1-2.
- Produces: a tested draft pull request following upstream conventions.

- [x] **Step 1: Run repository validation**

Run, in order:

```bash
npx tsc --noEmit
npm run lint
npm test
git diff --check origin/main...HEAD
```

Expected: commands exit successfully. Any inherited advisory warnings must be reported accurately rather than described as clean output.

- [ ] **Step 2: Inspect scope and history**

Run:

```bash
git status -sb
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: only the approved design/plan and HUD policy implementation are present.

- [ ] **Step 3: Push through the authenticated fork**

Confirm `gh api user --jq .login` returns `tanmayapex`, create or reuse `tanmayapex/Recordly`, configure a `fork` remote if necessary, and push `codex/fix-recording-hud-click-through` with tracking.

- [ ] **Step 4: Open the draft PR**

Target `webadderallorg/Recordly:main` with a concise conventional title such as `fix(hud): pass clicks through transparent recording overlay`. The body must include Description, Problem and root cause, Focused change, User impact, Testing, and Risk sections.
