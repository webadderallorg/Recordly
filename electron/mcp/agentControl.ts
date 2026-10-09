import { app, shell } from "electron";
import { clamp } from "../ipc/cursor/telemetry";
import { selectedSource } from "../ipc/state";
import { type SelectedSource, WINDOW_OFF_SCREEN_MESSAGE, type WindowBounds } from "../ipc/types";
import { getScreen, parseWindowId } from "../ipc/utils";
import {
	type AgentActivityAction,
	type AgentActivitySpanKind,
	type AgentActivityTarget,
	beginScene,
	beginSpan,
	getAgentActivityMs,
	markCameraTarget,
} from "./agentActivity";
import { type AgentInput, agentInput } from "./agentInput";
import { type AgentPlatform, agentPlatform, isActionableRole } from "./agentPlatform";
import {
	AGENT_KEY_ALIASES,
	AGENT_KEY_NAMES,
	AGENT_MODIFIER_ALIASES,
	AGENT_ROLE_ALIASES,
	type AgentButton,
	type AgentCommand,
	type AgentElement,
	type AgentEvent,
	type AgentFrame,
	type AgentHit,
	type AgentModifier,
	type AgentResults,
	type AgentWindow,
} from "./agentProtocol";
import type { RemoteControl } from "./remoteControl";
import { captureWindow, type WindowShot, waitForStillWindow } from "./screenshot";

export type AgentTarget = { text: string; role?: string; index?: number };
type At = { x?: number; y?: number; target?: AgentTarget };

export type AgentStep =
	| ({ action: "move"; durationMs?: number } & At)
	| ({
			action: "click";
			button?: AgentButton;
			count?: 1 | 2 | 3;
			modifiers?: string[];
			durationMs?: number;
	  } & At)
	| {
			action: "drag";
			fromX?: number;
			fromY?: number;
			from?: AgentTarget;
			toX?: number;
			toY?: number;
			to?: AgentTarget;
			button?: AgentButton;
			modifiers?: string[];
			durationMs?: number;
	  }
	| ({ action: "scroll"; deltaY: number; deltaX?: number; modifiers?: string[] } & At)
	| { action: "type"; text: string; into?: AgentTarget }
	| { action: "key"; key: string; modifiers?: string[]; repeat?: number }
	| { action: "wait" | "hold"; ms: number }
	| { action: "expect"; target: AgentTarget; visible?: boolean }
	| {
			action: "waitFor";
			text?: string;
			role?: string;
			gone?: boolean;
			settled?: boolean;
			timeoutMs?: number;
	  };

export type AgentPace = "brisk" | "normal" | "relaxed";
export type PerformOptions = {
	title?: string;
	pace?: AgentPace;
	dryRun?: boolean;
	then?: "elements";
	safeRegion?: AgentFrame;
};
export type AgentElementView = AgentElement;
export type AgentDryRunStep = {
	index: number;
	action: AgentStep["action"];
	found: boolean | null;
	label?: string;
	x?: number;
	y?: number;
	candidates?: number;
	ambiguous?: boolean;
	matches?: string[];
	note?: string;
};
export type PerformResult = {
	performed: number;
	durationMs: number;
	elements?: AgentElementView[];
	dryRun?: AgentDryRunStep[];
	page?: string;
};

export type AgentShotScope = "window" | "display";
export type AgentShot = WindowShot & {
	scope: AgentShotScope;
	window?: WindowBounds;
	note?: string;
};

export const AGENT_LIMITS = { steps: 200, waitMs: 30_000, totalMs: 600_000 };
const SCROLL_MS = 600;
const KEY_REPEAT_MS = 35;
const KEY_REPEAT_MAX = 100;
const TYPE_CPS = 25;
const SETTLE_MS = 250;
const OPEN_URL_WAIT_MS = 5000;
const POLL_MS = 250;
const FIND_LIMIT = 30;
const GLIDE_BASE_MS = 350;
const GLIDE_MS_PER_POINT = 0.45;
const GLIDE_MIN_MS = 450;
const GLIDE_MAX_MS = 1100;
const AUTO_SETTLE_MS = 4000;
const READ_HOLD_MS = 1200;
const WAIT_FOR_MS = 10_000;
const TARGET_WAIT_MS = 5000;
const TARGET_FIND_LIMIT = 200;
const TARGET_SCROLLS = 6;
const TARGET_STALLS = 2;
const AUTO_QUIET_MS = 700;
const CENTRE_MARGIN = 0.15;
const SCROLL_REACH = 2;
const TARGET_TEXT_MAX = 200;
const SCROLL_INSET = 24;
const SCROLL_PAGE = 0.8;
const LISTED = 5;
const STABLE_SAMPLE_MS = 100;
const STABLE_WAIT_MS = 1200;
const AIM_SETTLED_PT = 4;
const AIM_NUDGE_PT = 24;
const AIM_NUDGE_MS = 120;
const AIM_TRIES = 3;
const HIT_OVERLAP = 0.6;
const RUN_TIME_NOTE = "validated at run time";

type Pace = { glide: number; hold: number };
const PACES = new Map<string, Pace>([
	["brisk", { glide: 0.8, hold: 0.6 }],
	["normal", { glide: 1, hold: 1 }],
	["relaxed", { glide: 1.2, hold: 1.6 }],
]);

export const TAKEOVER_MESSAGE = "Stopped: the user took over the mouse or keyboard.";
const TAKEOVER_CAUSES: Record<AgentEvent["kind"], string> = {
	move: "the mouse moved",
	button: "a mouse button was pressed",
	scroll: "the mouse or trackpad scrolled",
	key: "a key was pressed",
};
const POST_EVENTS_MISSING =
	"Recordly is not allowed to post mouse and keyboard input. Ask the user to enable Recordly in " +
	"System Settings > Privacy & Security > Accessibility, then quit and reopen Recordly. When " +
	"Recordly runs from `npm run dev`, macOS checks the terminal app's Accessibility permission " +
	"instead: use the installed app, or grant Accessibility to that terminal.";
const INPUT_UNAVAILABLE =
	"Recordly cannot post mouse and keyboard input on this system. On Linux it needs an X11 session " +
	"with the XTest extension.";
const LINUX_ACCESSIBILITY_OFF =
	"Recordly cannot read this window's controls. On Linux, Chromium-based browsers and Electron " +
	"apps expose them only when started with ACCESSIBILITY_ENABLED=1 (e.g. ACCESSIBILITY_ENABLED=1 " +
	"google-chrome): ask the user to restart the app that way, or aim with region screenshots " +
	"instead of targets.";
const OWN_WINDOW = "Recordly cannot control its own windows. Select another window.";
const NO_WINDOW =
	"Select a window first (open_url, or list_sources then select_source). Mouse and keyboard " +
	"control works on windows, not whole screens.";
const OFF_RECORDED_DISPLAY =
	"The window chosen for the mouse and keyboard is on a different display from the one being " +
	"recorded, so nothing it does would appear in the video. Move it onto the recorded display, or " +
	"select that display with select_source.";
const CONTROL_NEEDS_SCREEN =
	"A window is being recorded, not a whole screen, so the mouse and keyboard already act on it. " +
	"To drive one window while a whole display records, select a screen with select_source first.";
const DISPLAY_SHOT_NEEDS_SCREEN =
	"A window is being recorded, not a whole screen, so there is no recorded display to show. " +
	"screenshot without of already shows the recorded window.";
const DISPLAY_SHOT_NOTE =
	"This image shows the whole recorded display, in display points. Clicks, drags, moves, scrolls " +
	"and perform steps still take points inside the control window, whose rectangle in this image's " +
	"points is window: subtract window.x and window.y to turn a display point into a window point, " +
	"or take a plain screenshot to aim.";
const DISPLAY_SHOT_NO_CONTROL =
	"This image shows the whole recorded display, in display points. No window is chosen for the " +
	"mouse and keyboard yet, so nothing can be clicked: pick one from this image with select_source.";
const DISPLAY_SHOT_WINDOW_LOST =
	"This image shows the whole recorded display, in display points. The window chosen for the " +
	"mouse and keyboard is closed, minimized or not on this display, so its rectangle is not shown: " +
	"choose another one with select_source.";
const KNOWN_BROWSERS = [
	"com.google.Chrome",
	"com.apple.Safari",
	"org.mozilla.firefox",
	"com.microsoft.edgemac",
	"com.brave.Browser",
	"company.thebrowser.Browser",
	"com.operasoftware.Opera",
	"com.vivaldi.Vivaldi",
	"org.chromium.Chromium",
];
const UNDO_NOTE =
	"Best effort only: Recordly pressed the undo shortcut in the app that has focus. It cannot " +
	"un-click or reverse an action itself, and the app may have nothing to undo or may undo " +
	"something else. Take a screenshot to see what actually happened.";
