import { app, BrowserWindow } from "electron";
import { findNativeMacWindow, getWindowBoundsFromNativeSource } from "../ipc/cursor/bounds";
import { isLikelyLinuxWaylandSession } from "../ipc/register/sourceMapping";
import type { SelectedSource, WindowBounds } from "../ipc/types";
import { getScreen, parseWindowId } from "../ipc/utils";
import { agentInput } from "./agentInput";
import type { AgentWindowInfo } from "./agentProtocol";

type Point = { x: number; y: number };
type ScreenApi = Pick<
	Electron.Screen,
	| "getAllDisplays"
	| "getPrimaryDisplay"
	| "getDisplayNearestPoint"
	| "dipToScreenPoint"
	| "screenToDipPoint"
	| "dipToScreenRect"
	| "screenToDipRect"
>;

export type AgentSupport = { supported: boolean; reason?: string };
export type AgentWindowTarget = { pid?: number; windowId: number; frame: WindowBounds };
export type AgentConversions = {
	toHelperPoint: (point: Point) => Point;
	fromHelperPoint: (point: Point) => Point;
	toHelperRect: (rect: WindowBounds) => WindowBounds;
	fromHelperRect: (rect: WindowBounds) => WindowBounds;
};

export const X11_REQUIRED =
	"Mouse and keyboard control needs an X11 session on Linux; Wayland is not supported yet.";
const UNSUPPORTED = "Mouse and keyboard control is not available on this system.";

const ACTIONABLE_ROLES = new Set([
	"AXButton",
	"AXMenuButton",
	"AXLink",
	"AXTextField",
	"AXTextArea",
	"AXComboBox",
	"AXCheckBox",
	"AXRadioButton",
	"AXMenuItem",
	"AXPopUpButton",
	"AXTabButton",
	"Button",
	"SplitButton",
	"Hyperlink",
	"Edit",
	"ComboBox",
	"CheckBox",
	"RadioButton",
	"TabItem",
	"MenuItem",
	"ListItem",
	"TreeItem",
	"Slider",
]);

export const isActionableRole = (role: string) => ACTIONABLE_ROLES.has(role);

export type AgentPlatformDeps = {
	platform: NodeJS.Platform;
	env: NodeJS.ProcessEnv;
	ozonePlatform: () => string;
	ownPid: number;
	ownWindowIds: () => Array<number | null>;
	screen: () => ScreenApi;
	findMacWindow: (
		sourceId: string,
	) => Promise<{ pid?: number; frame: WindowBounds | null } | null>;
	windowInfo: (windowId: number) => Promise<AgentWindowInfo | null>;
};

const defaultDeps = (): AgentPlatformDeps => ({
	platform: process.platform,
	env: process.env,
	ozonePlatform: () => app.commandLine.getSwitchValue("ozone-platform"),
	ownPid: process.pid,
	ownWindowIds: () =>
		BrowserWindow.getAllWindows().map((window) => parseWindowId(window.getMediaSourceId())),
	screen: () => getScreen(),
	findMacWindow: async (sourceId) => {
		const entry = await findNativeMacWindow(sourceId, { maxAgeMs: 250 });
		return entry && { pid: entry.pid, frame: getWindowBoundsFromNativeSource(entry) };
	},
	windowInfo: async (windowId) =>
		(await agentInput.request({ cmd: "window_info", windowId })).window,
});

const IDENTITY: AgentConversions = {
	toHelperPoint: (point) => point,
	fromHelperPoint: (point) => point,
	toHelperRect: (rect) => rect,
	fromHelperRect: (rect) => rect,
};

const scalePoint = ({ x, y }: Point, scale: number) => ({ x: x * scale, y: y * scale });
const scaleRect = ({ x, y, width, height }: WindowBounds, scale: number) => ({
	x: x * scale,
	y: y * scale,
	width: width * scale,
	height: height * scale,
});
const roundPoint = ({ x, y }: Point) => ({ x: Math.round(x), y: Math.round(y) });
const roundRect = ({ x, y, width, height }: WindowBounds) => ({
	x: Math.round(x),
	y: Math.round(y),
	width: Math.round(width),
	height: Math.round(height),
});
const centreOf = ({ x, y, width, height }: WindowBounds) => ({
	x: x + width / 2,
	y: y + height / 2,
});
const contains = (rect: WindowBounds, { x, y }: Point) =>
	x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;

