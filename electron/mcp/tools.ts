import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { HUD_OVERLAY_CORNERS } from "../hudOverlayBounds";
import type { HudOverlayOptions, HudOverlayState } from "../windows";
import type { AgentControl, AgentStep, PerformOptions } from "./agentControl";
import type { AgentSupport } from "./agentPlatform";
import { AGENT_KEY_ALIASES, AGENT_KEY_NAMES, AGENT_MODIFIER_ALIASES } from "./agentProtocol";
import { CLIP_DETAILS, projectEditorState, STATE_SECTIONS } from "./editorStateView";
import type { OpenFileTools } from "./openFile";
import { MAX_COUNTDOWN_SECONDS, type RemoteControl } from "./remoteControl";
import type { RemoteEditor } from "./remoteEditor";
import type { RemoteExport } from "./remoteExport";
import type { RemoteRecordings } from "./remoteRecordings";
import type { RemoteReview } from "./reviewRecording";
import type { Thumbnail } from "./thumbnail";

const CONTROL_SWITCH = "'Let agents use the mouse and keyboard' in Recordly Settings → Advanced";
const CONTROL_OFF = `Mouse and keyboard control is off. Ask the user to turn on ${CONTROL_SWITCH}, then try again.`;

const withAliases = (names: readonly string[], aliases: Record<string, string>) =>
	names
		.map((name) => {
			const others = Object.keys(aliases).filter(
				(alias) => alias !== name && aliases[alias] === name,
			);
			return others.length > 0 ? `${name} (${others.join("/")})` : name;
		})
		.join(", ");

const MODIFIERS = withAliases(
	[...new Set(Object.values(AGENT_MODIFIER_ALIASES))],
	AGENT_MODIFIER_ALIASES,
);
const NAMED_KEYS = withAliases(
	AGENT_KEY_NAMES.filter((name) => name.length > 1 && !/^(f|keypad)\d+$/.test(name)),
	AGENT_KEY_ALIASES,
);

const KEY_REFERENCE =
	"key is a key name, an alias or one character. " +
	`Named keys (case, spaces, _ and - ignored; aliases in brackets): ${NAMED_KEYS}, f1–f20, keypad0–keypad9. ` +
	"One character is pressed with the key that types it on the user's current keyboard layout, adding " +
	'shift or option when the layout needs them: "?" works, and "A" means shift+a. A character that is ' +
	'not a single key on the layout (e.g. "é" on a US layout) is typed as text, and refused when ' +
	'modifiers are given. "\\n" and "\\t" mean enter and tab; other control characters are refused. ' +
	"backspace deletes before the caret; delete is forward delete. " +
	`Modifiers: ${MODIFIERS} — ctrl, alt, shift and cmd are pressed as real modifier keys; fn is only a ` +
	'flag on the key event. A combined string such as "cmd+c" is refused: pass the modifiers separately. ' +
	'Examples: cmd+s = {"key":"s","modifiers":["cmd"]}; cmd+shift+z = {"key":"z","modifiers":["cmd","shift"]}; ' +
	'cmd+, = {"key":",","modifiers":["cmd"]}; right arrow 5 times = {"key":"right","repeat":5}; ' +
	'? = {"key":"?"}. repeat presses the key again about every 35 ms. To enter text, use type_text instead.';

const POINT_HELP =
	"Coordinates are window-relative points: (0,0) is the top-left corner of the selected window. Take " +
	"them from find_elements (aim at the centre: x + width/2, y + height/2) or from screenshot (point = " +
	"image pixel × scale, plus originX/originY when it reports them). A point outside the window is " +
	"refused: take a fresh screenshot and recompute it.";

const INPUT_NOTE =
	"Uses the real mouse and keyboard: Recordly raises the selected window first, and on macOS it must " +
	"stay frontmost and uncovered.";

const INPUT_HELP =
	`${INPUT_NOTE} Errors and what to do: 'the user took over' — the user moved the ` +
	"mouse, typed or pressed Esc; that ends the scene, not the recording, and Recordly cuts the scene from " +
	"the video, so wait for the user to be done, screenshot, re-aim and continue with the next perform " +
	"(ask only if they clearly want the machine back). 'Mouse and keyboard " +
	`control is off' — ask the user to turn on ${CONTROL_SWITCH}. 'not allowed to post mouse and ` +
	"keyboard input' — ask the user to grant Recordly Accessibility permission in System Settings, then " +
	"reopen it. 'another app is in front' — typing, keys and actions with modifiers go only to the " +
	"recorded window, so call select_source again to bring it to the front (ask the user to close a " +
	"dialog or window that keeps covering it), then screenshot and retry. 'closed, minimized or on " +
	"another desktop' or 'Select a window first' — call list_sources, then select_source, then " +
	"screenshot again.";

const MAC_INSTRUCTIONS =
	"Recordly records the screen and makes a polished demo video: automatic zoom on clicks, a " +
	"smoothed cursor. On macOS it drives the recorded window with the real mouse and keyboard.\n\n" +
	"Never record a flow you have not already run. Plan, rehearse, take:\n" +
	"1. Target: open_url for a web page, or list_sources → select_source for an app. Keep the window " +
	"landscape (at least 1.2 × as wide as tall) so zooms work, and uncovered. Two apps in one take: " +
	"select a screen, then select_source with a window id picks the window you drive, switchable " +
	"mid-take.\n" +
	"2. Plan: write the scene list and every step first. Aim with targets {text, role?, index?}, " +
	"not coordinates — give role (a link is not a button) and the label's whole text.\n" +
	"3. Rehearse unrecorded, one page at a time: perform dryRun: true (one page only), fix every " +
	"missing or ambiguous target, then perform that page with then: " +
	'"elements". Note durationMs. Do side effects here, not in the take.\n' +
	"4. Reset to the start state, move_pointer to scene 1's start, then start_recording.\n" +
	"5. Replay the rehearsed steps in as few perform calls as you can; gaps are cut, so one per " +
	"scene reads best. Leave timing to Recordly.\n" +
	"6. stop_recording, then review_recording; cover anything private with annotate blur.\n" +
	"7. Check before exporting, not by exporting: check_edits is free, render_preview shows a moment " +
	"as the export will, and export_video fromMs/toMs renders only the seconds you changed. Export " +
	"the whole file once, when it is right.\n\n" +
	"Coordinates are window-relative points; (0,0) is the window's top-left.\n\n" +
	"Errors: 'the user took over' cuts only that scene: wait, re-aim, carry on; ask " +
	"only if they want control back. 'Mouse and keyboard control is off' → ask " +
	`the user to turn on ${CONTROL_SWITCH}. Covered or closed window → list_sources, select_source, ` +
	"screenshot. A failed step ('Step n') means the page diverged: cancel_recording, re-plan, " +
	"rehearse, re-take. Never retry blindly or patch a ruined take.";

function controlInstructions(platform: NodeJS.Platform) {
	if (platform === "darwin") return MAC_INSTRUCTIONS;
	const linux = platform === "linux";
	const text = MAC_INSTRUCTIONS.replace(
		"On macOS it drives the recorded window",
		linux
			? "On Linux it records the whole screen and drives the window you choose"
			: "On Windows it drives the recorded window",
	).replace(
		"Coordinates are window-relative points; (0,0) is the window's top-left.",
		`Coordinates are window-relative points; (0,0) is the window's top-left. Shortcuts use ctrl (cmd is the ${linux ? "Super" : "Windows"} key).`,
	);
	return linux
		? text.replace(
				"or list_sources → select_source for an app. Keep the window landscape (at least " +
					"1.2 × as wide as tall) so zooms work, and uncovered. Two apps in one take: " +
					"select a screen, then select_source with a window id picks the window you drive, " +
					"switchable mid-take.",
				"or list_sources → select_source with an app window's id. Keep it uncovered. Recordly " +
					"always records the whole screen here, so select_source with another window id " +
					"switches which window you drive, even mid-take.",
			)
		: text;
}

const INSTRUCTIONS =
	"Recordly records the screen and turns recordings into polished demo videos (automatic zoom on " +
	"clicks, smooth cursor). It cannot move the mouse or type on this platform, so the user (or another " +
	"tool) performs the demo. Flow for any demo: list_sources → select_source → agree the steps with the " +
	"user → start_recording → the user performs the demo → stop_recording (returns the saved video path " +
	"and opens the editor) → review_recording → check_edits → export_video. Before anyone sees the " +
	"video, cover anything private with annotate blur; edit_timeline, " +
	"edit_zoom, edit_captions and edit_audio change the cut, with history to undo. Check the cut " +
	"before you export rather than by exporting: check_edits costs nothing, and render_preview " +
	"composites a moment exactly as the export will. On Linux with " +
	"Wayland, the user must pick the screen in the " +
	"system share dialog after start_recording. Call get_status at any time. Tools refuse with a clear " +
	"message instead of showing dialogs; relay permission errors to the user.";