const LIMIT_PASSED = "the perform passed its 10-minute limit. Split the demo into shorter scenes.";
const BROWSER_NOT_FOUND =
	"The page opened, but Recordly could not find the browser window. Call list_sources, then " +
	"select_source.";

type TargetWindow = {
	pid: number;
	windowId: number;
	frame: WindowBounds;
	recorded?: WindowBounds;
};
type Post = <C extends AgentCommand>(command: C) => Promise<AgentResults[C["cmd"]]>;
type Run = {
	start: TargetWindow;
	post: Post;
	pace: Pace;
	aborted: Promise<never>;
	signal: AbortSignal;
	deadline: number;
	safeRegion?: AgentFrame;
};
type InputPolicy = {
	tolerancePx?: number;
	autoResumeAfterMs: number;
	onTakeover: "pause" | "abort";
	requireTargets?: boolean;
	safeRegion?: AgentFrame | null;
};
type Probe = Omit<AgentDryRunStep, "index" | "action">;
type Resolved = { element: AgentElement; frame: WindowBounds; scrolled: boolean };
type Aimed = { at: Point; ms: number };

export type AgentControlDeps = {
	input: Pick<AgentInput, "request" | "events">;
	platform: AgentPlatform;
	getSelectedSource: () => SelectedSource | null;
	findWindow: (sourceId: string) => Promise<{ pid?: number; frame: WindowBounds | null } | null>;
	capture: (frame: WindowBounds, region?: WindowBounds) => Promise<WindowShot>;
	openExternal: (url: string) => Promise<void>;
	getBrowserName: (url: string) => string;
	getDisplays: () => WindowBounds[];
	sleep: (ms: number) => Promise<void>;
	waitForStill: typeof waitForStillWindow;
	now: () => number;
	setHudPassthrough: (active: boolean) => void;
};

let hudWindows: Promise<typeof import("../windows")> | null = null;
let hudQueue: Promise<unknown> = Promise.resolve();
const setHudPassthrough = (active: boolean) => {
	hudWindows ??= import("../windows");
	hudQueue = hudQueue
		.then(() => hudWindows)
		.then((windows) => windows?.setHudOverlayAgentActive(active))
		.catch(() => undefined);
};

const defaultDeps = (): AgentControlDeps => ({
	input: agentInput,
	platform: agentPlatform,
	getSelectedSource: () => selectedSource,
	findWindow: (sourceId) => agentPlatform.findWindow(sourceId),
	capture: captureWindow,
	openExternal: (url) => shell.openExternal(url, { activate: true }),
	getBrowserName: (url) => app.getApplicationNameForProtocol(url),
	getDisplays: () =>
		getScreen()
			.getAllDisplays()
			.map((display) => display.bounds),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	waitForStill: waitForStillWindow,
	now: Date.now,
	setHudPassthrough,
});

const normalizeAppName = (name: string) =>
	name
		.replace(/\.app$/i, "")
		.trim()
		.toLowerCase();

const isKnownBrowser = (bundleId: string | null) =>
	bundleId !== null &&
	KNOWN_BROWSERS.some((known) => bundleId === known || bundleId.startsWith(`${known}.`));

const MODIFIERS = new Map(Object.entries(AGENT_MODIFIER_ALIASES));
const KEY_NAMES = new Set<string>(AGENT_KEY_NAMES);
const KEY_ALIASES = new Map<string, string>(Object.entries(AGENT_KEY_ALIASES));
const CONTROL_KEYS = new Map([
	["\n", "enter"],
	["\r", "enter"],
	["\r\n", "enter"],
	["\t", "tab"],
]);

type Segmenter = { segment(text: string): Iterable<unknown> };
const graphemes: Segmenter = new (
	Intl as unknown as { Segmenter: new () => Segmenter }
).Segmenter();

function isOneGrapheme(text: string) {
	const segments = graphemes.segment(text)[Symbol.iterator]();
	return !segments.next().done && segments.next().done === true;
}

export function normalizeModifiers(modifiers: readonly string[] = []): AgentModifier[] {
	const result = new Set<AgentModifier>();
	for (const name of modifiers) {
		const modifier = MODIFIERS.get(String(name).trim().toLowerCase());
		if (!modifier) {
			throw new Error(
				`Unknown modifier "${name}". Use one of: ${[...MODIFIERS.keys()].join(", ")}.`,
			);
		}
		result.add(modifier);
	}
	return [...result];
}

export function normalizeKey(key: string) {
	const raw = String(key);
	const control = CONTROL_KEYS.get(raw);
	if (control) return control;
	if (isOneGrapheme(raw) && !/\p{Cc}/u.test(raw)) return raw;
	const name = raw
		.trim()
		.toLowerCase()
		.replace(/[\s_-]+/g, "");
	if (KEY_NAMES.has(name)) return name;
	const alias = KEY_ALIASES.get(name);
	if (alias) return alias;
	const hint = /.\+./.test(raw)
		? ` Pass modifiers separately, e.g. key "c" with modifiers ["cmd"].`
		: "";
	throw new Error(
		`Unknown key "${key}". Use a key name (enter, tab, escape, backspace, delete, space, up, down, ` +
			"left, right, home, end, pageup, pagedown, f1–f20, keypad0–keypad9, keypadenter, minus, " +
			`slash, …) or one character such as "a", "?" or "é". To enter text, use type_text.${hint}`,
	);
}

type PointerStep = Extract<AgentStep, { action: "move" | "click" | "drag" | "scroll" }>;
type Point = { x: number; y: number };
type Spot = { x?: number; y?: number; target?: AgentTarget; names: [string, string, string] };

function spotsOf(step: AgentStep): Spot[] {
	switch (step.action) {
		case "move":
		case "click":
		case "scroll":
			return [{ x: step.x, y: step.y, target: step.target, names: ["x", "y", "target"] }];
		case "drag":
			return [
				{
					x: step.fromX,
					y: step.fromY,
					target: step.from,
					names: ["fromX", "fromY", "from"],
				},
				{ x: step.toX, y: step.toY, target: step.to, names: ["toX", "toY", "to"] },
			];
		case "type":
			return step.into ? [{ target: step.into, names: ["", "", "into"] }] : [];
		case "expect":
			return [{ target: step.target, names: ["", "", "target"] }];
		default:
			return [];
	}
}

const pointsOf = (step: AgentStep): Point[] =>
	spotsOf(step).flatMap(({ x, y, target }) =>
		target || x === undefined || y === undefined ? [] : [{ x, y }],
	);

function stepError(index: number, step: AgentStep, error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return new Error(`Step ${index + 1} (${step.action}): ${message}`);
}

function checkText(text: unknown, owner: string) {
	if (typeof text !== "string" || !text.trim() || text.length > TARGET_TEXT_MAX) {
		throw new Error(`${owner} needs a text of 1 to ${TARGET_TEXT_MAX} characters.`);
	}
}

function checkSpot({ x, y, target, names: [xName, yName, targetName] }: Spot) {
	if (target) {
		if (x !== undefined || y !== undefined) {
			throw new Error(`Give either ${xName} and ${yName} or ${targetName}, not both.`);
		}
		checkText(target.text, `A ${targetName}`);
		if (target.index !== undefined && !(Number.isInteger(target.index) && target.index >= 0)) {
			throw new Error(`A ${targetName}'s index must be a whole number from 0.`);
		}
	} else if (x === undefined || y === undefined) {
		throw new Error(`Give ${xName} and ${yName}, or a ${targetName}.`);
	}
}

function checkWaitFor(step: Extract<AgentStep, { action: "waitFor" }>) {
	const element = Boolean(step.text?.trim() || step.role?.trim());
	if (element === Boolean(step.settled) || (step.settled && step.gone)) {
		throw new Error(
			"A waitFor needs text and/or role (add gone: true to wait for it to disappear), or settled: true on its own.",
		);
	}
	if (step.text !== undefined) checkText(step.text, "A waitFor");
	const { timeoutMs } = step;
	if (timeoutMs !== undefined && !(timeoutMs > 0 && timeoutMs <= AGENT_LIMITS.waitMs)) {
		throw new Error(
			`A waitFor's timeoutMs must be more than 0 and at most ${AGENT_LIMITS.waitMs}.`,
		);
	}
}

function checkStep(step: AgentStep) {
	if ("modifiers" in step) normalizeModifiers(step.modifiers);
	spotsOf(step).forEach(checkSpot);
	if (step.action === "click" && ![undefined, 1, 2, 3].includes(step.count)) {
		throw new Error("A click's count must be 1, 2 or 3.");
	}
	if (step.action === "key") {
		normalizeKey(step.key);
		const repeat = step.repeat ?? 1;
		if (!Number.isInteger(repeat) || repeat < 1 || repeat > KEY_REPEAT_MAX) {
			throw new Error(`A key's repeat must be a whole number from 1 to ${KEY_REPEAT_MAX}.`);
		}
	}
	if ((step.action === "wait" || step.action === "hold") && step.ms > AGENT_LIMITS.waitMs) {
		throw new Error(`A ${step.action} step may last at most ${AGENT_LIMITS.waitMs / 1000} s.`);
	}
	if (step.action === "waitFor") checkWaitFor(step);
}