function x11Pixels(screen: () => ScreenApi): AgentConversions {
	const dipScale = (point: Point) =>
		screen().getDisplayNearestPoint(roundPoint(point)).scaleFactor;
	const pixelScale = (point: Point) =>
		(
			screen()
				.getAllDisplays()
				.find((display) =>
					contains(scaleRect(display.bounds, display.scaleFactor), point),
				) ?? screen().getPrimaryDisplay()
		).scaleFactor;
	return {
		toHelperPoint: (point) => scalePoint(point, dipScale(point)),
		fromHelperPoint: (point) => scalePoint(point, 1 / pixelScale(point)),
		toHelperRect: (rect) => scaleRect(rect, dipScale(centreOf(rect))),
		fromHelperRect: (rect) => scaleRect(rect, 1 / pixelScale(centreOf(rect))),
	};
}

function windowsPhysicalPixels(screen: () => ScreenApi): AgentConversions {
	return {
		toHelperPoint: (point) => screen().dipToScreenPoint(roundPoint(point)),
		fromHelperPoint: (point) => screen().screenToDipPoint(point),
		toHelperRect: (rect) => screen().dipToScreenRect(null, roundRect(rect)),
		fromHelperRect: (rect) => screen().screenToDipRect(null, roundRect(rect)),
	};
}

const CONVERSIONS: Partial<Record<NodeJS.Platform, (screen: () => ScreenApi) => AgentConversions>> =
	{
		win32: windowsPhysicalPixels,
		linux: x11Pixels,
	};

export function createAgentPlatform(overrides: Partial<AgentPlatformDeps> = {}) {
	const deps = { ...defaultDeps(), ...overrides };
	const convert = CONVERSIONS[deps.platform]?.(deps.screen) ?? IDENTITY;

	function support(): AgentSupport {
		if (deps.platform === "darwin" || deps.platform === "win32") return { supported: true };
		if (deps.platform !== "linux") return { supported: false, reason: UNSUPPORTED };
		const x11 =
			Boolean(deps.env.DISPLAY) &&
			deps.ozonePlatform().trim().toLowerCase() !== "wayland" &&
			!isLikelyLinuxWaylandSession(deps.env);
		return x11 ? { supported: true } : { supported: false, reason: X11_REQUIRED };
	}

	async function findWindow(sourceId: string): Promise<AgentWindowTarget | null> {
		const windowId = parseWindowId(sourceId);
		if (!windowId) return null;
		if (deps.platform === "darwin") {
			const found = await deps.findMacWindow(sourceId);
			return found?.frame ? { pid: found.pid, windowId, frame: found.frame } : null;
		}
		const window = await deps.windowInfo(windowId);
		if (!window?.visible || window.minimized) return null;
		return {
			pid: window.pid > 0 ? window.pid : undefined,
			windowId,
			frame: convert.fromHelperRect(window.frame),
		};
	}

	// Linux captures through the desktop portal, which hands out a whole screen whatever is selected.
	function recordsScreen(source: SelectedSource | null) {
		if (deps.platform === "linux") return true;
		return source?.sourceType === "screen" || Boolean(source?.id?.startsWith("screen:"));
	}

	function recordedFrame(source: SelectedSource | null): WindowBounds {
		const displays = deps.screen().getAllDisplays();
		const chosen = displays.filter((display) => String(display.id) === source?.display_id);
		const bounds = (chosen.length > 0 ? chosen : displays).map((display) => display.bounds);
		const x = Math.min(...bounds.map((each) => each.x));
		const y = Math.min(...bounds.map((each) => each.y));
		return {
			x,
			y,
			width: Math.max(...bounds.map((each) => each.x + each.width)) - x,
			height: Math.max(...bounds.map((each) => each.y + each.height)) - y,
		};
	}

	function sameApp(expected: string, actual: string) {
		const normalize = (name: string) =>
			name
				.replace(/\.app$/i, "")
				.trim()
				.toLowerCase();
		if (deps.platform === "darwin") return normalize(expected) === normalize(actual);
		const letters = (name: string) => normalize(name).replace(/[^\p{L}\p{N}]+/gu, "");
		const first = letters(normalize(expected).split(/\s+/)[0] ?? "");
		return Boolean(first) && letters(actual).startsWith(first);
	}

	function isOwnWindow({ pid, windowId }: { pid?: number; windowId?: number }) {
		return (
			(pid !== undefined && pid === deps.ownPid) ||
			(windowId !== undefined && deps.ownWindowIds().includes(windowId))
		);
	}

	return {
		name: deps.platform,
		recordsScreen,
		support,
		findWindow,
		isOwnWindow,
		recordedFrame,
		sameApp,
		...convert,
	};
}

export type AgentPlatform = ReturnType<typeof createAgentPlatform>;

export const agentPlatform = createAgentPlatform();