function textResult(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function editResult(value: unknown) {
	const record = value as Record<string, unknown> | null;
	const preview = record?.preview as Record<string, unknown> | undefined;
	const image = preview?.image as { data?: string; mimeType?: string } | undefined;
	if (!image?.data || !image.mimeType) return textResult(value);
	const { image: _image, ...previewRest } = preview as Record<string, unknown>;
	return {
		content: [
			{ type: "image" as const, data: image.data, mimeType: image.mimeType },
			{
				type: "text" as const,
				text: JSON.stringify({ ...record, preview: previewRest }, null, 2),
			},
		],
	};
}

const coordinate = (description: string) => z.number().min(0).describe(description);
const target = (description: string) =>
	z
		.object({
			text: z
				.string()
				.trim()
				.min(1)
				.max(200)
				.describe("Part of the element's label or text, any case"),
			role: z
				.string()
				.min(1)
				.max(40)
				.optional()
				.describe("Kind of element, e.g. button, link, textfield, checkbox, tab, menuitem"),
			index: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("Which match, 0-based, top to bottom, when several are visible"),
		})
		.optional()
		.describe(description);
const TARGET_HELP =
	"An element found on screen when the step runs, instead of x and y; scrolled into view if needed";
const point = {
	x: coordinate("Window-relative x in points (0 = the window's left edge)").optional(),
	y: coordinate("Window-relative y in points (0 = the window's top edge)").optional(),
	target: target(TARGET_HELP),
};
const durationMs = (description: string) =>
	z.number().int().min(0).max(10_000).optional().describe(description);
const glideMs = durationMs(
	"How long the pointer glides there, in ms; leave it out to let Recordly pace it by distance",
);
const button = z
	.enum(["left", "right", "middle"])
	.optional()
	.describe("Mouse button; defaults to left (right opens a context menu)");
const modifiers = z
	.array(z.string().min(1).max(16))
	.max(5)
	.optional()
	.describe(
		`Keys held down during the action: ${MODIFIERS}. Needs the recorded window frontmost.`,
	);

const moveArgs = { ...point, durationMs: glideMs };
const clickArgs = {
	...point,
	button,
	count: z
		.literal([1, 2, 3])
		.optional()
		.describe(
			"1 = click (default), 2 = double-click, 3 = triple-click (selects a line or paragraph in most apps)",
		),
	modifiers,
	durationMs: glideMs,
};
const dragArgs = {
	fromX: coordinate("Window-relative x where the button goes down").optional(),
	fromY: coordinate("Window-relative y where the button goes down").optional(),
	from: target("Element where the button goes down, instead of fromX and fromY"),
	toX: coordinate("Window-relative x where the button is released").optional(),
	toY: coordinate("Window-relative y where the button is released").optional(),
	to: target("Element where the button is released, instead of toX and toY"),
	button,
	modifiers,
	durationMs: durationMs("How long the drag takes, in ms; leave it out to pace it by distance"),
};
const scrollArgs = {
	...point,
	deltaY: z
		.number()
		.min(-100_000)
		.max(100_000)
		.describe("Pixels to scroll; positive scrolls down, negative up"),
	deltaX: z
		.number()
		.min(-100_000)
		.max(100_000)
		.optional()
		.describe("Pixels to scroll sideways; positive scrolls right"),
	modifiers,
};
const typeArgs = {
	text: z
		.string()
		.min(1)
		.describe("Text to type exactly as given; \\n or \\r\\n presses Return, \\t presses Tab"),
	into: target("Field to click into before typing"),
};
const keyArgs = {
	key: z
		.string()
		.min(1)
		.max(32)
		.describe(
			'Key name, alias or one character, e.g. enter, tab, escape, down, f5, a, /, ?; not "cmd+c" — use modifiers',
		),
	modifiers,
	repeat: z
		.number()
		.int()
		.min(1)
		.max(100)
		.optional()
		.describe("How many times to press it, about 35 ms apart (default 1, at most 100)"),
};

const waitForArgs = {
	text: z
		.string()
		.trim()
		.min(1)
		.max(200)
		.optional()
		.describe("Wait until an element with this text is on screen"),
	role: z.string().trim().min(1).max(40).optional().describe("Kind of element to wait for"),
	gone: z.boolean().optional().describe("Wait until the element disappears instead"),
	settled: z
		.boolean()
		.optional()
		.describe("Wait until nothing on screen changes (instead of text or role)"),
	timeoutMs: z
		.number()
		.int()
		.positive()
		.max(30_000)
		.optional()
		.describe("Give up after this long (default 10000); settled carries on instead of failing"),
};

const WAIT_FOR_RULE =
	"Wait for an element (text and/or role, optionally gone: true) or for settled: true, not both";
const waitForValid = (value: { text?: string; role?: string; gone?: boolean; settled?: boolean }) =>
	(value.text !== undefined || value.role !== undefined) !== (value.settled === true) &&
	!(value.settled === true && value.gone === true);

type PointFields = { x?: number; y?: number; target?: unknown };
const onePoint = (
	value: PointFields,
	x: keyof PointFields,
	y: keyof PointFields,
	t: keyof PointFields,
) =>
	(value[x] !== undefined && value[y] !== undefined) !== (value[t] !== undefined) &&
	(value[x] === undefined) === (value[y] === undefined);
const POINT_OR_TARGET = "Give either x and y or a target, not both";
const DRAG_RULE = "Give each end of the drag as coordinates or a target, not both";
const dragEndsValid = (value: {
	fromX?: number;
	fromY?: number;
	from?: unknown;
	toX?: number;
	toY?: number;
	to?: unknown;
}) =>
	onePoint({ x: value.fromX, y: value.fromY, target: value.from }, "x", "y", "target") &&
	onePoint({ x: value.toX, y: value.toY, target: value.to }, "x", "y", "target");
const pointStep = <A extends string, T extends z.ZodRawShape>(action: A, args: T) =>
	z
		.object({ action: z.literal(action), ...args })
		.refine((value) => onePoint(value as PointFields, "x", "y", "target"), POINT_OR_TARGET);

const stepSchema = z.discriminatedUnion("action", [
	pointStep("move", moveArgs),
	pointStep("click", clickArgs),
	z.object({ action: z.literal("drag"), ...dragArgs }).refine(dragEndsValid, DRAG_RULE),
	pointStep("scroll", scrollArgs),
	z.object({ action: z.literal("type"), ...typeArgs }),
	z.object({ action: z.literal("key"), ...keyArgs }),
	z.object({
		action: z.literal("wait"),
		ms: z.number().int().min(0).max(30_000).describe("Pause in ms (at most 30000)"),
	}),
	z.object({ action: z.literal("waitFor"), ...waitForArgs }).refine(waitForValid, WAIT_FOR_RULE),
	z.object({
		action: z.literal("hold"),
		ms: z.number().int().min(0).max(30_000).describe("Hold the screen in ms (at most 30000)"),
	}),
	z.object({
		action: z.literal("expect"),
		target: target("The element that must be on screen").unwrap(),
		visible: z
			.boolean()
			.optional()
			.describe("Defaults to true; false fails when the target IS on screen"),
	}),
]);

type DemoArgs = { goal: string; url?: string; app?: string; output_path?: string };

function demoPrompt(
	platform: NodeJS.Platform,
	control: boolean,
	{ goal, url, app, output_path }: DemoArgs,
) {
	const exportStep =
		"Call stop_recording, then review_recording to check the contact sheet. Sweep the whole take " +
		"with sample_frames and cover anything private — account names, email addresses, figures — " +
		"with annotate blur: nothing else hides it, and a blur is reversible with history. Then " +
		"call check_edits, which is free and catches what needs no picture, and render_preview to " +
		"see any moment composited as the export will be — checking that way costs seconds, while " +
		"exporting the whole file to find out costs minutes. Use export_video with fromMs and toMs " +
		"to render just a span you are unsure of. Export the whole file once, when it is right: " +
		`export_video${output_path ? ` with outputPath "${output_path}"` : ""}.`;
	const linux = platform === "linux";
	if (control) {
		const target = url
			? `Call open_url with ${url}.`
			: app
				? linux
					? `Call list_sources and select_source with the id of ${app}'s window; Recordly records the whole screen and drives that window.`
					: `Call list_sources and select_source for ${app} (by id if it has several windows).`
				: "Pick what the goal needs: open_url for a web page, or list_sources then select_source " +
					`${linux ? "with an app window's id" : "for an app"}. Ask the user if it is unclear.`;
		const keep = linux
			? "Make sure nothing covers it."
			: "Make sure the window is landscape (at least 1.2 × as wide as tall, so automatic zooms " +
				"work) and nothing covers it.";
		return [
			`Record a demo video with Recordly that shows: ${goal}`,
			"",
			"Never record a flow you have not already run end to end. Work in three phases: PLAN, " +
				"REHEARSE, TAKE. Do not call start_recording until the rehearsal has passed.",
			"",
			"PHASE 1 - PLAN (nothing is recorded; take as long as you need)",
			`1. Target. ${target} ${keep}`,
			"2. Write the scene list out in your reply before you touch the window: the happy path " +
				"first, then the edge cases, then the error handling. Give each scene its assumed " +
				"starting state, one line of what the viewer should come away knowing, and its " +
				"numbered steps. Keep it to a few scenes, one idea each.",
			"3. Walk the flow with screenshot and find_elements only. For every step write the exact " +
				"target {text, role?, index?}:",
			'   - Always give role. "Open" as a button and "Open" as a link are different elements; ' +
				"a row action is usually a link, a floating helper is usually a button.",
			"   - Use the accessible name exactly as find_elements returns it, counts and badges " +
				'included: a chip reading "Pending" with 93 items is the target text "Pending 93", ' +
				'never "Pending", which matches dozens of things.',
			"   - If find_elements returns more than one plausible match, disambiguate now by " +
				"narrowing: add role, then the fuller accessible name. Use index only when no " +
				"combination of role and text is unique - it is positional, so one new row silently " +
				"re-aims it. Never leave the choice to the take.",
			"   - For a control with no label, screenshot a region of about 300 x 200 points around " +
				"it and use origin + pixel x scale.",
			"4. Write the per-step expectation list: after step n, what must be true (which page, " +
				"which heading, which element appears or disappears). This is what you check during " +
				"the rehearsal.",
			"4b. Pre-mortem. Assume this take has already failed. Write every reason it could have " +
				"failed - wrong element, late-loading row, a dialog, a count that changed, a session " +
				"that expired. Add one rehearsal check for each. The CHECKS list below is the floor, " +
				"not the ceiling.",
			"5. Avoid side effects for now - no submitting, deleting or signing out while planning.",
			"",
			"PHASE 2 - REHEARSE (still not recording; this is the whole point)",
			"6. Run the real flow once, unrecorded, one page at a time. For each page:",
			"   a. perform with dryRun: true for just that page's steps. dryRun probes only the page " +
				"you are on - up to and including the first step that can change it, with the rest " +
				"returned as found: null, validated at run time - so never dry-run a multi-page flow " +
				"in one call. found: false with candidates > 1 means ambiguous, not missing.",
			"   b. Fix every target that is missing or ambiguous, then re-dry-run until all its " +
				"steps report found.",
			'   c. perform that page\'s steps for real, with then: "elements".',
			"   d. Check the returned elements against your expectation for that step. After each " +
				"step, take a screenshot and carefully evaluate if you have achieved the right " +
				"outcome. State in one sentence what the screenshot shows and whether the step " +
				"succeeded. If it didn't, try again. Only when you confirm a step was executed " +
				"correctly should you move on to the next one. If you are not on the page you " +
				"planned, stop and fix the plan - do not carry on. Record the call's durationMs.",
			"7. Totals. Sum the durationMs values; that is roughly the video's length. If a page " +
				"took much longer than the rest, plan a waitFor for it rather than hoping.",
			"8. Reset to the starting state (re-open the URL, undo or delete whatever the rehearsal " +
				"created, sign back in). The take must start from the same screen the rehearsal " +
				"started from.",
			"",
			"PHASE 3 - TAKE",
			"9. move_pointer to where scene 1 begins, then start_recording with scenes set to the " +
				"rehearsed scene list.",
			"10. Replay the rehearsed steps, one perform call per scene and no more calls than " +
				"that: the gap between calls is cut from the video, so extra calls mean extra cuts. " +
				"Pass the targets you proved, not new ones. Leave out durations and waits; Recordly " +
				"paces the motion and holds each result after a click or Enter. Add a title only if " +
				"the user asked for captions or a tutorial.",
			"11. Do not screenshot mid-take to decide what to do next - the per-step verification " +
				"belongs in the rehearsal, not here. Screenshot only after a failure.",
			`12. ${exportStep}`,
			"13. Tell the user the saved path, what the video shows, and anything you changed " +
				"between the rehearsal and the take.",
			"",
			"CHECKS - what must be true, and what to do when it is not",
			"- Wrong page. A target not found mid-take almost always means an earlier click landed " +
				"on the wrong element, so the page has been wrong since then. Do not retry the step. " +
				"cancel_recording, find the real cause with find_elements, fix that target, rehearse " +
				"again, re-take.",
			"- Ambiguous target. Two or more equal matches: perform refuses and lists them. Fix in " +
				"the plan with role or fuller text, and index only as a last resort.",
			"- Layout shift. If the page moves while the pointer glides (lazy content, a banner, a " +
				"list that finishes loading), put a waitFor for the settled page before the click, " +
				"or waitFor settled: true, and prove it in the rehearsal.",
			"- Slow load. Add waitFor {text | role} for the thing you are about to click, with " +
				"timeoutMs above the slowest rehearsal time. Never a bare wait to cover a load.",
			"- Dialog, cookie banner or toast. Dismiss it before start_recording, or make " +
				"dismissing it scene 1. Never let it appear for the first time during the take.",
			"- Empty state. If the demo needs rows, confirm in the rehearsal that they are there, " +
				"and that the count has not changed by the take. Data that changes the layout (a " +
				"new row, a changed badge count) invalidates every target whose text includes a " +
				"number - re-check those after the reset.",
			"- Auth / logout. If the flow signs out, the reset in step 8 must sign back in. Check " +
				"you are signed in before start_recording.",
			"- Covered or resized window. select_source again and screenshot before start_recording.",
			"- The user took over. That ends the scene, not the recording, and the scene is cut from " +
				"the video. Wait until the user is done, screenshot, re-aim, and continue with the " +
				"next perform. Stop and ask only if they clearly want the machine back.",
			"",
			"HARD STOPS",
			"- Never call start_recording before a clean rehearsal of the whole flow.",
			"- Never retry a failed step blindly. Diagnose in one sentence why it failed, fix the " +
				"plan so that cause cannot recur, rehearse again, then re-take.",
			"- Never patch a ruined take by continuing from where it broke. If the cause can be " +
				"fixed off camera, pause_recording, fix it, resume_recording; if it cannot, " +
				"cancel_recording and take it again.",
			"- Never let a scene depend on a target you have not seen found.",
			"- Never export a take you have not checked with review_recording.",
			"",
			"Act only inside the selected window.",
			"",
			"SELF-CHECK - answer each one before start_recording",
			"- Scene list written: happy path, edge cases, error handling?",
			"- Every target resolved uniquely, with role?",
			"- Whole flow rehearsed unrecorded, zero failures?",
			"- durationMs noted per page?",
			"- Reset to the start state?",
			"Any no means do not record.",
			...(platform === "darwin" ? [] : ["Use ctrl, not cmd, for shortcuts."]),
			...(linux
				? [
						"Browsers and Electron apps list their controls only when started with " +
							"ACCESSIBILITY_ENABLED=1; otherwise aim from a region screenshot.",
					]
				: []),
		].join("\n");
	}
	const target = [
		url ? `Make sure ${url} is open in a browser window (ask the user to open it).` : "",
		app ? `The app to record is ${app}.` : "",
		linux
			? "Call list_sources, then select_source with the first entry (the screen)."
			: "Call list_sources, then select_source for the window to record.",
	]
		.filter(Boolean)
		.join(" ");
	return [
		`Record a demo video with Recordly that shows: ${goal}`,
		"",
		"Recordly records and exports here but cannot move the mouse or type on this platform, so the user " +
			"performs the demo.",
		`1. Target. ${target}`,
		"2. Agree a short, ordered list of demo steps with the user.",
		`3. Call start_recording.${linux ? " On Wayland, ask the user to choose the screen in the system share dialog; recording starts once they do." : ""}`,
		"4. Let the user perform the demo and wait until they say it is done; get_status shows the recorder state.",
		`5. ${exportStep}`,
		"6. Tell the user the saved path.",
	].join("\n");
}

export type CaptureControls = {
	setOverlay: (options: HudOverlayOptions) => Promise<HudOverlayState>;
	waitUntilQuiet: (options: {
		quietMs?: number;
		timeoutMs?: number;
		signal?: AbortSignal;
	}) => Promise<{ quiet: boolean; waitedMs: number; message?: string }>;
	setDoNotDisturb: (
		enabled: boolean,
	) => Promise<{ ok: boolean; enabled?: boolean; message: string }>;
	setHideCursor: (hidden: boolean) => void;
	rememberScenes: (titles: readonly string[] | undefined) => void;
	getHideCursor: () => boolean;
};

export function buildRecordlyMcpServer(
	remote: RemoteControl,
	remoteExport: RemoteExport,
	version: string,
	{
		agent,
		isControlEnabled,
		platform = process.platform,
		support,
		review,
		editor,
		recordings,
		files,
		capture,
		thumbnail,
	}: {
		agent: AgentControl;
		isControlEnabled: () => boolean;
		platform?: NodeJS.Platform;
		support: AgentSupport;
		review: RemoteReview;
		editor: RemoteEditor;
		recordings: RemoteRecordings;
		files: OpenFileTools;
		capture: CaptureControls;
		thumbnail: Thumbnail;
	},
) {
	const mac = platform === "darwin";
	const control = support.supported;
	const linuxControl = control && platform === "linux";
	const server = new McpServer(
		{ name: "recordly", version },
		{ instructions: control ? controlInstructions(platform) : INSTRUCTIONS },
	);

	async function perform(steps: AgentStep[], options?: PerformOptions) {
		if (!isControlEnabled()) throw new Error(CONTROL_OFF);
		return textResult(await agent.perform(steps, options));
	}

	server.registerPrompt(
		"record_demo",
		{
			title: "Record a demo",
			description:
				"Step-by-step plan for recording a demo video of any website or app and exporting it" +
				(control
					? "; Recordly drives the window itself."
					: "; the user performs the demo while Recordly records."),
			argsSchema: z.object({
				goal: z
					.string()
					.min(1)
					.describe(
						"What the demo should show, e.g. signing up and changing the profile photo",
					),
				url: z.string().optional().describe("Web page to start from"),
				app: z
					.string()
					.optional()
					.describe("Desktop app or window to record instead of a web page"),
				output_path: z
					.string()
					.optional()
					.describe("Where to save the video: an absolute path ending in .mp4 or .gif"),
			}),
		},
		(args) => ({
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: demoPrompt(platform, control, args) },
				},
			],
		}),
	);

	server.registerTool(
		"get_status",
		{
			description:
				"Current recorder state (idle, starting, countdown, recording, paused, stopping, " +
				"finalizing), the " +
				"selected capture source, the path of the last recording, macOS permission status, and " +
				"the state/progress of the last export. drivenWindow says which window the mouse and " +
				"keyboard act on, which is not always what is captured: role 'control' means a screen " +
				"is recorded and this window was chosen with select_source, role 'recorded' means the " +
				"captured source is itself that window, and null means a screen is recorded with no " +
				"window chosen yet.",
			annotations: { readOnlyHint: true },
		},
		async () =>
			textResult({
				...remote.getStatus(),
				export: remoteExport.getStatus(),
				editor: { running: editor.runningOp() },
			}),
	);

	server.registerTool(
		"list_sources",
		{
			description: mac
				? "List capturable screens and windows, including windows on other desktops. Windows carry " +
					"appName, windowTitle, pid, onScreen and their x/y/width/height in screen points, so two " +
					"windows of one app can be told apart; each screen carries its bounds, scale and " +
					"resolution, so you can pick between monitors. Off-screen windows of 500x500 points " +
					"or smaller are left out, because they are almost always system helper panels — one " +
					"can still be chosen by id or name if you know it is there. Use an id or name with " +
					"select_source."
				: "List capturable screens and windows (id, name, type). Use an id or name with " +
					"select_source. On Linux the first entry records the screen chosen by the system; " +
					"needsUser: true means a person must pick it in the share dialog.",
			annotations: { readOnlyHint: true },
		},
		async () => textResult(await remote.listSources()),
	);

	server.registerTool(
		"select_source",
		{
			description:
				"Choose what to record, by exact id or by a case-insensitive name substring (matched against " +
				"the source name and app name). Fails if no source or more than one matches, listing the " +
				"candidates; then retry with the id." +
				(mac
					? " Raises the window (switching desktop if needed) and waits up to 2 s until it is on " +
						"screen. The mouse and keyboard tools act on this window only."
					: linuxControl
						? " A window id (window:N:0 from list_sources, or N) chooses the window the mouse and " +
							"keyboard tools act on; Recordly keeps recording the whole screen."
						: control
							? " The mouse and keyboard tools act on this window only."
							: ""),
			inputSchema: z.object({
				id: z.string().min(1).optional().describe("Exact source id from list_sources"),
				name: z.string().min(1).optional().describe("Name substring of the window or app"),
			}),
		},
		async (args) => {
			const recordsScreen =
				linuxControl ||
				remote.getStatus().selectedSource?.id?.startsWith("screen:") === true;
			const picksWindow =
				control && recordsScreen && !!args.id && /^(window:)?\d+/.test(args.id);
			return textResult(
				picksWindow
					? await agent.chooseWindow(args.id as string)
					: await remote.selectSource(args),
			);
		},
	);

	server.registerTool(
		"start_recording",
		{
			description:
				"Start recording the selected source. Returns once capture is actually running (after the " +
				"countdown). While the mouse and keyboard switch is on it also refuses without scenes, the " +
				"scene list you rehearsed. Refuses if " +
				(platform === "linux"
					? "a recording is already running or still being saved; with no source selected it records the screen entry."
					: "no source is selected, permissions are missing, or a recording is already running or still being saved.") +
				(mac
					? " If the window is closed, minimized or on another desktop, call select_source again."
					: "") +
				(platform === "linux"
					? " On Wayland a person must confirm the system share dialog first; until then " +
						"get_status reports starting."
					: ""),
			inputSchema: z.object({
				countdownSeconds: z
					.number()
					.int()
					.min(0)
					.max(MAX_COUNTDOWN_SECONDS)
					.optional()
					.describe("Countdown before capture starts; defaults to the user's setting"),
				scenes: z
					.array(z.string().trim().min(1).max(200))
					.min(1)
					.max(12)
					.optional()
					.describe(
						"The scene list you rehearsed, one short line per scene; required while the " +
							"mouse and keyboard switch is on",
					),
			}),
		},
		async (args) => {
			if (isControlEnabled() && args.scenes === undefined) {
				throw new Error(
					"Pass scenes: the scene list you rehearsed. Rehearse the flow unrecorded first " +
						"(perform with dryRun, then the steps for real), reset to the start state, " +
						"then start_recording with one short line per scene.",
				);
			}
			capture.rememberScenes(args.scenes);
			return textResult(
				await remote.startRecording({ ...args, hideCursor: capture.getHideCursor() }),
			);
		},
	);

	server.registerTool(
		"pause_recording",
		{ description: "Pause the running recording." },
		async () => {
			await remote.pauseRecording();
			return textResult({ state: "paused" });
		},
	);

	server.registerTool(
		"resume_recording",
		{ description: "Resume a paused recording." },
		async () => {
			await remote.resumeRecording();
			return textResult({ state: "recording" });
		},
	);

	server.registerTool(
		"stop_recording",
		{
			description:
				"Stop and save the recording. Returns the saved video path once it is written; the editor " +
				"then opens with automatic zooms applied.",
		},
		async () => textResult(await remote.stopRecording()),
	);

	server.registerTool(
		"cancel_recording",
		{
			description:
				"Discard the running recording, or abort the countdown before capture starts. Use it to " +
				"throw away a ruined take before starting again.",
			annotations: { destructiveHint: true },
		},
		async () => {
			await remote.cancelRecording();
			return textResult({ cancelled: true });
		},
	);

	server.registerTool(
		"export_video",
		{
			description:
				"Export the last recording to a video file with no dialog, using the editor's current look " +
				"(automatic zooms, cursor, background). Waits for the editor to finish loading, then returns " +
				"the saved path, with the file's width, height, duration and frame rate so you can " +
				"check it without another tool, plus warnings naming any moment it wrote with no " +
				"picture. A very long export returns { status: " +
				'"still-exporting" } — then poll get_status until export.state is done or failed. ' +
				"fromMs and toMs render only that span of the edited timeline, which is how you check " +
				"a change without paying for the whole file; the result is marked a fragment, and a " +
				"zoom already under way at fromMs settles in from rest rather than arriving " +
				"mid-flight, which it tells you.",
			inputSchema: z.object({
				outputPath: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Absolute path ending in .mp4 or .gif; defaults to the recordings folder",
					),
				format: z.enum(["mp4", "gif"]).optional().describe("Defaults to mp4"),
				quality: z
					.enum(["medium", "good", "high", "source"])
					.optional()
					.describe("Defaults to good"),
				overwrite: z
					.boolean()
					.optional()
					.describe("Replace an existing file at outputPath"),
				videoPath: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Export this recording instead of the last one; the editor must have it " +
							"loaded, so call recover_recording first",
					),
				aspect: z
					.string()
					.optional()
					.describe('Letterbox to this ratio, e.g. "16:9"; mp4 only, never stretched'),
				padTo: z
					.string()
					.optional()
					.describe('Letterbox to exactly this size, e.g. "2880x1600"; mp4 only'),
				scale: z
					.number()
					.optional()
					.describe("Shrink the output, 0.05–1; mp4 only, and not with padTo"),
				fps: z.number().optional().describe("Frame rate, 1–120; mp4 only"),
				posterAtMs: z
					.number()
					.optional()
					.describe(
						"Use the frame at this edited time as the file's cover, instead of the first " +
							"frame, which is often a dull starting screen; mp4 only",
					),
				fromMs: z
					.number()
					.min(0)
					.optional()
					.describe(
						"Render only from this edited time. Needs toMs. At least 100 ms apart",
					),
				toMs: z
					.number()
					.min(0)
					.optional()
					.describe("Render only up to this edited time. Needs fromMs"),
				chapters: z
					.boolean()
					.optional()
					.describe("Write one chapter per rehearsed scene; mp4 only"),
			}),
		},
		async (args, ctx) => {
			const { state, lastRecordingPath } = remote.getStatus();
			if (state !== "idle" && state !== "finalizing") {
				throw new Error(
					`Recordly is ${state}. Finish with stop_recording before calling export_video.`,
				);
			}
			const progressToken = ctx.mcpReq._meta?.progressToken;
			const onProgress =
				progressToken === undefined
					? undefined
					: (progress: number) =>
							void ctx.mcpReq
								.notify({
									method: "notifications/progress",
									params: { progressToken, progress, total: 100 },
								})
								.catch(() => undefined);
			return textResult(
				await remoteExport.exportVideo(
					{ ...args, videoPath: args.videoPath ?? lastRecordingPath },
					{ signal: ctx.mcpReq.signal, onProgress },
				),
			);
		},
	);

	server.registerTool(
		"review_recording",
		{
			description:
				"Check the edited video before export_video, after stop_recording, while the editor shows " +
				"the latest recording. Returns a contact sheet (up to 9 tiles, left to right, top to " +
				"bottom: the start, the last frame before each cut, the end) and a summary: each tile's " +
				"time and label, raw and final duration, time removed, cuts, zooms, captions, scenes, " +
				"failed scenes and the longest still stretch left. If a tile shows something wrong (an " +
				"error, the wrong page, a covered window), tell the user and offer to record that part " +
				"again. The tiles are the recorded screen, not the export, so run check_edits and " +
				"render_preview before export_video.",
			inputSchema: z.object({}),
		},
		async (_args, ctx) => {
			const { image, summary } = await review.reviewRecording({ signal: ctx.mcpReq.signal });
			return {
				content: [
					{ type: "image" as const, data: image.data, mimeType: image.mimeType },
					{ type: "text" as const, text: JSON.stringify(summary, null, 2) },
				],
			};
		},
	);

	server.registerTool(
		"edit_timeline",
		{
			description:
				"Change the cut: trim, split, remove a span, re-speed a clip, reorder clips, or hit a " +
				"length. op trim keeps only startMs–endMs (of one clip with clipIndex, which can only " +
				"shorten it); split cuts at timeMs; remove drops a span and closes the gap; speed sets " +
				"one clip's rate to anything this machine can play back, 1 being normal; " +
				"reorder moves a clip. set_scene_duration makes one rehearsed scene last ms, and fit " +
				"brings the whole video to targetMs — both only shorten, and never cut into action: " +
				"first the idle stretches, then the reading pause after each click down to a floor " +
				"that stays readable, then the kept footage up to 1.25x. Both need the scene list " +
				"from a recording an agent drove. If a target is still out of reach nothing changes " +
				"and the error names every lever it tried and by how much it fell short. op join adds another " +
				"recording to the end (or at index), as ONE continuous video: the two share a single " +
				"media source, so the cursor does not jump and nothing needs re-scaling. You rarely " +
				"need it: recording a whole screen keeps two apps in one take. It joins straight, " +
				"crossfade, and on a large recording it can outlive the wait: it then returns " +
				'status "still-running" rather than an error — do NOT call it again or the recording ' +
				"is added twice; poll get_status until editor.running is null. Times are milliseconds " +
				"in the edited timeline. op freeze holds the frame at atMs for ms, which is what gives " +
				"an end card something to sit on instead of stopping on a live screen — a freeze at " +
				"the very end holds a frame from up to 50 ms earlier, because the last frame of the " +
				"media cannot be read exactly. op transition dips through black across a cut: pass " +
				"atMs on the cut (it snaps within 250 ms) or betweenClips, and ms 100-2000, or 0 to " +
				"remove it. A crossfade is refused rather than quietly downgraded: the export " +
				"decodes one frame at a time and never has both clips at once, so the two can never " +
				"overlap. A dip takes its time from the clips it joins, so the video does not get " +
				"longer. Reversible with history undo.",
			inputSchema: z.object({
				op: z.enum([
					"trim",
					"split",
					"remove",
					"speed",
					"reorder",
					"set_scene_duration",
					"fit",
					"join",
					"freeze",
					"transition",
				]),
				startMs: z.number().min(0).optional(),
				endMs: z.number().min(0).optional(),
				timeMs: z.number().min(0).optional().describe("op split"),
				clipIndex: z
					.number()
					.int()
					.min(0)
					.optional()
					.describe("0-based, in timeline order"),
				speed: z.number().positive().optional().describe("op speed"),
				fromIndex: z.number().int().min(0).optional().describe("op reorder"),
				toIndex: z.number().int().min(0).optional().describe("op reorder"),
				index: z
					.number()
					.int()
					.min(0)
					.optional()
					.describe("op set_scene_duration: the scene"),
				atMs: z
					.number()
					.min(0)
					.optional()
					.describe(
						"op freeze: where to hold. op transition: the cut, snapped within 250 ms",
					),
				betweenClips: z
					.number()
					.int()
					.min(1)
					.optional()
					.describe(
						"op transition: index of the clip the cut runs into, instead of atMs",
					),
				kind: z
					.enum(["dip"])
					.optional()
					.describe(
						"op transition: dip through black; a crossfade is refused, the export never holds two clips at once",
					),
				ms: z.number().min(0).optional().describe("op set_scene_duration"),
				targetMs: z.number().min(0).optional().describe("op fit"),
				path: z
					.string()
					.min(1)
					.optional()
					.describe("op join: absolute path of another recording in the library"),
			}),
		},
		async ({ op, ...rest }, ctx) => {
			if (op === "join") {
				const outcome = await editor.requestLong(`timeline.${op}`, rest, {
					signal: ctx.mcpReq.signal,
				});
				if (outcome.status === "done") return textResult(outcome.data);
				const seconds = Math.round(outcome.waitedMs / 1000);
				return textResult({
					status: "still-running",
					note: `Joining is still running after ${seconds} s and will finish on its own. Do NOT call join again — the recording would be added twice. Poll get_status until editor.running is null, then get_editor_state to see the joined clip.`,
				});
			}
			return textResult(
				await editor.requestEditor(`timeline.${op}`, rest, { signal: ctx.mcpReq.signal }),
			);
		},
	);

	server.registerTool(
		"edit_zoom",
		{
			description:
				"Override the automatic zoom when it guesses wrong. depth 1–6 is 1.25×, 1.5×, 1.8×, " +
				"2.2×, 3.5× and 5×; focus is {cx, cy} as a fraction of the frame. A new zoom is " +
				'"manual" so it keeps your focus — mode "auto" follows the cursor instead, and can be ' +
				"dropped when a fresh recording's own suggestions are applied. Zooms may not overlap, " +
				"though they may touch. op clear removes the automatic ones too. Times are " +
				"milliseconds in the edited timeline. Reversible with history undo.",
			inputSchema: z.object({
				op: z.enum(["add", "update", "remove", "clear"]),
				id: z.string().min(1).optional().describe("Required for update and remove"),
				startMs: z.number().min(0).optional(),
				endMs: z.number().min(0).optional(),
				depth: z.number().int().min(1).max(6).optional().describe("Defaults to 3 (1.8x)"),
				focus: z
					.object({ cx: z.number().min(0).max(1), cy: z.number().min(0).max(1) })
					.optional()
					.describe("Fraction of the frame; defaults to the centre"),
				mode: z.enum(["auto", "manual"]).optional(),
				preview: z
					.boolean()
					.optional()
					.describe(
						"Return a composited frame of the moment this changed, so you can see the result",
					),
			}),
		},
		async ({ op, ...rest }, ctx) =>
			editResult(
				await editor.requestEditor(`zoom.${op}`, rest, { signal: ctx.mcpReq.signal }),
			),
	);

	server.registerTool(
		"set_look",
		{
			description:
				"Set how the video looks. op set takes the frame: wallpaper, padding, borderRadius, " +
				"shadowIntensity, backgroundBlur, crop and webcam. op motion takes the movement: zoom " +
				"durations and easings, cursor style, size, smoothing and click effects, and the " +
				"camera and cursor springs — pass only the fields you want and the rest are left " +
				"alone, and an unknown field is refused rather than ignored. **padding and borderRadius " +
				"are PERCENTAGES, not pixels**, and padding is damped: 0-100 becomes an inset of 0-20% " +
				"per side, so 4 is subtle and even 100 still leaves the picture at 60% of the frame. " +
				"Padding therefore cannot make the video vanish — if the picture is missing, the cause is " +
				"elsewhere. borderRadius is a percent of the shorter side (max 50), shadowIntensity is a " +
				"0-1 multiplier, and backgroundBlur is a blur radius in pixels at a 640px-wide reference, " +
				"scaled to the export size. Whatever " +
				"get_editor_state reports for the look can be sent straight back: padding takes " +
				"linked (equal sides up to 100 when linked, top and bottom up to 250 when not), crop " +
				"is also accepted as cropRegion, and the webcam's sourcePath, visibleRanges and " +
				"cornerRadius can be echoed but not changed. **The look is not part of " +
				"the editor's history, so history undo will NOT revert this** — set the old values " +
				"again to go back. op preset takes a whole frame in one call: clean, dark or none.",
			inputSchema: z.object({
				op: z.enum(["set", "motion", "preset"]),
				fields: z
					.record(z.string(), z.unknown())
					.describe(
						'The settings to change, e.g. {wallpaper, padding}, {cursorSize}, or {name: "clean"} for op preset',
					),
				preview: z
					.boolean()
					.optional()
					.describe(
						"Return a composited frame of the moment this changed, so you can see the result",
					),
			}),
		},
		async ({ op, fields }, ctx) =>
			editResult(
				await editor.requestEditor(`look.${op}`, fields, { signal: ctx.mcpReq.signal }),
			),
	);

	server.registerTool(
		"edit_captions",
		{
			description:
				'Put words on screen. op generate with from: "scenes" turns the scene list you ' +
				"rehearsed into captions at their scene boundaries — a narrated feel with no audio and " +
				'no recording of a voice; from: "audio" transcribes the recording\'s speech instead, ' +
				"which is slow and needs the Whisper model. op set replaces every caption, update " +
				"changes one, remove drops one or all, style sets size, colours and position, and " +
				"animation picks none, fade, rise or pop. op fit_to_scenes takes one line of text per " +
				"scene and places each one wholly inside a single shot, which is the easy way to " +
				"caption a rehearsed demo: it never crosses a cut, skips scenes with no room and " +
				"names them, and refuses the call if the number of lines does not match the number of " +
				"scenes. Captions show one at a time, so cues may not " +
				"overlap, and a cue inside a cut is refused. Reversible with history undo.",
			inputSchema: z.object({
				op: z.enum([
					"generate",
					"set",
					"update",
					"remove",
					"style",
					"animation",
					"fit_to_scenes",
				]),
				from: z.enum(["audio", "scenes"]).optional().describe("op generate"),
				timeoutMs: z.number().int().optional().describe("op generate from audio"),
				cues: z
					.array(
						z.object({
							startMs: z.number().min(0),
							endMs: z.number().min(0),
							text: z.string().min(1),
						}),
					)
					.optional()
					.describe("op set"),
				id: z.string().min(1).optional(),
				text: z.string().min(1).optional(),
				startMs: z.number().min(0).optional(),
				endMs: z.number().min(0).optional(),
				all: z.boolean().optional().describe("op remove: every caption"),
				texts: z
					.array(z.string().min(1).max(80))
					.min(1)
					.max(500)
					.optional()
					.describe("op fit_to_scenes: one line per scene, 80 characters each"),
				padMs: z
					.number()
					.min(0)
					.max(2000)
					.optional()
					.describe("op fit_to_scenes: inset at each end, default 200"),
				preview: z
					.boolean()
					.optional()
					.describe(
						"Return a composited frame of the moment this changed, so you can see the result",
					),
				style: z.enum(["none", "fade", "rise", "pop"]).optional().describe("op animation"),
				fields: z
					.record(z.string(), z.unknown())
					.optional()
					.describe("op style: fontSize, textColor, bottomOffset, maxRows, enabled, …"),
			}),
		},
		async ({ op, fields, ...rest }, ctx) =>
			editResult(
				await editor.requestEditor(
					`captions.${op}`,
					op === "style" ? (fields ?? {}) : rest,
					{ signal: ctx.mcpReq.signal },
				),
			),
	);

	server.registerTool(
		"edit_audio",
		{
			description:
				"Add music or a narration file, set its volume, or silence the recording's own sound. " +
				"op add places an audio file (mp3, wav, m4a, aac, ogg, opus, flac) from an absolute " +
				"path and trims it to the room available; volume is 0–1. op mute_source silences what " +
				"the recording captured, for one clip or all of them, and source_track picks which " +
				"captured track (mixed, system, mic) to use. There is no text-to-speech: record or " +
				"generate the audio elsewhere and pass the file. op fade fades a region in and out, " +
				"and op duck lowers it over the ranges you give or over the caption spans — it does " +
				"NOT listen to the recording, so it ducks exactly where you say. Fades and ducks are " +
				"applied in the exported file but not in the editor's own playback, and the " +
				"recording's own track can be muted but not faded or ducked. Reversible with " +
				"history undo.",
			inputSchema: z.object({
				op: z.enum([
					"add",
					"remove",
					"volume",
					"mute_source",
					"source_track",
					"fade",
					"duck",
				]),
				path: z
					.string()
					.min(1)
					.optional()
					.describe("op add: absolute path to an audio file"),
				inMs: z
					.number()
					.min(0)
					.optional()
					.describe("op fade: fade in over this many ms; 0 clears it"),
				outMs: z
					.number()
					.min(0)
					.optional()
					.describe("op fade: fade out over this many ms; 0 clears it"),
				level: z
					.number()
					.min(0)
					.max(1)
					.optional()
					.describe("op duck: the multiplier while ducked, 0 silent to 1 no duck"),
				ranges: z
					.union([
						z.literal("captions"),
						z.array(z.object({ startMs: z.number().min(0), endMs: z.number().min(0) })),
					])
					.optional()
					.describe(
						'op duck: "captions" for the caption spans, or explicit edited-time spans',
					),
				startMs: z.number().min(0).optional().describe("op add; defaults to 0"),
				durationMs: z.number().positive().optional().describe("op add"),
				volume: z.number().min(0).max(1).optional(),
				trackIndex: z.number().int().min(0).optional().describe("op add"),
				id: z.string().min(1).optional().describe("op remove and volume"),
				muted: z.boolean().optional().describe("op mute_source"),
				clipId: z.string().min(1).optional().describe("One clip; omit for all"),
				track: z.string().min(1).optional().describe("op source_track"),
				normalize: z.boolean().optional().describe("op source_track"),
			}),
		},
		async ({ op, ...rest }, ctx) => {
			const args: Record<string, unknown> = { ...rest };
			if (op === "add" && typeof rest.path === "string") {
				const [{ approveUserPath }, { probeAudioFile }] = await Promise.all([
					import("../ipc/utils"),
					import("./audioProbe"),
				]);
				approveUserPath(rest.path);
				args.fileDurationMs = (await probeAudioFile(rest.path)).durationMs;
			}
			return textResult(
				await editor.requestEditor(`audio.${op}`, args, { signal: ctx.mcpReq.signal }),
			);
		},
	);

	server.registerTool(
		"annotate",
		{
			description:
				"Put something on top of the video for a stretch of time: blur over anything private, " +
				"text, an image, or an arrow. **Use blur before anyone sees the video** — a demo of a " +
				"real app shows real names, email addresses and figures, and nothing else here hides " +
				"them. Geometry is percent of the frame (0–100, origin top-left) and times are " +
				"milliseconds in the EDITED timeline, after cuts. Needs the editor open. Reversible " +
				"with history undo. kind highlight is a spotlight: it dims everything outside its box " +
				"so you can point at one control without moving the frame, and it must stay in frame " +
				"space to follow what it points at. preset lower_third or callout gives styled text " +
				"on a plate, which is what keeps it readable — plain white text over a light app is " +
				"invisible, so prefer a preset or a backgroundColor over guessing a colour. " +
				"space decides what the geometry is measured against: frame (the " +
				"default) sits on the recorded picture and moves with the zoom, which is what a blur " +
				"must do to keep covering what it hides; screen pins it to the output frame so a title " +
				"or a logo stays put and an active zoom cannot crop it. A blur cannot use screen. " +
				"render_preview shows whether it covers what you meant.",
			inputSchema: z.object({
				op: z.enum(["add", "update", "remove", "clear"]),
				id: z.string().min(1).optional().describe("Required for update and remove"),
				kind: z
					.enum(["text", "image", "figure", "blur", "highlight"])
					.optional()
					.describe(
						"Required for add unless preset is given; figure is an arrow, highlight dims " +
							"everything outside its box. Cannot be changed later",
					),
				preset: z
					.enum(["lower_third", "callout"])
					.optional()
					.describe(
						"op add: a styled text plate, legible over any footage. Fields you pass win over it",
					),
				dim: z
					.number()
					.min(0.1)
					.max(0.9)
					.optional()
					.describe("kind highlight: how dark the surroundings go, 0.1-0.9, default 0.6"),
				backgroundColor: z
					.string()
					.min(1)
					.optional()
					.describe("kind text: a plate behind the text, which is what keeps it legible"),
				textAlign: z.enum(["left", "center", "right"]).optional().describe("kind text"),
				startMs: z.number().min(0).optional(),
				endMs: z.number().min(0).optional(),
				x: z
					.number()
					.min(0)
					.max(100)
					.optional()
					.describe("Percent of the frame, from the left"),
				y: z
					.number()
					.min(0)
					.max(100)
					.optional()
					.describe("Percent of the frame, from the top"),
				width: z.number().min(0).max(100).optional().describe("Percent of the frame"),
				height: z.number().min(0).max(100).optional().describe("Percent of the frame"),
				space: z
					.enum(["frame", "screen"])
					.optional()
					.describe(
						"frame (default) follows the zoom; screen pins to the output frame. Not for blur",
					),
				preview: z
					.boolean()
					.optional()
					.describe(
						"Return a composited frame of the moment this changed, so you can see the result",
					),
				text: z.string().min(1).optional().describe("kind text"),
				fontSize: z.number().positive().optional().describe("kind text"),
				color: z.string().min(1).optional().describe("kind text or figure"),
				image: z.string().min(1).optional().describe('kind image: a "data:image/..." URL'),
				arrowDirection: z
					.enum([
						"up",
						"down",
						"left",
						"right",
						"up-right",
						"up-left",
						"down-right",
						"down-left",
					])
					.optional()
					.describe("kind figure; defaults to right"),
				strokeWidth: z.number().positive().optional().describe("kind figure"),
				strength: z
					.number()
					.min(1)
					.max(100)
					.optional()
					.describe("kind blur; defaults to 20"),
				blurColor: z.string().min(1).optional().describe("kind blur"),
				trackIndex: z.number().int().min(0).optional(),
			}),
		},
		async ({ op, ...rest }, ctx) =>
			editResult(
				await editor.requestEditor(`annotate.${op}`, rest, { signal: ctx.mcpReq.signal }),
			),
	);

	server.registerTool(
		"history",
		{
			description:
				"Undo or redo the last edit in the editor, over its own 100-step history. This covers " +
				"clips, zooms, annotations, audio and captions — so any edit made with annotate, " +
				"edit_timeline or edit_zoom can be taken back. It does NOT cover the look (wallpaper, " +
				"padding, cursor settings), which the editor does not track. Refuses when there is " +
				"nothing to undo rather than reporting a success that did nothing.",
			inputSchema: z.object({ op: z.enum(["undo", "redo"]) }),
		},
		async ({ op }, ctx) =>
			textResult(
				await editor.requestEditor(`history.${op}`, {}, { signal: ctx.mcpReq.signal }),
			),
	);

	server.registerTool(
		"open_editor",
		{
			description:
				"Open the editor on a recording, which every editing tool and export_video needs and " +
				"none of them can do for themselves. After the app restarts there may be no editor " +
				"window at all, and until now the only way in was to record a throwaway clip — which " +
				"then left the wrong recording loaded. Pass a path, or omit it for the current " +
				"recording, or the newest one. It opens or focuses the window and waits for the " +
				"editor to report the recording you asked for, polling for up to 15 seconds rather " +
				"than believing the first answer, since an editor already open on another take " +
				"replies instantly with that one. **Only trust the reply when showing equals the " +
				"path you asked for** — if it does not, the note says what to do, and editing anyway " +
				"would act on the wrong recording. editorReady false means only the window " +
				"is guaranteed. Refused, changing nothing, for a relative " +
				"path, a file that is not a decodable video, no recordings at all, or while a " +
				"recording or export is running.",
			inputSchema: z.object({
				path: z
					.string()
					.min(1)
					.optional()
					.describe("Absolute path to a video; omit for the current or newest recording"),
			}),
		},
		async ({ path }, ctx) =>
			textResult(await recordings.openEditor({ path, signal: ctx.mcpReq.signal })),
	);

	server.registerTool(
		"recover_recording",
		{
			description:
				"Adopt a recording file Recordly lost track of, so review_recording and export_video " +
				"can see it. Use it when a take was interrupted: the file is on disk but no tool can " +
				"find it. list_recordings shows the candidates. It loads the file as the current " +
				"recording; the editor window must be open for export_video to follow.",
			inputSchema: z.object({
				path: z.string().min(1).describe("Absolute path to the video file"),
			}),
		},
		async ({ path }) => textResult(await recordings.recoverRecording(path)),
	);

	server.registerTool(
		"list_recordings",
		{
			description:
				"List the recordings in Recordly's library, newest first, with path, size and date. " +
				"Use it to find a take that was interrupted, then recover_recording.",
			inputSchema: z.object({}),
		},
		async () => textResult(await recordings.listRecordings()),
	);

	server.registerTool(
		"delete_recording",
		{
			description:
				"Move a recording to Recordly's own trash, which can be undone with " +
				"restore_recording. Use this instead of deleting the file yourself. It only accepts a " +
				"recording inside the library folder. **It refuses, naming them, when saved projects " +
				"use that recording**, because a project can hold hours of edits that restoring the " +
				"video would not bring back. force moves it anyway and keeps the projects, which show " +
				"a missing-video error until the recording is restored. The reply lists the projects " +
				"it found and any project file it could not read.",
			inputSchema: z.object({
				path: z.string().min(1).describe("Absolute path to the recording"),
				force: z
					.boolean()
					.optional()
					.describe("Delete even though projects use it; the projects are kept"),
			}),
		},
		async ({ path, force }) => textResult(await recordings.deleteRecording(path, { force })),
	);

	server.registerTool(
		"restore_recording",
		{
			description:
				"Put a recording deleted with delete_recording back in the library. The reply names " +
				"the projects that open again, or says none do — which means they were deleted " +
				"separately and this does not bring them back.",
			inputSchema: z.object({
				path: z.string().min(1).describe("Absolute path to the recording"),
			}),
		},
		async ({ path }) => textResult(await recordings.restoreRecording(path)),
	);

	server.registerTool(
		"wait_for_download",
		{
			description:
				"Wait until a file matching a path pattern has finished downloading, then return it. " +
				"A part-written file never matches, and nor does a file that was already there — so if " +
				"the download may have finished before you called, pass since_ms (epoch ms, e.g. the " +
				"moment you clicked Download) and anything newer than that counts. Use it when a demo " +
				"downloads something" +
				(control ? " you then open with open_file." : " and you need the saved path."),
			inputSchema: z.object({
				glob: z
					.string()
					.min(1)
					.describe(
						'Absolute path with * or ? in the file name, e.g. "/Users/me/Downloads/*.xlsx"',
					),
				timeout_ms: z
					.number()
					.int()
					.min(1_000)
					.max(300_000)
					.optional()
					.describe("Defaults to 60000"),
				since_ms: z
					.number()
					.int()
					.min(0)
					.optional()
					.describe(
						"Epoch ms; a match modified at or after this counts even if it already existed",
					),
			}),
		},
		async ({ glob, timeout_ms, since_ms }) =>
			textResult(
				await files.waitForDownload({ glob, timeoutMs: timeout_ms, sinceMs: since_ms }),
			),
	);

	server.registerTool(
		"set_overlay",
		{
			description:
				"Move, hide or unstick Recordly's floating control pill, which sits over the recorded " +
				"window and is left out of the recording and of screenshot — so a control underneath " +
				"it is unreachable and you cannot see why. It already lets clicks through while you " +
				"act; use this when the pill still blocks something. hidden: true removes the " +
				"on-screen Stop and Pause, leaving only the tray menu's Stop. Everything resets when " +
				"the recording ends, and nothing applies until the pill exists, so call it after " +
				"start_recording.",
			inputSchema: z.object({
				position: z
					.enum([...HUD_OVERLAY_CORNERS, "default"])
					.optional()
					.describe("Which corner to park it in"),
				hidden: z.boolean().optional().describe("Hide it completely"),
				click_through: z
					.enum(["auto", "on", "off"])
					.optional()
					.describe(
						"auto (default) lets clicks through while you act; on always does; off makes " +
							"the pill take clicks again, so a control under it becomes unreachable " +
							"without showing up in a screenshot — only use off if the user asks",
					),
			}),
		},
		async ({ position, hidden, click_through }) => {
			const state = await capture.setOverlay({
				position,
				hidden,
				clickThrough: click_through,
			});
			if (!state.windowOpen) {
				throw new Error(
					"There is no control pill yet, so nothing changed. Call this after start_recording.",
				);
			}
			return textResult(state);
		},
	);

	server.registerTool(
		"set_do_not_disturb",
		{
			description:
				"Silence notification banners for a take, and restore them afterwards. Best effort: " +
				"no operating system offers a stable way to do this, so it reports what happened " +
				"instead of failing, and on macOS it needs two Shortcuts named 'Recordly Do Not " +
				"Disturb On' and 'Recordly Do Not Disturb Off'. If it says it could not, ask the user " +
				"to turn it on themselves before you record.",
			inputSchema: z.object({
				enabled: z.boolean().describe("true to silence, false to restore"),
			}),
		},
		async ({ enabled }) => textResult(await capture.setDoNotDisturb(enabled)),
	);

	server.registerTool(
		"set_cursor",
		{
			description:
				"Leave the cursor out of the next recording, for scenes where the pointer is noise. " +
				"It applies to the recording you start next, not the one running, and the user can " +
				"turn the cursor back on in the editor.",
			inputSchema: z.object({
				hidden: z.boolean().describe("true to record without a cursor"),
			}),
		},
		async ({ hidden }) => {
			capture.setHideCursor(hidden);
			return textResult({ hidden, note: "Applies to the next start_recording." });
		},
	);

	server.registerTool(
		"arm_recording",
		{
			description:
				"Wait until the screen has been still for a moment, then start recording — so a " +
				"notification, an animation or a late-loading page does not land in the first frames. " +
				"Takes the same scenes as start_recording. If the screen never settles it starts " +
				"nothing and says so, leaving you to fix what is moving.",
			inputSchema: z.object({
				wait_for_still_ms: z
					.number()
					.int()
					.min(0)
					.max(10_000)
					.optional()
					.describe("How long the screen must be still; defaults to 1000"),
				timeout_ms: z
					.number()
					.int()
					.min(1_000)
					.max(120_000)
					.optional()
					.describe("Give up after this long; defaults to 30000"),
				countdownSeconds: z
					.number()
					.int()
					.min(0)
					.max(MAX_COUNTDOWN_SECONDS)
					.optional()
					.describe("Countdown before capture starts; defaults to the user's setting"),
				scenes: z
					.array(z.string().trim().min(1).max(200))
					.min(1)
					.max(12)
					.optional()
					.describe(
						"The scene list you rehearsed; required while the control switch is on",
					),
			}),
		},
		async ({ wait_for_still_ms, timeout_ms, ...start }, ctx) => {
			if (isControlEnabled() && start.scenes === undefined) {
				throw new Error(
					"Pass scenes: the scene list you rehearsed. Rehearse the flow unrecorded first " +
						"(perform with dryRun, then the steps for real), reset to the start state, " +
						"then arm_recording with one short line per scene.",
				);
			}
			const quiet = await capture.waitUntilQuiet({
				quietMs: wait_for_still_ms,
				timeoutMs: timeout_ms,
				signal: ctx.mcpReq.signal,
			});
			if (!quiet.quiet) {
				throw new Error(
					`${quiet.message ?? "The screen did not settle."} Nothing was recorded.`,
				);
			}
			capture.rememberScenes(start.scenes);
			return textResult({
				...(await remote.startRecording({ ...start, hideCursor: capture.getHideCursor() })),
				waitedMs: quiet.waitedMs,
			});
		},
	);

	server.registerTool(
		"get_frame",
		{
			description:
				"See one frame of the last recording, to check that a particular scene landed — " +
				"review_recording only shows the frames before each cut, so it cannot answer 'what was on " +
				"screen at 48 s'. atMs is a time in the edited timeline by default, mapped through the cuts " +
				'and speed changes to the moment it came from; source: "raw" uses the untouched recording ' +
				"instead. The frame is the recorded screen at that moment: it does not show zooms, " +
				"annotations, captions or the background, so use it to check WHAT was on screen, not how " +
				"the export will look — EXCEPT with rendered: true, which draws the blurs on so you " +
				"can confirm a redaction covers what you meant before anyone sees the video. The " +
				"result then lists each annotation at that moment and whether it was drawn; text, " +
				"images and arrows are listed but not drawn. A zoom moves where a blur sits in the " +
				"finished frame, not what it covers. A time in a cut gap or past the end is refused.",
			inputSchema: z.object({
				atMs: z.number().min(0).describe("Time in milliseconds"),
				source: z
					.enum(["edited", "raw"])
					.optional()
					.describe(
						'Defaults to edited (after cuts and speed); "raw" is the original recording',
					),
			}),
		},
		async (args, ctx) => {
			const frame = await editor.getFrame(args, { signal: ctx.mcpReq.signal });
			const parsed = /^data:([^;]+);base64,(.+)$/.exec(frame.dataUrl);
			if (!parsed) throw new Error("The editor returned a frame Recordly could not read.");
			const [, mimeType, data] = parsed;
			return {
				content: [
					{ type: "image" as const, data, mimeType },
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								atMs: frame.atMs,
								source: frame.source,
								sourceMs: frame.sourceMs,
								...(frame.annotations ? { annotations: frame.annotations } : {}),
								...(frame.note ? { note: frame.note } : {}),
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.registerTool(
		"sample_frames",
		{
			description:
				"Sweep the whole video: a contact sheet of evenly spaced frames, so you can check a " +
				"three-minute take for a leaked email address, a stray window or a wrong screen. " +
				"review_recording only shows the frames before each cut and get_frame only one " +
				"moment, so this is the only way to see the rest. Pass exactly one of everyMs or " +
				"count; 2 to 12 frames. Tiles are small (about 400x230 for 1080p), so use it to spot " +
				"a suspect moment and then get_frame at that time to read it. Moments that fall in a " +
				"cut gap are skipped and listed.",
			inputSchema: z.object({
				everyMs: z
					.number()
					.min(17)
					.optional()
					.describe("One frame every this long, at least 17 ms"),
				count: z
					.number()
					.int()
					.min(2)
					.max(12)
					.optional()
					.describe("This many, evenly spaced, 2 to 12"),
				source: z.enum(["edited", "raw"]).optional().describe("Defaults to edited"),
			}),
		},
		async (args, ctx) => {
			const sheet = await editor.sampleFrames(args, { signal: ctx.mcpReq.signal });
			const { image, ...rest } = sheet;
			return {
				content: [
					{ type: "image" as const, data: image.data, mimeType: image.mimeType },
					{ type: "text" as const, text: JSON.stringify(rest, null, 2) },
				],
			};
		},
	);

	server.registerTool(
		"add_card",
		{
			description:
				"Put a title or end card on the video. It is new time: the timeline grows by " +
				"durationMs, and the card sits on a held frame behind an opaque fill rather than on " +
				"empty space, so it composites everywhere the rest of the video does. op title and " +
				"op end differ only in the title's size and in where they default to — title at the " +
				"start, end at the end — and position overrides that, so op end with position start " +
				"is a legal chapter card. background is a hex colour and anything else is refused " +
				"rather than quietly defaulted; a logo must be an absolute path to an image that " +
				"reads, checked before anything changes. It refuses when no recording is loaded: a card " +
				"needs a frame to hold, and on empty time its words would not render at all. One " +
				"history undo takes back the card, its text and the region shifts together.",
			inputSchema: z.object({
				op: z.enum(["title", "end"]),
				text: z.string().min(1).max(200).describe("The card's heading"),
				subtitle: z
					.string()
					.max(200)
					.optional()
					.describe("A second line; blank simply omits it"),
				background: z
					.string()
					.min(1)
					.optional()
					.describe('Hex only, e.g. "#000000"; defaults to black'),
				logo: z.string().min(1).optional().describe("Absolute path to an image"),
				durationMs: z
					.number()
					.int()
					.min(1)
					.max(600_000)
					.describe("How long the card holds; it is added to the video's length"),
				position: z
					.enum(["start", "end"])
					.optional()
					.describe("Defaults to start for a title and end for an end card"),
			}),
		},
		async ({ op, ...rest }, ctx) =>
			textResult(
				await editor.requestEditor(`card.${op}`, rest, { signal: ctx.mcpReq.signal }),
			),
	);

	server.registerTool(
		"polish_recording",
		{
			description:
				"Apply the house look in one call instead of twenty. op-free: style picks the frame " +
				"(clean, dark or none) and captions decides whether to caption from the scene " +
				"titles — omit it to caption only when there are none, true to replace what is " +
				"there, false for none. Recordly already cuts dead time, speeds up idle stretches " +
				"and zooms on clicks when a fresh recording loads, so this does NOT redo that: it " +
				"reports what was already there and adds the look, scene captions, and an idle " +
				"speed-up only on a timeline nothing has touched yet, which is the case for a " +
				"reopened project. The reply lists every step as applied, already present, skipped " +
				"or failed with the reason, so nothing is claimed that did not happen, and it ends " +
				"with the problems check_edits would report. A step that fails does not stop the " +
				"others and nothing is rolled back. Idle speed-ups are hard steps, not ramps. " +
				"**history.undo reverts only the timeline edits, NOT the look**, which the editor " +
				"does not track — to go back, send the previous look values from get_editor_state " +
				"and undo the timeline edits one at a time.",
			inputSchema: z.object({
				style: z
					.enum(["clean", "dark", "none"])
					.optional()
					.describe("The frame to apply; defaults to clean"),
				captions: z
					.boolean()
					.optional()
					.describe(
						"Omit to caption only when there are none, true to replace them, false for none",
					),
			}),
		},
		async (args, ctx) =>
			textResult(
				await editor.requestEditor("polish_recording", args, { signal: ctx.mcpReq.signal }),
			),
	);

	server.registerTool(
		"edit_project",
		{
			description:
				"Save the edit under a name, open a saved one, or start again. Until now an edit " +
				"lived only in the editor's memory against the current recording, with no name and " +
				"no second version, so a restart lost the work. op save writes clips, zooms, " +
				"annotations, captions, audio and the look to a named project and reports the counts " +
				"it wrote; op open loads one back by name or absolute path and reports what it " +
				"loaded; op new clears the edit back to the untouched recording. Opening refuses " +
				"while there are unsaved changes unless you pass discard, and opening a project made " +
				"from a different recording switches the editor to that recording and says so. " +
				"Saving under a name that belongs to a different project is refused rather than " +
				"overwriting it. The look is saved and restored; the thumbnail is not.",
			inputSchema: z.object({
				op: z.enum(["save", "open", "new"]),
				name: z
					.string()
					.min(1)
					.max(100)
					.optional()
					.describe("op save, or op open: the project name, no path separators"),
				path: z
					.string()
					.min(1)
					.optional()
					.describe("op open: an absolute path to a .recordly or .openscreen file"),
				discard: z
					.boolean()
					.optional()
					.describe("op open: throw away unsaved changes instead of refusing"),
			}),
		},
		async ({ op, ...rest }, ctx) =>
			textResult(
				await editor.requestEditor(`project.${op}`, rest, { signal: ctx.mcpReq.signal }),
			),
	);

	server.registerTool(
		"check_edits",
		{
			description:
				"Look for mistakes in the current edit without rendering anything. It is instant and " +
				"free, so run it after a batch of edits and before any preview or export. It catches " +
				"what costs the most to find late: a title or logo in the default frame space that an " +
				"active zoom will crop out of view, a crop or padding that leaves too little picture, " +
				"a blur sitting over a moving zoom, geometry off the frame, an empty or inverted " +
				"region, an overlay whose colour is likely invisible against what is behind it, and " +
				"a caption that was legal when written but was made illegal by a later " +
				"trim or split — the cut rule only runs when a caption is written, so nothing else " +
				"re-checks it. Every problem carries the moment to look at, so pass its atMs to " +
				"render_preview to see it. severity error means certainly wrong; warning means worth " +
				"a look. The reply also lists the checks that ran, so you can tell nothing-wrong from " +
				"not-checked. It reads the state only and changes nothing.",
			inputSchema: z.object({}),
		},
		async (_args, ctx) =>
			textResult(
				await editor.requestEditor("check_edits", {}, { signal: ctx.mcpReq.signal }),
			),
	);

	server.registerTool(
		"render_preview",
		{
			description:
				"See what the EXPORT will look like, before spending the time to make one. Unlike " +
				"get_frame and sample_frames, which both return the recorded screen, this composites " +
				"the frame through the export renderer: cuts and speed, zooms, the look (wallpaper, " +
				"padding, corner radius, shadow), the cursor, annotations and captions. Use it after " +
				"any edit you cannot otherwise check — a blur you need to know covers the right thing, " +
				"a caption's position, a title that an active zoom might crop, a padding value. Times " +
				"are milliseconds in the EDITED timeline. The first call loads the recording and starts " +
				"the renderer, so it is slow; after that both are kept warm for a minute and another " +
				"single frame comes back quickly, so check often rather than saving it up. reused says " +
				"which half was warm. An edit that changes the picture rebuilds the renderer, as it must. " +
				"The reply lists which layers it drew and which it could not, with the " +
				"reason, so a half-composited frame is never passed off as the finished look. Needs " +
				"the editor open.",
			inputSchema: z.object({
				atMs: z
					.number()
					.min(0)
					.optional()
					.describe(
						"One frame at this edited time. Defaults to 0. Not with count/everyMs",
					),
				count: z
					.number()
					.int()
					.min(2)
					.max(6)
					.optional()
					.describe("A contact sheet of this many frames, evenly spaced, 2 to 6"),
				everyMs: z
					.number()
					.min(17)
					.optional()
					.describe("A frame every this many ms; the total must come to 2 to 6"),
				aspect: z
					.string()
					.min(1)
					.optional()
					.describe('Letterbox as the export would, e.g. "16:9"; not with padTo'),
				padTo: z
					.string()
					.min(1)
					.optional()
					.describe(
						'Letterbox to exactly this size, e.g. "2880x1600"; not with aspect or scale',
					),
				scale: z
					.number()
					.min(0.05)
					.max(1)
					.optional()
					.describe("Shrink as the export would, 0.05-1; not with padTo"),
			}),
		},
		async (args, ctx) => {
			const sheet = (await editor.requestEditor("render_preview", args, {
				signal: ctx.mcpReq.signal,
			})) as { image: { data: string; mimeType: string } } & Record<string, unknown>;
			const { image, ...rest } = sheet;
			return {
				content: [
					{ type: "image" as const, data: image.data, mimeType: image.mimeType },
					{ type: "text" as const, text: JSON.stringify(rest, null, 2) },
				],
			};
		},
	);

	server.registerTool(
		"thumbnail",
		{
			description:
				"Write one composited frame to an image file — the still for the email, the deck or " +
				"the pull request that goes with the video. It is the export renderer's own " +
				"composite, not the recorded screen, and it works before any export exists. The " +
				"image is at most 1280px wide, so it is a preview-size still rather than full " +
				"export resolution. A time inside a cut or past the end is refused, and an existing " +
				"file is kept unless you pass overwrite.",
			inputSchema: z.object({
				atMs: z.number().min(0).describe("The edited time to capture"),
				outputPath: z
					.string()
					.min(1)
					.describe("Absolute path ending in .png, .jpg or .jpeg"),
				overwrite: z.boolean().optional().describe("Replace an existing file"),
			}),
		},
		async (args, ctx) => textResult(await thumbnail(args, ctx.mcpReq.signal)),
	);

	server.registerTool(
		"verify_export",
		{
			description:
				"Check a video file for frames with no picture. export_video already does this to " +
				"what it writes; use this for a file exported earlier, or to re-check one after " +
				"moving it. It samples frames across the file and reports the moments that are black " +
				"or a single flat colour, which is what a broken render leaves behind — a file can " +
				"have the right size and length and still be minutes of bare wallpaper. It cannot " +
				"tell a deliberate fade or a plain title card from a fault; it reports what it finds " +
				"and you decide.",
			inputSchema: z.object({
				path: z.string().min(1).describe("Absolute path to the video file"),
				samples: z
					.number()
					.int()
					.min(1)
					.max(32)
					.optional()
					.describe("How many frames to check, 1 to 32. Defaults to 8"),
			}),
		},
		async ({ path: filePath, samples }, ctx) =>
			textResult(await remoteExport.verifyFile(filePath, samples, ctx.mcpReq.signal)),
	);

	server.registerTool(
		"get_editor_state",
		{
			description:
				"List what the editor is about to export: the loaded recording, the raw and edited " +
				"durations, every clip, zoom, annotation, audio region and caption with its times, the " +
				"look and motion settings, and each rehearsed scene with its start and end in the " +
				"EDITED timeline — which is how you check a cut against a length budget and how you " +
				"find the scene index for edit_timeline. Scene times come from the recording's " +
				"activity log, so for a recording nobody drove they come back as unavailable with the " +
				"reason while the rest of the state still arrives. The whole state runs to thousands " +
				"of tokens on a long take, so ask for what you need: include names the sections to " +
				"return and the reply says what it left out, and clips summary gives the clip count " +
				"and kept length instead of every clip. Pass clips full when you need a clip id or " +
				"time for edit_timeline.",
			inputSchema: z.object({
				include: z
					.array(z.enum(STATE_SECTIONS))
					.min(1)
					.optional()
					.describe("Sections to return. Omit for all of them."),
				clips: z
					.enum(CLIP_DETAILS)
					.optional()
					.describe("How much clip detail: full (default), summary or none"),
			}),
		},
		async ({ include, clips }, ctx) =>
			textResult(
				projectEditorState(await editor.getState({ signal: ctx.mcpReq.signal }), {
					include,
					clips,
				}),
			),
	);

	if (!control) return server;

	server.registerTool(
		"open_url",
		{
			description:
				"Open an http(s) URL in the user's default browser (their own signed-in profile), wait for " +
				"its window and select it as the capture source, ready for screenshot. Use it to start any " +
				"web demo. Refused while recording: navigate inside the page with perform instead (click a " +
				`link, or ${mac ? "cmd" : "ctrl"}+l, type the address, enter). Needs ` +
				`${CONTROL_SWITCH}. If it cannot find the browser window, call list_sources, then ` +
				"select_source.",
			inputSchema: z.object({ url: z.string().min(1).describe("Full http(s) URL") }),
		},
		async ({ url }) => {
			if (!isControlEnabled()) throw new Error(CONTROL_OFF);
			return textResult(await agent.openUrl(url));
		},
	);

	server.registerTool(
		"set_window_bounds",
		{
			description:
				"Move and resize a window, in screen coordinates as list_sources reports them. Use it " +
				"to frame a demo before you record: put the window on the main display at a landscape " +
				"size (at least 1.2 × as wide as tall, so automatic zooms work). It is also the fix " +
				"for an app that opens off-screen or on another display. Pass source to aim at a " +
				"window other than the selected one. The window manager may adjust the rectangle; the " +
				"result says what it ended up as. Refused for the window being recorded once capture " +
				"has started, because moving it mid-take wrecks the framing of the video.",
			inputSchema: z.object({
				source: z
					.string()
					.min(1)
					.optional()
					.describe("A list_sources window id; defaults to the selected window"),
				x: z.number().describe("Screen x of the left edge"),
				y: z.number().describe("Screen y of the top edge"),
				width: z.number().min(1).describe("Width in points"),
				height: z.number().min(1).describe("Height in points"),
				raise: z.boolean().optional().describe("Also bring it to the front"),
			}),
		},
		async (args) => {
			if (!isControlEnabled()) throw new Error(CONTROL_OFF);
			const { state, selectedSource } = remote.getStatus();
			const recording = state === "recording" || state === "paused" || state === "countdown";
			const windowId = args.source?.match(/\d+/)?.[0];
			const aimsAtRecorded =
				args.source === undefined ||
				(windowId !== undefined && selectedSource?.id?.includes(windowId) === true);
			if (recording && aimsAtRecorded) {
				throw new Error(
					"Recordly is recording this window, so moving or resizing it now would wreck the " +
						"framing. Frame it before start_recording, or stop first.",
				);
			}
			return textResult(await agent.setWindowBounds(args));
		},
	);

	server.registerTool(
		"undo_last_input",
		{
			description:
				"Ask the focused app to undo, by sending its undo shortcut. Best effort and nothing " +
				"more: it cannot take back a click, only ask the app to undo what the click did, and " +
				"an app with nothing to undo ignores it. Use it right after a wrong step has changed " +
				"something, then re-aim from a fresh screenshot.",
			inputSchema: z.object({}),
		},
		async () => {
			if (!isControlEnabled()) throw new Error(CONTROL_OFF);
			return textResult(await agent.undoLastInput());
		},
	);

	server.registerTool(
		"open_file",
		{
			description:
				"Open a file in its usual app (or withApp), wait for its window and, with " +
				"thenSelectSource, select it as the capture source — the one call for 'open the file " +
				"that was just downloaded and record it'. While a whole screen is recorded this works " +
				"mid-take and picks the window to drive, so a download and the file opening stay in one " +
				"shot. While a single window is recorded it is refused: switching the captured source " +
				"would end the take.",
			inputSchema: z.object({
				path: z.string().min(1).describe("Absolute path to the file"),
				with_app: z
					.string()
					.min(1)
					.optional()
					.describe(
						'An app name on macOS, e.g. "Microsoft Excel"; an executable path on Windows ' +
							"and Linux. Omit it to use whatever opens the file by default",
					),
				then_select_source: z
					.boolean()
					.optional()
					.describe("Select the window it opens as the capture source"),
			}),
		},
		async ({ path, with_app, then_select_source }) => {
			if (!isControlEnabled()) throw new Error(CONTROL_OFF);
			const { state, selectedSource } = remote.getStatus();
			const recordsScreen =
				linuxControl || selectedSource?.id?.startsWith("screen:") === true;
			if (state !== "idle" && !recordsScreen) {
				throw new Error(
					"A single window is being recorded, so opening a file now would switch away from " +
						"it and end the take. Record the whole screen instead, or open the file before " +
						"start_recording.",
				);
			}
			return textResult(
				await files.openFile({
					path,
					withApp: with_app,
					thenSelectSource: then_select_source,
				}),
			);
		},
	);

	server.registerTool(
		"screenshot",
		{
			description:
				"See the selected window: raises it, then returns a JPEG of exactly the screen area a " +
				"recording captures (long edge at most 1568 px), plus width, height and scale — window " +
				"points per image pixel, so point = pixel × scale. If part of the window is off screen it " +
				"also returns originX/originY: point = origin + pixel × scale. Not part of the video. Take " +
				"a fresh one after anything that changes the view (navigation, dialogs, scrolling, " +
				"resizing); older coordinates are stale. If the window is closed, minimized or on another " +
				"desktop, call list_sources, then select_source. To aim precisely at a small target (an " +
				"icon, list row, toggle) that find_elements does not list, screenshot a region around it " +
				"(e.g. 300 × 200 points): the image then shows only that rectangle, clamped to the window, " +
				"at up to the display's full resolution, and returns originX/originY — use point = origin + " +
				'pixel × scale. While a whole screen is recorded, of: "display" shows that screen ' +
				"instead, with the driven window's rectangle in its points, so you can see an app before " +
				"switching to it with select_source; steps still aim in window points.",
			inputSchema: z.object({
				region: z
					.object({
						x: z
							.number()
							.describe("Window-relative x of the region's left edge, in points"),
						y: z
							.number()
							.describe("Window-relative y of the region's top edge, in points"),
						width: z.number().positive().describe("Region width in points"),
						height: z.number().positive().describe("Region height in points"),
					})
					.optional()
					.describe("Zoom into this rectangle of the window; omit for the whole window"),
				of: z
					.enum(["window", "display"])
					.optional()
					.describe(
						'Defaults to the window being driven. "display" shows the whole screen being ' +
							"recorded, to find another app to switch to — aim in window points, not these",
					),
			}),
		},
		async ({ region, of }) => {
			const shot = await agent.screenshot(region, of);
			const { data, mimeType, width, height, scale, originX, originY } = shot;
			const offset = region !== undefined || originX !== 0 || originY !== 0;
			const info = offset
				? {
						width,
						height,
						scale,
						originX,
						originY,
						hint: `${region ? "Only the region is shown." : "Part of the window is off screen."} Window point = (originX + pixel x × scale, originY + pixel y × scale).`,
					}
				: {
						width,
						height,
						scale,
						hint: "Window point = image pixel × scale. Pass window points to click, drag, move_pointer, scroll and perform.",
					};
			return {
				content: [
					{ type: "image" as const, data, mimeType },
					{
						type: "text" as const,
						text: JSON.stringify({
							...info,
							scope: shot.scope,
							...(shot.window ? { window: shot.window } : {}),
							...(shot.note ? { note: shot.note } : {}),
						}),
					},
				],
			};
		},
	);

	server.registerTool(
		"find_elements",
		{
			description:
				`Find controls in the selected window through ${mac ? "macOS Accessibility" : platform === "win32" ? "UI Automation" : "AT-SPI"}: buttons, links, text ` +
				"fields, checkboxes, menus and labelled text. Filter by visible text and/or role. Returns " +
				"{ elements: [{role, label, x, y, width, height}], truncated } in window-relative points; " +
				"click the centre (x + width/2, y + height/2). More precise than reading a screenshot, but " +
				"some apps (canvas-based, games, custom-drawn UIs) expose few or no elements — then pick " +
				"points from screenshot. On Linux, browsers and Electron apps list controls only when " +
				"started with ACCESSIBILITY_ENABLED=1; otherwise aim from a region screenshot. " +
				"A label is the whole visible text, counts and badges included: a " +
				'chip reading "Pending" with 93 items has the label "Pending 93". ' +
				"Read-only; works while the mouse and keyboard switch is off.",
			annotations: { readOnlyHint: true },
			inputSchema: z.object({
				text: z
					.string()
					.min(1)
					.optional()
					.describe("Case-insensitive text in the label, e.g. Save"),
				role: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Accessibility role, e.g. AXButton, AXLink, AXTextField, AXTextArea, AXCheckBox, " +
							"AXPopUpButton, AXMenuItem, AXStaticText",
					),
				limit: z.number().int().min(1).max(200).optional().describe("Defaults to 30"),
			}),
		},
		async (args) => textResult(await agent.findElements(args)),
	);

	server.registerTool(
		"click",
		{
			description:
				"Glide the real pointer to a point and click it; the recording zooms in on clicks. count 2 " +
				"double-clicks and 3 triple-clicks (selects a line or paragraph in most apps); button right " +
				'opens a context menu; modifiers are held during the click (e.g. ["cmd"] for cmd+click), ' +
				`which needs the recorded window frontmost. ${POINT_HELP} ${INPUT_HELP}`,
			inputSchema: z
				.object(clickArgs)
				.refine((value) => onePoint(value, "x", "y", "target"), POINT_OR_TARGET),
		},
		async (args) => perform([{ action: "click", ...args }]),
	);

	server.registerTool(
		"drag",
		{
			description:
				"Drag from (fromX, fromY) or a from target to (toX, toY) or a to target: glide to the start, " +
				"press, hold, move with easing, release, paced by distance. Use it to move or reorder " +
				"items, resize panes, draw or select a range. Both points must be inside the window. The button is always released, even when " +
				"the user takes over. Modifiers are held for the whole drag and need the recorded window " +
				`frontmost. ${POINT_HELP} ${INPUT_HELP}`,
			inputSchema: z.object(dragArgs).refine(dragEndsValid, DRAG_RULE),
		},
		async (args) => perform([{ action: "drag", ...args }]),
	);

	server.registerTool(
		"move_pointer",
		{
			description:
				"Glide the real pointer to a point without clicking: hover to reveal menus or tooltips, or " +
				`guide the viewer's eye. ${POINT_HELP} ${INPUT_HELP}`,
			inputSchema: z
				.object(moveArgs)
				.refine((value) => onePoint(value, "x", "y", "target"), POINT_OR_TARGET),
		},
		async (args) => perform([{ action: "move", ...args }]),
	);

	server.registerTool(
		"scroll",
		{
			description:
				"Move the pointer to a point and smoothly scroll whatever is under it (the page, a list, a " +
				"panel) by pixels: positive deltaY scrolls down, negative up; deltaX scrolls sideways. " +
				"shift+scroll scrolls sideways in many apps; modifiers need the recorded window frontmost. " +
				"Content moves, so screenshot again before targeting anything it scrolled. " +
				`${POINT_HELP} ${INPUT_HELP}`,
			inputSchema: z
				.object(scrollArgs)
				.refine((value) => onePoint(value, "x", "y", "target"), POINT_OR_TARGET),
		},
		async (args) => perform([{ action: "scroll", ...args }]),
	);

	server.registerTool(
		"type_text",
		{
			description:
				"Type text into the focused field of the selected window at a natural typing pace — any " +
				"language, emoji or symbol, whatever the keyboard layout. \\n (or \\r\\n) presses Return and \\t " +
				"presses Tab; nothing else is pressed, so add \\n to submit. Click the field first. Typing goes only " +
				"to the selected window while its app is frontmost. For shortcuts and special keys use " +
				`press_key. ${INPUT_HELP}`,
			inputSchema: z.object(typeArgs),
		},
		async (args) => perform([{ action: "type", ...args }]),
	);

	server.registerTool(
		"press_key",
		{
			description:
				"Press one key or shortcut in the selected window, optionally several times; sent only while " +
				`its app is frontmost. ${KEY_REFERENCE} ${INPUT_NOTE} Errors are explained in click's ` +
				"description; 'the user took over' ends the scene, not the recording: wait, re-aim, continue.",
			inputSchema: z.object(keyArgs),
		},
		async (args) => perform([{ action: "key", ...args }]),
	);

	server.registerTool(
		"wait_for",
		{
			description:
				"Wait in the selected window until an element appears (text and/or role), disappears " +
				"(gone: true) or the screen stops changing (settled: true). Use after open_url or anything " +
				"slow, before planning the next targets. Element waits fail at timeoutMs (default 10000); " +
				`settled carries on. Logged as waiting, which Recordly shortens in the video. ${INPUT_NOTE}`,
			inputSchema: z.object(waitForArgs).refine(waitForValid, WAIT_FOR_RULE),
		},
		async (args) => perform([{ action: "waitFor", ...args }]),
	);

	server.registerTool(
		"set_input_policy",
		{
			description:
				"Set how mouse and keyboard control reacts when the user touches the mouse or keyboard. " +
				"onTakeover 'abort' (default) ends the perform at once. 'pause' stops acting, waits " +
				"until the pointer has been still for autoResumeAfterMs (default 2000), then re-arms and " +
				"carries on, re-running the interrupted step; the pause is logged as waiting and shortened. " +
				"Because the whole step re-runs, a type interrupted halfway types the text again on top " +
				"of what landed, so prefer 'abort' for scenes that type into fields. " +
				"tolerancePx is how far the pointer may drift in one second before it counts as a " +
				"takeover (default 8; macOS only). requireTargets refuses raw coordinates while " +
				"recording — a stale coordinate once created a sheet in a real workbook because the " +
				"tab strip had scrolled since the screenshot. safeRegion here applies to every later " +
				"perform, and perform's own safeRegion wins. Esc always aborts. Settings last until " +
				"changed.",
			inputSchema: z.object({
				tolerancePx: z.number().min(1).max(500).optional(),
				autoResumeAfterMs: z.number().int().min(200).max(30000).optional(),
				onTakeover: z.enum(["pause", "abort"]).optional(),
				requireTargets: z
					.boolean()
					.optional()
					.describe(
						"true refuses a raw x/y click, drag or move while recording, so every step " +
							"re-finds its target as it runs; scrolling is unaffected",
					),
				safeRegion: z
					.object({
						x: z.number(),
						y: z.number(),
						width: z.number().positive(),
						height: z.number().positive(),
					})
					.nullable()
					.optional()
					.describe("Window-relative rectangle for every later perform; null clears it"),
			}),
		},
		async (args) => textResult({ policy: agent.setInputPolicy(args) }),
	);

	server.registerTool(
		"perform",
		{
			description:
				"Run one rehearsed scene: steps run back to back with exact timing (separate calls " +
				"add cuts). Each step takes the matching tool's fields plus " +
				"action: move, click, drag, scroll, type, key, wait/hold {ms}, expect or waitFor. A target {text, " +
				"role?, index?} is found when its step runs (waiting up to 5 s, scrolling into " +
				"view), so a scene may change page; prefer targets to coordinates. Leave out " +
				"durationMs and waits: Recordly glides naturally and, after a click or Enter, lets " +
				"the screen settle and holds the result. A wait or waitFor right after one " +
				"replaces that hold. hold {ms} (same as wait {ms}) is kept whole in the video, for " +
				"reading; waitFor is shortened, for slow content; durationMs sets one glide. " +
				"expect {target} fails at once if missing. safeRegion refuses input outside it, " +
				"not scrolling. " +
				"dryRun acts on nothing: " +
				"it probes to the first step that can change the page, inclusive, returning " +
				"dryRun: [{index (1-based, as in 'Step n'), action, found, label?, candidates?, " +
				"ambiguous?, matches?, note?}], later steps as found: null, note 'validated at run " +
				"time'. found: false with " +
				"candidates > 1 means ambiguous, not missing. dryRun and " +
				"then: 'elements' also return page, a signature to compare between the rehearsal " +
				"and the take; then: 'elements' adds the visible controls. Limits: 1–200 steps, waits up to " +
				"30000 ms, 10 min a call." +
				" A failure says 'Step n (action)': the page diverged, so cancel_recording and " +
				`take the scene again. Returns { performed, durationMs }. ${POINT_HELP} ${INPUT_NOTE} ` +
				"Errors, including 'the user took over' (it ends the scene, not the recording), " +
				"are in click's description.",
			inputSchema: z.object({
				steps: z.array(stepSchema).min(1).max(200),
				title: z
					.string()
					.trim()
					.min(1)
					.max(80)
					.optional()
					.describe("Scene caption, only when the user asks for captions or a tutorial"),
				pace: z
					.enum(["brisk", "normal", "relaxed"])
					.optional()
					.describe(
						"How fast Recordly glides and how long it holds results; defaults to normal",
					),
				dryRun: z
					.boolean()
					.optional()
					.describe("Only check the targets on the page you are on now; no input"),
				then: z
					.literal("elements")
					.optional()
					.describe("Also return the visible controls after the last step"),
				safeRegion: z
					.object({
						x: z.number(),
						y: z.number(),
						width: z.number().positive(),
						height: z.number().positive(),
					})
					.optional()
					.describe(
						"Window-relative rectangle; a click, drag or move outside it is refused",
					),
			}),
		},
		async ({ steps, ...options }) =>
			perform(
				steps,
				Object.values(options).some((value) => value !== undefined) ? options : undefined,
			),
	);

	return server;
}