const changesPage = (step: AgentStep) =>
	step.action === "click" ||
	step.action === "waitFor" ||
	(step.action === "key" && normalizeKey(step.key) === "enter");

const needsFrontmost = (step: AgentStep) =>
	step.action === "type" ||
	step.action === "key" ||
	("modifiers" in step && (step.modifiers?.length ?? 0) > 0);

function readsAfter(steps: AgentStep[], index: number) {
	const step = steps[index];
	const next = steps[index + 1];
	const submits =
		step.action === "click" || (step.action === "key" && normalizeKey(step.key) === "enter");
	if (
		!submits ||
		next?.action === "wait" ||
		next?.action === "hold" ||
		next?.action === "waitFor"
	)
		return false;
	return !(step.action === "click" && (next?.action === "type" || next?.action === "key"));
}

const signatureOf = (frames: AgentFrame[]) =>
	frames
		.map(({ x, y, width, height }) => [x, y, width, height].map(Math.round).join(","))
		.join(" ");

const pacedGlideMs = (distance: number, pace: Pace) =>
	Math.round(
		clamp(GLIDE_BASE_MS + GLIDE_MS_PER_POINT * distance, GLIDE_MIN_MS, GLIDE_MAX_MS) *
			pace.glide,
	);

function stepBudgetMs(step: AgentStep, glideMs: number) {
	switch (step.action) {
		case "move":
		case "click":
		case "drag":
			return step.durationMs ?? glideMs;
		case "scroll":
			return SCROLL_MS;
		case "type":
			return (step.text.length / TYPE_CPS) * 1000 + (step.into ? glideMs : 0);
		case "key":
			return (step.repeat ?? 1) * KEY_REPEAT_MS;
		case "wait":
		case "hold":
			return step.ms;
		case "expect":
			return POLL_MS;
		case "waitFor":
			return step.timeoutMs ?? WAIT_FOR_MS;
	}
}

function checkLimits(steps: AgentStep[], pace: Pace) {
	if (steps.length === 0 || steps.length > AGENT_LIMITS.steps) {
		throw new Error(`perform takes 1 to ${AGENT_LIMITS.steps} steps.`);
	}
	steps.forEach((step, index) => {
		try {
			checkStep(step);
		} catch (error) {
			throw stepError(index, step, error);
		}
	});
	const glideMs = GLIDE_MAX_MS * pace.glide;
	const readMs = AUTO_SETTLE_MS + READ_HOLD_MS * pace.hold;
	const totalMs = steps.reduce(
		(sum, step, index) =>
			sum + stepBudgetMs(step, glideMs) + (readsAfter(steps, index) ? readMs : 0),
		0,
	);
	if (totalMs > AGENT_LIMITS.totalMs) {
		throw new Error(
			"A perform call may run at most 10 minutes. Split the demo into shorter scenes.",
		);
	}
}

const centreOf = (frame: AgentFrame): Point => ({
	x: frame.x + frame.width / 2,
	y: frame.y + frame.height / 2,
});

function readingOrder(a: AgentElement, b: AgentElement) {
	const rows = centreOf(a).y - centreOf(b).y;
	return Math.abs(rows) < Math.min(a.height, b.height) / 2 ? a.x - b.x : rows;
}

const isActionable = (element: AgentElement) => isActionableRole(element.role);

const sameFrame = (a?: AgentFrame, b?: AgentFrame) =>
	a === b ||
	(a !== undefined &&
		b !== undefined &&
		Math.abs(a.x - b.x) <= 1 &&
		Math.abs(a.y - b.y) <= 1 &&
		Math.abs(a.width - b.width) <= 1 &&
		Math.abs(a.height - b.height) <= 1);

function dedupe(elements: AgentElement[]) {
	const kept: AgentElement[] = [];
	for (const element of elements) {
		const twin = kept.findIndex(
			(other) => other.label === element.label && sameFrame(other, element),
		);
		if (twin < 0) kept.push(element);
		else if (isActionable(element) && !isActionable(kept[twin])) kept[twin] = element;
	}
	return kept;
}

type Ranked = { element: AgentElement; grade: number }[];
const BEST_GRADE = 10;
const ROLE_GRADE = 3;
const ROLE_ALIASES = new Map(Object.entries(AGENT_ROLE_ALIASES));

function wantedRoles(role?: string) {
	const query = role?.trim() ?? "";
	if (!query) return null;
	return ROLE_ALIASES.get(query.toLowerCase()) ?? [query];
}

const roleMatches = (role: string, wanted?: string) => wantedRoles(wanted)?.includes(role) === true;

const bestGrade = (role?: string) => (wantedRoles(role) ? BEST_GRADE : BEST_GRADE - ROLE_GRADE);

const normalizeLabel = (label: string) => label.trim().toLowerCase();

function rank(elements: AgentElement[], text: string, role?: string): Ranked {
	const unique = dedupe(elements);
	const web = unique.some((element) => element.web);
	const wanted = normalizeLabel(text);
	return unique
		.filter((element) => !web || element.web)
		.map((element) => ({
			element,
			grade:
				(normalizeLabel(element.label) === wanted ? 4 : 0) +
				(isActionable(element) ? 2 : 0) +
				(element.visible === false ? 0 : 1) +
				(roleMatches(element.role, role) ? ROLE_GRADE : 0),
		}))
		.sort((a, b) => b.grade - a.grade || readingOrder(a.element, b.element));
}

const describeTarget = ({ text, role }: { text?: string; role?: string }) =>
	text ? `"${text}"${role ? ` (${role})` : ""}` : `a ${role}`;

const stillMoving = (target: AgentTarget) =>
	`${describeTarget(target)} is in the window but kept moving, so the pointer never settled ` +
	"on it. The view is still animating: add a waitFor for it, or waitFor settled: true, before " +
	"this step, then try again.";

function matchLines(elements: AgentElement[], numbered: boolean) {
	return elements.slice(0, LISTED).map((element, index) => {
		const { x, y } = centreOf(element);
		const where =
			element.visible === false ? "off screen" : `at (${Math.round(x)}, ${Math.round(y)})`;
		const at = `"${element.label}" (${element.role}) ${where}`;
		return numbered ? `${index}: ${at}` : at;
	});
}

function listElements(elements: AgentElement[], numbered: boolean) {
	return matchLines(elements, numbered).join(", ") + (elements.length > LISTED ? ", …" : "");
}

function choose(ranked: Ranked, target: AgentTarget) {
	if (target.index !== undefined) return ranked[target.index]?.element;
	const tied = ranked.filter(({ grade }) => grade === ranked[0].grade).length;
	if (tied > 1) {
		throw new Error(
			`${tied} elements match ${describeTarget(target)} equally well. Add an index ` +
				`(0-based, best match first, then top to bottom): ` +
				`${listElements(
					ranked.map(({ element }) => element),
					true,
				)}.`,
		);
	}
	return ranked[0]?.element;
}

const isStrip = (element: AgentElement) => Math.min(element.width, element.height) <= 1;

function intersect(a: AgentFrame, b: AgentFrame): AgentFrame | null {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const width = Math.min(a.x + a.width, b.x + b.width) - x;
	const height = Math.min(a.y + a.height, b.y + b.height) - y;
	return width > 1 && height > 1 ? { x, y, width, height } : null;
}

function revealScroll(element: AgentElement, view: AgentFrame, contained: boolean) {
	const centre = centreOf(element);
	const strip = isStrip(element);
	const axis = (value: number, start: number, size: number, thin: boolean) => {
		const offset = value - (start + size / 2);
		const page = Math.sign(offset) * size * SCROLL_PAGE;
		const inset = Math.min(SCROLL_INSET, size / 4);
		if (value >= start && value < start + size) {
			const delta = thin ? page : 0;
			return {
				delta,
				at: clamp(
					value - Math.sign(delta) * SCROLL_INSET,
					start + inset,
					start + size - inset,
				),
			};
		}
		return {
			delta: strip ? page : clamp(offset, -size * SCROLL_REACH, size * SCROLL_REACH),
			at: contained ? clamp(value, start + inset, start + size - inset) : start + size / 2,
		};
	};
	const x = axis(centre.x, view.x, view.width, strip && element.width <= 1);
	const y = axis(centre.y, view.y, view.height, strip && element.height <= 1);
	if (x.delta === 0 && y.delta === 0) {
		y.delta = (centre.y < view.y + view.height / 2 ? -1 : 1) * view.height * SCROLL_PAGE;
	}
	return { at: { x: x.at, y: y.at }, dx: Math.round(x.delta), dy: Math.round(y.delta) };
}

function centringScroll(element: AgentElement, view: AgentFrame, axes: { x: boolean; y: boolean }) {
	const centre = centreOf(element);
	const axis = (value: number, start: number, size: number) => {
		const margin = size * CENTRE_MARGIN;
		const near = value < start + margin || value > start + size - margin;
		return near ? Math.round(value - (start + size / 2)) : 0;
	};
	return {
		at: centre,
		dx: axes.x ? axis(centre.x, view.x, view.width) : 0,
		dy: axes.y ? axis(centre.y, view.y, view.height) : 0,
	};
}

function bigrams(text: string) {
	const lower = text.toLowerCase();
	return Array.from({ length: Math.max(0, lower.length - 1) }, (_, index) =>
		lower.slice(index, index + 2),
	);
}

function similarity(a: string, b: string) {
	const left = bigrams(a);
	const right = bigrams(b);
	const total = left.length + right.length;
	let shared = 0;
	for (const pair of left) {
		const at = right.indexOf(pair);
		if (at >= 0) {
			shared += 1;
			right.splice(at, 1);
		}
	}
	return total === 0 ? 0 : (2 * shared) / total;
}

export function checkSafeRegion(region: AgentFrame | undefined, { x, y }: Point) {
	if (
		!region ||
		(x >= region.x &&
			y >= region.y &&
			x < region.x + region.width &&
			y < region.y + region.height)
	) {
		return;
	}
	throw new Error(
		`Point (${Math.round(x)}, ${Math.round(y)}) is outside the safe region (x ${region.x}, y ${region.y}, ` +
			`${region.width} × ${region.height} points, window-relative). Nothing was clicked. ` +
			"Take a fresh screenshot and re-aim, or widen safeRegion.",
	);
}

function checkSafeRegionShape(region: AgentFrame | undefined) {
	if (region === undefined) return;
	const { x, y, width, height } = region;
	if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
		throw new Error(
			"safeRegion needs numeric x, y, width and height, with a width and height above 0.",
		);
	}
}

function checkTargetsRequired(index: number, step: AgentStep) {
	if (step.action === "scroll") return;
	if (pointsOf(step).length === 0) return;
	throw stepError(
		index,
		step,
		"The input policy requires targets while recording, so a raw x/y coordinate is refused: " +
			"the view can scroll between steps and the point would land on a different control. " +
			'Aim with a target such as {text: "Save", role: "button"}, or turn the policy off with ' +
			"set_input_policy requireTargets false.",
	);
}

const undoChord = (name: string): { key: string; modifiers: AgentModifier[] } => ({
	key: "z",
	modifiers: [name === "darwin" ? "cmd" : "ctrl"],
});

export function createAgentControl(
	remote: Pick<RemoteControl, "getStatus" | "listSources" | "selectSource"> &
		Partial<Pick<RemoteControl, "setControlWindowProvider">>,
	overrides: Partial<AgentControlDeps> = {},
) {
	const deps = { ...defaultDeps(), ...overrides };
	const { input, platform } = deps;
	const webWindows = new Map<number, boolean>();
	let busy = false;
	let controlWindowId: number | null = null;
	remote.setControlWindowProvider?.(() => controlWindowId);
	let lastInput = 0;
	let policy: InputPolicy = { autoResumeAfterMs: 2000, onTakeover: "abort" };

	function toHelper(command: AgentCommand): AgentCommand {
		const point = platform.toHelperPoint;
		switch (command.cmd) {
			case "move":
			case "click":
			case "scroll":
			case "at":
				return { ...command, ...point(command) };
			case "drag": {
				const from = point({ x: command.fromX, y: command.fromY });
				const to = point({ x: command.toX, y: command.toY });
				return { ...command, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y };
			}
			case "raise":
			case "find":
				return { ...command, frame: platform.toHelperRect(command.frame) };
			case "set_bounds":
				return {
					...command,
					frame: platform.toHelperRect(command.frame),
					bounds: platform.toHelperRect(command.bounds),
				};
			default:
				return command;
		}
	}

	function fromHelper(cmd: AgentCommand["cmd"], result: unknown) {
		if (cmd === "cursor") return platform.fromHelperPoint(result as Point);
		if (cmd === "at") {
			const probed = result as AgentResults["at"];
			const back = (hit: AgentHit | null) =>
				hit ? { ...hit, ...platform.fromHelperRect(hit) } : null;
			return { hit: back(probed.hit), parent: back(probed.parent) };
		}
		if (cmd === "set_bounds") {
			const { frame } = result as AgentResults["set_bounds"];
			return frame ? { frame: platform.fromHelperRect(frame) } : {};
		}
		if (cmd !== "find") return result;
		const found = result as AgentResults["find"];
		return {
			...found,
			elements: found.elements.map(({ container, ...element }) => ({
				...element,
				...platform.fromHelperRect(element),
				...(container ? { container: platform.fromHelperRect(container) } : {}),
			})),
		};
	}

	const request: Post = async (command) =>
		fromHelper(command.cmd, await input.request(toHelper(command))) as never;

	async function exclusive<T>(run: () => Promise<T>) {
		if (busy) throw new Error("Another action is still running.");
		busy = true;
		try {
			return await run();
		} finally {
			busy = false;
		}
	}

	function toGlobal({ frame }: TargetWindow, { x, y }: { x: number; y: number }) {
		if (!(x >= 0 && y >= 0 && x < frame.width && y < frame.height)) {
			throw new Error(
				`Point (${x}, ${y}) is outside the selected window (${Math.round(frame.width)} × ` +
					`${Math.round(frame.height)} points). Use window-relative points from screenshot or find_elements.`,
			);
		}
		const point = { x: frame.x + x, y: frame.y + y };
		const onDisplay = deps
			.getDisplays()
			.some(
				(display) =>
					point.x >= display.x &&
					point.y >= display.y &&
					point.x < display.x + display.width &&
					point.y < display.y + display.height,
			);
		if (!onDisplay) {
			throw new Error(
				`Point (${x}, ${y}) is off screen. Move the window fully onto a display, then try again.`,
			);
		}
		return point;
	}

	function requireSupported() {
		const { supported, reason } = platform.support();
		if (!supported) throw new Error(reason);
	}

	async function controlSourceId() {
		if (controlWindowId !== null) return `window:${controlWindowId}:0`;
		const { window } = await request({ cmd: "frontmost_window" });
		const front =
			window && !platform.isOwnWindow(window)
				? ` The window in front is "${window.title}" (id window:${window.windowId}:0).`
				: "";
		throw new Error(
			"Choose the window for the mouse and keyboard first: open_url, or select_source with a " +
				`window id from list_sources. Recordly keeps recording the whole screen.${front}`,
		);
	}

	async function requireTarget(): Promise<TargetWindow> {
		const source = deps.getSelectedSource();
		const wholeScreen = platform.recordsScreen(source);
		const sourceId = wholeScreen ? await controlSourceId() : source?.id;
		const windowId = parseWindowId(sourceId);
		if (!sourceId || !windowId) throw new Error(NO_WINDOW);
		const found = await deps.findWindow(sourceId);
		if (!found?.frame) throw new Error(WINDOW_OFF_SCREEN_MESSAGE);
		const pid = found.pid ?? (wholeScreen ? undefined : source?.pid);
		if (!pid) {
			throw new Error(
				"Recordly could not tell which app owns the selected window. Call select_source again.",
			);
		}
		if (platform.isOwnWindow({ pid, windowId })) throw new Error(OWN_WINDOW);
		if (!wholeScreen) return { pid, windowId, frame: found.frame };
		const recorded = platform.recordedFrame(source);
		if (!intersect(recorded, found.frame)) throw new Error(OFF_RECORDED_DISPLAY);
		return { pid, windowId, frame: found.frame, recorded };
	}

	function targetOf(window: TargetWindow, at: Point, size?: { width: number; height: number }) {
		const frame = window.recorded ?? window.frame;
		const x = window.recorded ? window.frame.x + at.x - frame.x : at.x;
		const y = window.recorded ? window.frame.y + at.y - frame.y : at.y;
		return {
			cx: x / frame.width,
			cy: y / frame.height,
			...(size
				? { width: size.width / frame.width, height: size.height / frame.height }
				: {}),
		};
	}

	async function raise(target: TargetWindow) {
		await request({
			cmd: "raise",
			pid: target.pid,
			windowId: target.windowId,
			frame: target.frame,
		});
		await deps.sleep(SETTLE_MS);
	}

	async function requireFrontmost(target: TargetWindow) {
		const { window } = await request({ cmd: "frontmost_window" });
		if (window?.pid !== target.pid) {
			throw new Error(
				"Typing, keys and modifier clicks go only to the recorded window, and another app is in front of it now.",
			);
		}
	}

	async function logged<T>(
		run: Run,
		kind: AgentActivitySpanKind,
		action: AgentActivityAction,
		body: () => Promise<T>,
		target?: AgentActivityTarget,
	) {
		const end = beginSpan(kind, action, target);
		try {
			return await Promise.race([body(), run.aborted]);
		} finally {
			end();
		}
	}

	async function find(
		send: Post,
		window: TargetWindow,
		query: { text?: string; role?: string; offscreen?: boolean },
		limit: number,
	) {
		const { x, y } = window.frame;
		const { elements, truncated } = await send({
			cmd: "find",
			pid: window.pid,
			windowId: window.windowId,
			frame: window.frame,
			text: query.text,
			role: query.role,
			limit,
			offscreen: query.offscreen,
		}).catch((error: unknown) => {
			const off =
				platform.name === "linux" &&
				error instanceof Error &&
				error.message.includes("window not found in process");
			throw off ? new Error(LINUX_ACCESSIBILITY_OFF) : error;
		});
		if (elements.some((element) => element.web)) webWindows.set(window.windowId, true);
		return {
			elements: elements.map(({ container, ...element }) => ({
				...element,
				x: element.x - x,
				y: element.y - y,
				...(container
					? { container: { ...container, x: container.x - x, y: container.y - y } }
					: {}),
			})),
			truncated,
		};
	}

	async function isWebWindow(send: Post, window: TargetWindow) {
		if (!webWindows.has(window.windowId)) {
			const mac = platform.name === "darwin";
			const query = mac ? { role: "AXWebArea" } : {};
			const probed = await find(send, window, query, mac ? 1 : FIND_LIMIT).catch(() => null);
			const elements = probed?.elements ?? [];
			webWindows.set(
				window.windowId,
				mac ? elements.length > 0 : elements.some((element) => element.web),
			);
		}
		return webWindows.get(window.windowId) === true;
	}

	async function matchTarget(target: AgentTarget, window: TargetWindow, send: Post) {
		const query = { text: target.text };
		const shown = await find(send, window, query, TARGET_FIND_LIMIT);
		const first = rank(shown.elements, target.text, target.role);
		const top = first[target.index ?? 0];
		if (top?.grade === bestGrade(target.role) && top.element.web) return first;
		const all = await find(send, window, { ...query, offscreen: true }, TARGET_FIND_LIMIT);
		return rank([...shown.elements, ...all.elements], target.text, target.role);
	}

	async function nearest(target: AgentTarget, window: TargetWindow, run: Run) {
		const { elements } = await find(run.post, window, { text: target.text }, TARGET_FIND_LIMIT);
		try {
			return choose(rank(elements, target.text, target.role), target);
		} catch {
			return undefined;
		}
	}

	function checkDeadline(run: Run) {
		if (deps.now() >= run.deadline) throw new Error(LIMIT_PASSED);
	}

	async function scrollAt(
		run: Run,
		window: TargetWindow,
		{ at, dx, dy }: { at: Point; dx: number; dy: number },
	) {
		const point = toGlobal(window, at);
		await logged(
			run,
			"motion",
			"scroll",
			async () => {
				await run.post({ cmd: "scroll", ...point, ms: SCROLL_MS, dx, dy, modifiers: [] });
				await deps.sleep(SETTLE_MS);
			},
			targetOf(window, at),
		);
	}

	async function notFound(
		target: AgentTarget,
		ranked: Ranked,
		window: TargetWindow,
		run: Run,
		outcome = `was not found in the window within ${TARGET_WAIT_MS / 1000} s`,
	) {
		if (ranked.length > 0) {
			return new Error(
				`Only ${ranked.length} element${ranked.length === 1 ? " matches" : "s match"} ` +
					`${describeTarget(target)}, so index ${target.index} is not found: ` +
					`${listElements(
						ranked.map(({ element }) => element),
						true,
					)}.`,
			);
		}
		const { elements } = await find(run.post, window, {}, TARGET_FIND_LIMIT);
		const nearest = elements
			.filter((element) => element.label)
			.map((element) => ({ element, score: similarity(target.text, element.label) }))
			.sort((a, b) => b.score - a.score)
			.map(({ element }) => element);
		return new Error(
			`${describeTarget(target)} ${outcome}. ` +
				(nearest.length > 0
					? `Nearest visible labels: ${listElements(nearest, false)}.`
					: "No labelled controls are visible."),
		);
	}

	async function pageSignature(send: Post, window: TargetWindow) {
		const { elements } = await find(send, window, {}, FIND_LIMIT);
		return signatureOf(elements);
	}

	async function settle(target: AgentTarget, found: Resolved, run: Run): Promise<Resolved> {
		const deadline = deps.now() + STABLE_WAIT_MS;
		const endWait = beginSpan("wait", "wait");
		try {
			let last = found;
			for (;;) {
				await Promise.race([deps.sleep(STABLE_SAMPLE_MS), run.aborted]);
				const window = await requireTarget();
				const element = await Promise.race([nearest(target, window, run), run.aborted]);
				if (!element) return last;
				const next = { ...last, element, frame: window.frame };
				if (sameFrame(last.element, element) && sameFrame(last.frame, window.frame)) {
					return next;
				}
				if (deps.now() >= deadline) return next;
				last = next;
			}
		} finally {
			endWait();
		}
	}

	function covers(hit: AgentFrame, element: AgentFrame) {
		const shared = intersect(hit, element);
		const smallest = Math.min(hit.width * hit.height, element.width * element.height);
		return shared !== null && smallest > 0
			? shared.width * shared.height >= HIT_OVERLAP * smallest
			: false;
	}

	function hitFits(hit: AgentHit | null, element: AgentElement, role?: string) {
		if (!hit) return false;
		const named =
			normalizeLabel(hit.label) === normalizeLabel(element.label) &&
			(hit.role === element.role || roleMatches(hit.role, role));
		return named || covers(hit, element);
	}

	async function blocker(
		target: AgentTarget,
		element: AgentElement,
		window: TargetWindow,
		at: Point,
		run: Run,
	) {
		const probed = await run
			.post({ cmd: "at", pid: window.pid, ...at })
			.catch(() => null as AgentResults["at"] | null);
		if (!probed?.hit) return null;
		const global = {
			...element,
			x: element.x + window.frame.x,
			y: element.y + window.frame.y,
		};
		if (
			hitFits(probed.hit, global, target.role) ||
			hitFits(probed.parent, global, target.role)
		) {
			return null;
		}
		return `"${probed.hit.label}" (${probed.hit.role})`;
	}

	async function aimAt(
		target: AgentTarget,
		start: Point,
		run: Run,
		approach?: (to: Point) => Promise<void>,
	): Promise<Aimed> {
		const deadline = deps.now() + TARGET_WAIT_MS;
		let at = start;
		let seen = false;
		for (let attempt = 1; ; attempt += 1) {
			const window = await requireTarget();
			const fresh = await Promise.race([nearest(target, window, run), run.aborted]);
			let aimed: Aimed | null = null;
			if (fresh) {
				seen = true;
				const centre = toGlobal(window, centreOf(fresh));
				const delta = Math.hypot(centre.x - at.x, centre.y - at.y);
				const reach = Math.max(AIM_NUDGE_PT, Math.min(fresh.width, fresh.height) / 2);
				if (delta <= AIM_SETTLED_PT) aimed = { at, ms: 0 };
				else if (delta <= reach) {
					checkSafeRegion(run.safeRegion, centreOf(fresh));
					aimed = { at: centre, ms: AIM_NUDGE_MS };
				}
			}
			if (aimed && fresh) {
				const covered = await blocker(target, fresh, window, aimed.at, run);
				if (!covered) return aimed;
				if (attempt > 1) {
					throw new Error(
						`${describeTarget(target)} is at (${Math.round(aimed.at.x)}, ` +
							`${Math.round(aimed.at.y)}), but the point is covered by ${covered}. ` +
							"Dismiss it, or aim at another element.",
					);
				}
			} else if (attempt >= AIM_TRIES || deps.now() >= deadline) {
				if (seen) throw new Error(stillMoving(target));
				throw await notFound(target, [], window, run);
			}
			const again = await resolveTarget(target, run);
			checkSafeRegion(run.safeRegion, centreOf(again.element));
			at = toGlobal(await requireTarget(), centreOf(again.element));
			await approach?.(at);
		}
	}

	async function resolveTarget(target: AgentTarget, run: Run): Promise<Resolved> {
		const deadline = deps.now() + TARGET_WAIT_MS;
		let scrolls = 0;
		let stalls = 0;
		let centred = false;
		let view: AgentFrame | null = null;
		const axes = { x: false, y: false };
		let last: { element: AgentElement; page: string } | null = null;
		let endWait: (() => void) | null = null;
		try {
			for (;;) {
				checkDeadline(run);
				const window = await requireTarget();
				const ranked = await Promise.race([
					matchTarget(target, window, run.post),
					run.aborted,
				]);
				const element = choose(ranked, target);
				if (element) {
					endWait?.();
					endWait = null;
				}
				if (element && element.visible !== false) {
					const centring = view && !centred ? centringScroll(element, view, axes) : null;
					if (centring && (centring.dx !== 0 || centring.dy !== 0)) {
						centred = true;
						await scrollAt(run, window, centring);
						continue;
					}
					return settle(
						target,
						{ element, frame: window.frame, scrolled: scrolls > 0 },
						run,
					);
				}
				if (element) {
					const page = isStrip(element) ? await pageSignature(run.post, window) : "";
					if (last) {
						const moved = isStrip(element)
							? sameFrame(last.element, element) && page !== last.page
							: !sameFrame(last.element, element) ||
								!sameFrame(last.element.container, element.container);
						if (!moved) stalls += 1;
					}
					if (stalls === TARGET_STALLS || scrolls === TARGET_SCROLLS) {
						throw new Error(
							`${describeTarget(target)} is hidden inside a section that scrolling doesn't ` +
								"reveal (a closed menu or panel?). Open it first, then try again.",
						);
					}
					last = { element, page };
					const frame = {
						x: 0,
						y: 0,
						width: window.frame.width,
						height: window.frame.height,
					};
					const contained = element.container && intersect(element.container, frame);
					view = contained || frame;
					const reveal = revealScroll(element, view, Boolean(contained));
					axes.x ||= reveal.dx !== 0;
					axes.y ||= reveal.dy !== 0;
					await scrollAt(run, window, reveal);
					scrolls += 1;
					continue;
				}
				if (deps.now() >= deadline) throw await notFound(target, ranked, window, run);
				endWait ??= beginSpan("wait", "wait");
				await Promise.race([deps.sleep(POLL_MS), run.aborted]);
			}
		} finally {
			endWait?.();
		}
	}

	async function locate({ x, y, target }: Spot, run: Run) {
		if (!target) return { point: { x: Number(x), y: Number(y) } };
		const { element, scrolled } = await resolveTarget(target, run);
		return {
			point: centreOf(element),
			size: { width: element.width, height: element.height },
			scrolled,
		};
	}

	async function glideMs(durationMs: number | undefined, to: Point, run: Run) {
		if (durationMs !== undefined) return durationMs;
		const from = await run.post({ cmd: "cursor" });
		return pacedGlideMs(Math.hypot(to.x - from.x, to.y - from.y), run.pace);
	}

	async function runPointer(step: PointerStep, run: Run) {
		const spots = spotsOf(step);
		const located: Awaited<ReturnType<typeof locate>>[] = [];
		for (const spot of spots) located.push(await locate(spot, run));
		if (located[1]?.scrolled) {
			located[0] = await locate(spots[0], run);
			if (located[0].scrolled) {
				throw new Error(
					"The drag's start and end are not on screen together. Drag between points that are both visible.",
				);
			}
		}
		const window = await requireTarget();
		if (step.action !== "scroll") {
			for (const each of located) checkSafeRegion(run.safeRegion, each.point);
		}
		const [point, end] = located.map((each) => toGlobal(window, each.point));
		const last = located[located.length - 1];
		const target = targetOf(window, last.point, last.size);
		switch (step.action) {
			case "move": {
				const ms = await glideMs(step.durationMs, point, run);
				return logged(
					run,
					"motion",
					"move",
					() => run.post({ cmd: "move", ...point, ms }),
					target,
				);
			}
			case "click": {
				const press = (at: Point, ms: number) =>
					run.post({
						cmd: "click",
						...at,
						ms,
						button: step.button ?? "left",
						count: step.count ?? 1,
						modifiers: normalizeModifiers(step.modifiers),
					});
				const aim = spots[0].target;
				if (!aim) {
					const ms = await glideMs(step.durationMs, point, run);
					return logged(run, "motion", "click", () => press(point, ms), target);
				}
				const glide = async (to: Point) =>
					void (await run.post({
						cmd: "move",
						...to,
						ms: await glideMs(step.durationMs, to, run),
					}));
				return logged(
					run,
					"motion",
					"click",
					async () => {
						await glide(point);
						const fix = await aimAt(aim, point, run, glide);
						await press(fix.at, fix.ms);
					},
					target,
				);
			}
			case "drag": {
				const from = spots[0].target
					? (await aimAt(spots[0].target, point, run)).at
					: point;
				const to = spots[1].target ? (await aimAt(spots[1].target, end, run)).at : end;
				const ms =
					step.durationMs ??
					pacedGlideMs(Math.hypot(to.x - from.x, to.y - from.y), run.pace);
				return logged(
					run,
					"motion",
					"drag",
					() =>
						run.post({
							cmd: "drag",
							fromX: from.x,
							fromY: from.y,
							toX: to.x,
							toY: to.y,
							ms,
							button: step.button ?? "left",
							modifiers: normalizeModifiers(step.modifiers),
						}),
					target,
				);
			}
			case "scroll":
				return logged(
					run,
					"motion",
					"scroll",
					() =>
						run.post({
							cmd: "scroll",
							...point,
							ms: SCROLL_MS,
							dx: step.deltaX ?? 0,
							dy: step.deltaY,
							modifiers: normalizeModifiers(step.modifiers),
						}),
					target,
				);
		}
	}

	async function present(
		send: Post,
		window: TargetWindow,
		query: { text?: string; role?: string },
	) {
		const { elements } = await find(send, window, query, TARGET_FIND_LIMIT);
		const matches = dedupe(elements);
		if (!query.text || matches.length === 0 || !(await isWebWindow(send, window)))
			return matches;
		return matches.filter((element) => element.web);
	}

	async function waitFor(step: Extract<AgentStep, { action: "waitFor" }>, run: Run) {
		const timeoutMs = step.timeoutMs ?? WAIT_FOR_MS;
		if (step.settled) {
			const { frame } = await requireTarget();
			await deps.waitForStill(frame, { timeoutMs, signal: run.signal });
			return;
		}
		const deadline = deps.now() + timeoutMs;
		const query = { text: step.text, role: step.role };
		for (;;) {
			const matches = await present(run.post, await requireTarget(), query);
			if (matches.length > 0 !== Boolean(step.gone)) return;
			checkDeadline(run);
			if (deps.now() >= deadline) {
				throw new Error(
					step.gone
						? `${describeTarget(query)} was still visible after ${timeoutMs / 1000} s.`
						: `${describeTarget(query)} did not appear within ${timeoutMs / 1000} s.`,
				);
			}
			await deps.sleep(POLL_MS);
		}
	}

	// One look, no scrolling and no waiting: a page that has diverged should stop the run now.
	async function expectTarget(step: Extract<AgentStep, { action: "expect" }>, run: Run) {
		const { target } = step;
		const wantVisible = step.visible !== false;
		const window = await requireTarget();
		const all = await Promise.race([matchTarget(target, window, run.post), run.aborted]);
		const ranked = all.filter(({ element }) => element.visible !== false);
		const found = ranked.length > (target.index ?? 0);
		if (found === wantVisible) return;
		if (!wantVisible) {
			throw new Error(
				`${describeTarget(target)} is on screen, but the step expected it to be absent.`,
			);
		}
		if (all.length > (target.index ?? 0)) {
			throw new Error(
				`${describeTarget(target)} is in the window but off screen, so this step cannot ` +
					"act on it. Scroll it into view first, or wait for it with waitFor.",
			);
		}
		throw await notFound(target, ranked, window, run, "is not in the window");
	}

	async function runStep(step: AgentStep, run: Run) {
		if (needsFrontmost(step)) await requireFrontmost(run.start);
		switch (step.action) {
			case "wait":
			case "hold":
				return logged(run, "hold", "wait", () => deps.sleep(step.ms));
			case "expect":
				return expectTarget(step, run);
			case "waitFor":
				return logged(run, "wait", "wait", () => waitFor(step, run));
			case "type":
				if (step.into) await runPointer({ action: "click", target: step.into }, run);
				return logged(run, "motion", "type", () =>
					run.post({ cmd: "type", text: step.text, cps: TYPE_CPS }),
				);
			case "key":
				return logged(run, "motion", "key", () =>
					run.post({
						cmd: "key",
						key: normalizeKey(step.key),
						modifiers: normalizeModifiers(step.modifiers),
						repeat: step.repeat ?? 1,
					}),
				);
			default:
				return runPointer(step, run);
		}
	}

	async function readResult(run: Run) {
		const settle = async () => {
			const { frame } = await requireTarget();
			await deps.waitForStill(frame, {
				timeoutMs: AUTO_SETTLE_MS,
				quietMs: AUTO_QUIET_MS,
				signal: run.signal,
			});
		};
		await logged(run, "wait", "wait", () => settle().catch(() => undefined));
		await logged(run, "hold", "wait", () => deps.sleep(READ_HOLD_MS * run.pace.hold));
	}

	async function preflightInput() {
		requireSupported();
		const { postEvents } = await request({ cmd: "preflight" });
		if (!postEvents) {
			throw new Error(platform.name === "darwin" ? POST_EVENTS_MISSING : INPUT_UNAVAILABLE);
		}
	}

	async function runSteps(
		steps: AgentStep[],
		pace: Pace,
		deadline: number,
		safeRegion?: AgentFrame,
	) {
		await preflightInput();
		const start = await requireTarget();
		steps.forEach((step, index) => {
			try {
				for (const point of pointsOf(step)) {
					toGlobal(start, point);
					if (step.action !== "scroll") checkSafeRegion(safeRegion, point);
				}
			} catch (error) {
				throw stepError(index, step, error);
			}
		});
		const { window: front } = await request({ cmd: "frontmost_window" });
		if (front?.pid !== start.pid || front.windowId !== start.windowId) {
			const endRaise = beginSpan("wait", "raise");
			try {
				await raise(start);
			} finally {
				endRaise();
			}
			const { window } = await request({ cmd: "frontmost_window" });
			if (window?.pid !== start.pid) {
				throw new Error("Recordly couldn't bring the window to the front.");
			}
		}
		let stopped = false;
		let tookOver = false;
		let paused = false;
		let cause: string | undefined;
		const mode = { ...policy };
		let controller = new AbortController();
		const takeover = () =>
			new Error(
				cause ? `${TAKEOVER_MESSAGE} Recordly noticed that ${cause}.` : TAKEOVER_MESSAGE,
			);
		let abort!: () => void;
		const freshAbort = () => {
			const promise = new Promise<never>((_, reject) => {
				abort = () => reject(takeover());
			});
			promise.catch(() => undefined);
			return promise;
		};
		const onUserInput = (event: AgentEvent) => {
			lastInput = deps.now();
			if (mode.onTakeover === "pause" && !event.escape && !tookOver) {
				if (paused) return;
				paused = true;
			} else {
				if (!tookOver)
					cause = event.escape ? "Esc was pressed" : TAKEOVER_CAUSES[event.kind];
				tookOver = true;
			}
			stopped = true;
			abort();
			controller.abort();
		};
		const post: Post = (command) => {
			if (stopped) return Promise.reject(takeover());
			return request(command);
		};
		const run: Run = {
			start,
			post,
			pace,
			aborted: freshAbort(),
			signal: controller.signal,
			deadline,
			safeRegion,
		};
		const armHelper = () =>
			request(
				mode.tolerancePx === undefined
					? { cmd: "arm" }
					: { cmd: "arm", tolerancePx: mode.tolerancePx },
			);
		const resume = async () => {
			const endPause = beginSpan("wait", "wait");
			try {
				for (;;) {
					if (tookOver) throw takeover();
					checkDeadline(run);
					const quiet = deps.now() - lastInput;
					if (quiet >= mode.autoResumeAfterMs) break;
					await deps.sleep(Math.min(POLL_MS, mode.autoResumeAfterMs - quiet));
				}
				await armHelper();
				if (tookOver) throw takeover();
			} finally {
				endPause();
			}
			paused = false;
			stopped = false;
			controller = new AbortController();
			run.signal = controller.signal;
			run.aborted = freshAbort();
		};
		let armed = false;
		deps.setHudPassthrough(true);
		input.events.on("user-input", onUserInput);
		try {
			await armHelper();
			armed = true;
			for (const [index, step] of steps.entries()) {
				for (;;) {
					try {
						if (stopped) throw takeover();
						checkDeadline(run);
						await Promise.race([runStep(step, run), run.aborted]);
						if (readsAfter(steps, index)) {
							await Promise.race([readResult(run), run.aborted]);
						}
						break;
					} catch (error) {
						const userInput = error instanceof Error && error.message === "user-input";
						if (userInput && mode.onTakeover === "pause" && !paused && !tookOver) {
							lastInput = deps.now();
							paused = true;
							stopped = true;
						}
						if (paused && !tookOver) {
							try {
								await resume();
							} catch (resumeError) {
								throw stepError(index, step, resumeError);
							}
							continue;
						}
						throw stepError(index, step, tookOver || userInput ? takeover() : error);
					}
				}
			}
		} finally {
			stopped = true;
			controller.abort();
			input.events.off("user-input", onUserInput);
			if (armed) await request({ cmd: "disarm" }).catch(() => undefined);
			deps.setHudPassthrough(false);
		}
	}

	async function probeTarget(target: AgentTarget, window: TargetWindow): Promise<Probe> {
		const ranked = await matchTarget(target, window, request);
		const candidates = ranked.length;
		let element: AgentElement | undefined;
		try {
			element = choose(ranked, target);
		} catch {
			return {
				found: false,
				ambiguous: true,
				candidates,
				matches: matchLines(
					ranked.map(({ element: match }) => match),
					true,
				),
			};
		}
		if (!element) return { found: false, ambiguous: false, candidates };
		if (element.visible === false) return { found: true, label: element.label, candidates };
		const { x, y } = centreOf(element);
		return {
			found: true,
			label: element.label,
			x: Math.round(x),
			y: Math.round(y),
			candidates,
		};
	}

	async function probe(
		step: AgentStep,
		window: TargetWindow,
		safeRegion?: AgentFrame,
	): Promise<Probe> {
		if (step.action === "waitFor") {
			if (step.settled) return { found: true };
			const query = { text: step.text, role: step.role };
			const matches = await present(request, window, query);
			return { found: matches.length > 0, candidates: matches.length };
		}
		let probed: Probe = { found: true };
		for (const { x, y, target } of spotsOf(step)) {
			if (target) {
				probed = await probeTarget(target, window);
				if (!probed.found) return probed;
			} else {
				const point = { x: Number(x), y: Number(y) };
				toGlobal(window, point);
				if (step.action !== "scroll") checkSafeRegion(safeRegion, point);
				probed = { found: true, ...point };
			}
		}
		return probed;
	}

	async function dryRun(steps: AgentStep[], safeRegion?: AgentFrame) {
		requireSupported();
		const window = await requireTarget();
		const report: AgentDryRunStep[] = [];
		let live = false;
		for (const [index, step] of steps.entries()) {
			if (live) {
				report.push({
					index: index + 1,
					action: step.action,
					found: null,
					note: RUN_TIME_NOTE,
				});
				continue;
			}
			try {
				report.push({
					index: index + 1,
					action: step.action,
					...(await probe(step, window, safeRegion)),
				});
			} catch (error) {
				throw stepError(index, step, error);
			}
			live = changesPage(step);
		}
		return { dryRun: report, page: await pageSignature(request, window) };
	}

	async function perform(steps: AgentStep[], options: PerformOptions = {}) {
		const pace = PACES.get(options.pace ?? "normal");
		if (!pace) throw new Error('pace must be "brisk", "normal" or "relaxed".');
		if (options.then !== undefined && options.then !== "elements") {
			throw new Error('then must be "elements".');
		}
		checkSafeRegionShape(options.safeRegion);
		checkLimits(steps, pace);
		if (policy.requireTargets && getAgentActivityMs() !== null) {
			steps.forEach((step, index) => checkTargetsRequired(index, step));
		}
		const safeRegion = options.safeRegion ?? policy.safeRegion ?? undefined;
		return exclusive(async () => {
			const startedAt = deps.now();
			const result: PerformResult = { performed: 0, durationMs: 0 };
			if (options.dryRun) {
				Object.assign(result, await dryRun(steps, safeRegion));
			} else {
				const endScene = beginScene(options.title);
				try {
					await runSteps(steps, pace, startedAt + AGENT_LIMITS.totalMs, safeRegion);
					endScene(false);
				} catch (error) {
					endScene(true);
					throw error;
				}
				result.performed = steps.length;
			}
			result.durationMs = Math.round(deps.now() - startedAt);
			if (options.then === "elements") {
				const listed = await listControls();
				result.elements = listed.elements;
				result.page = signatureOf(listed.elements);
			}
			return result;
		});
	}

	async function listControls(query: { text?: string; role?: string } = {}, limit = FIND_LIMIT) {
		requireSupported();
		const { elements, truncated } = await find(request, await requireTarget(), query, limit);
		return {
			elements: elements.map(({ role, label, x, y, width, height }) => ({
				role,
				label,
				x,
				y,
				width,
				height,
			})),
			truncated,
		};
	}

	async function findElements({
		text,
		role,
		limit,
	}: {
		text?: string;
		role?: string;
		limit?: number;
	}) {
		return listControls({ text, role }, limit);
	}

	async function screenshot(
		region?: WindowBounds,
		of: AgentShotScope = "window",
	): Promise<AgentShot> {
		if (of !== "window" && of !== "display") {
			throw new Error('screenshot of must be "window" or "display".');
		}
		requireSupported();
		if (of === "window") {
			const target = await requireTarget();
			await raise(target).catch(() => undefined);
			return { ...(await deps.capture(target.frame, region)), scope: of };
		}
		const source = deps.getSelectedSource();
		if (!platform.recordsScreen(source)) throw new Error(DISPLAY_SHOT_NEEDS_SCREEN);
		const display = platform.recordedFrame(source);
		const found =
			controlWindowId === null ? null : await deps.findWindow(`window:${controlWindowId}:0`);
		const frame = found?.frame && intersect(display, found.frame) ? found.frame : null;
		const shot = await deps.capture(display, region);
		if (!frame) {
			return {
				...shot,
				scope: of,
				note: controlWindowId === null ? DISPLAY_SHOT_NO_CONTROL : DISPLAY_SHOT_WINDOW_LOST,
			};
		}
		return {
			...shot,
			scope: of,
			window: {
				x: frame.x - display.x,
				y: frame.y - display.y,
				width: frame.width,
				height: frame.height,
			},
			note: DISPLAY_SHOT_NOTE,
		};
	}

	async function selectControlWindow(id: string) {
		const windowId = parseWindowId(id) ?? (/^\d+$/.test(id) ? Number(id) : null);
		if (!windowId) throw new Error(NO_WINDOW);
		const found = await deps.findWindow(`window:${windowId}:0`);
		if (!found?.frame) throw new Error(WINDOW_OFF_SCREEN_MESSAGE);
		if (platform.isOwnWindow({ pid: found.pid, windowId })) throw new Error(OWN_WINDOW);
		controlWindowId = windowId;
		const recorded = platform.recordedFrame(deps.getSelectedSource());
		const framed =
			recorded.width > 0 && recorded.height > 0
				? markCameraTarget({
						x: (found.frame.x - recorded.x) / recorded.width,
						y: (found.frame.y - recorded.y) / recorded.height,
						width: found.frame.width / recorded.width,
						height: found.frame.height / recorded.height,
					})
				: false;
		return {
			id: `window:${windowId}:0`,
			type: "window",
			control: true,
			note: framed
				? "The mouse and keyboard act on this window, Recordly keeps recording the whole " +
					"screen, and the video glides to frame this window from here on."
				: "The mouse and keyboard act on this window; Recordly records the whole screen.",
		};
	}

	async function selectWindow(windowId: number) {
		if (platform.recordsScreen(deps.getSelectedSource())) {
			return selectControlWindow(String(windowId));
		}
		const listed = await remote.listSources();
		const match = listed.find((source) => parseWindowId(source.id) === windowId);
		if (!match) throw new Error(BROWSER_NOT_FOUND);
		return remote.selectSource({ id: match.id });
	}

	async function openUrl(url: string) {
		requireSupported();
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new Error("Pass a full http(s) URL, e.g. https://example.com.");
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error(`Only http and https URLs can be opened, not ${parsed.protocol}`);
		}
		if (remote.getStatus().state !== "idle") {
			throw new Error(
				"open_url cannot switch windows while recording. Navigate inside the page with perform instead.",
			);
		}
		return exclusive(() => openInBrowser(parsed.href));
	}

	async function openInBrowser(url: string) {
		const browser = deps.getBrowserName(url);
		const isBrowser = (window: AgentWindow | null): window is AgentWindow =>
			window !== null &&
			!platform.isOwnWindow(window) &&
			(normalizeAppName(browser)
				? platform.sameApp(browser, window.appName)
				: isKnownBrowser(window.bundleId));
		await deps.openExternal(url);
		let candidate: number | null = null;
		for (let waited = 0; waited < OPEN_URL_WAIT_MS; waited += POLL_MS) {
			await deps.sleep(POLL_MS);
			const { window } = await request({ cmd: "frontmost_window" });
			if (isBrowser(window) && window.windowId === candidate) {
				return { url, source: await selectWindow(window.windowId) };
			}
			candidate = isBrowser(window) ? window.windowId : null;
		}
		throw new Error(BROWSER_NOT_FOUND);
	}

	// Only observed while the helper is armed — the OS is not polled when control is off.
	function lastInputAt() {
		return lastInput;
	}

	async function selectFrontWindow(app?: string) {
		const wanted = (window: AgentWindow | null): window is AgentWindow =>
			window !== null &&
			!platform.isOwnWindow(window) &&
			(normalizeAppName(app ?? "") ? platform.sameApp(app as string, window.appName) : true);
		let candidate: number | null = null;
		for (let waited = 0; waited < OPEN_URL_WAIT_MS; waited += POLL_MS) {
			await deps.sleep(POLL_MS);
			const { window } = await request({ cmd: "frontmost_window" });
			if (wanted(window) && window.windowId === candidate) {
				return await selectWindow(window.windowId);
			}
			candidate = wanted(window) ? window.windowId : null;
		}
		throw new Error(
			app
				? `${app} did not open a window in time. Call list_sources, then select_source.`
				: "No window appeared in time. Call list_sources, then select_source.",
		);
	}

	async function chooseWindow(id: string) {
		requireSupported();
		if (!platform.recordsScreen(deps.getSelectedSource())) {
			throw new Error(CONTROL_NEEDS_SCREEN);
		}
		return selectControlWindow(id);
	}

	function setInputPolicy(next: Partial<InputPolicy>) {
		checkSafeRegionShape(next.safeRegion ?? undefined);
		policy = {
			...policy,
			...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)),
		};
		return policy;
	}

	async function windowFor(source?: string): Promise<TargetWindow> {
		if (source === undefined) return requireTarget();
		const windowId = parseWindowId(source) ?? (/^\d+$/.test(source) ? Number(source) : null);
		if (!windowId) throw new Error(NO_WINDOW);
		const found = await deps.findWindow(`window:${windowId}:0`);
		if (!found?.frame) throw new Error(WINDOW_OFF_SCREEN_MESSAGE);
		if (!found.pid) {
			throw new Error(
				"Recordly could not tell which app owns that window. Check the id with list_sources.",
			);
		}
		if (platform.isOwnWindow({ pid: found.pid, windowId })) throw new Error(OWN_WINDOW);
		return { pid: found.pid, windowId, frame: found.frame };
	}

	// Bounds are screen points, the same space as a window's frame; the platform layer converts
	// them (Windows: physical pixels) on the way to the helper.
	async function setWindowBounds(args: {
		source?: string;
		x: number;
		y: number;
		width: number;
		height: number;
		raise?: boolean;
	}) {
		requireSupported();
		const { x, y, width, height } = args;
		if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) {
			throw new Error(
				"set_window_bounds needs numeric x, y, width and height, with width and height of at least 1.",
			);
		}
		const bounds = { x, y, width, height };
		if (!deps.getDisplays().some((display) => intersect(display, bounds))) {
			throw new Error(
				`The rectangle (x ${x}, y ${y}, ${width} × ${height}) is not on any display, so the window would be unreachable. Pick a rectangle that overlaps a display.`,
			);
		}
		return exclusive(async () => {
			const target = await windowFor(args.source);
			const { frame } = await request({
				cmd: "set_bounds",
				pid: target.pid,
				windowId: target.windowId,
				frame: target.frame,
				bounds,
			});
			const applied = frame ?? bounds;
			const raiseFailed = args.raise
				? await raise({ ...target, frame: applied }).then(
						() => null,
						(error: unknown) =>
							error instanceof Error ? error.message : String(error),
					)
				: null;
			const adjusted = [
				applied.x - x,
				applied.y - y,
				applied.width - width,
				applied.height - height,
			].some((delta) => Math.abs(delta) > 2);
			const note = [
				frame
					? undefined
					: "Recordly could not read the window's rectangle back, so frame is the one it asked for, not a measured result.",
				adjusted
					? "The app or window manager adjusted the rectangle (minimum size or screen edge); frame is what it ended up as."
					: undefined,
				raiseFailed
					? `The window was moved, but bringing it to the front failed: ${raiseFailed}`
					: undefined,
			].filter(Boolean);
			return {
				windowId: target.windowId,
				frame: applied,
				adjusted,
				...(note.length > 0 ? { note: note.join(" ") } : {}),
			};
		});
	}

	async function undoLastInput() {
		await preflightInput();
		return exclusive(async () => {
			const { window } = await request({ cmd: "frontmost_window" });
			if (window && platform.isOwnWindow(window)) {
				throw new Error(
					"Recordly's own window has focus, so the undo would go to Recordly instead of the " +
						"app being demoed. Bring that app to the front (select_source, or screenshot " +
						"to check) and try again.",
				);
			}
			const { key, modifiers } = undoChord(platform.name);
			await request({ cmd: "key", key, modifiers, repeat: 1 });
			return {
				sent: modifiers[0] === "cmd" ? "Cmd+Z" : "Ctrl+Z",
				app: window?.appName ?? null,
				note: UNDO_NOTE,
			};
		});
	}

	return {
		preflightInput,
		lastInputAt,
		selectFrontWindow,
		setWindowBounds,
		undoLastInput,
		setInputPolicy,
		perform,
		findElements,
		screenshot,
		openUrl,
		chooseWindow,
	};
}

export type AgentControl = ReturnType<typeof createAgentControl>;
