import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/components/video-editor/SettingsRow";
import { OnboardingPermissions } from "./OnboardingPermissions";
import { RecordingPermissionsSettings } from "./RecordingPermissionsSettings";

const state = vi.hoisted(() => ({
	slots: [] as { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }[],
	index: 0,
	effects: [] as (() => void)[],
	settings: new Map<string, unknown>(),
	writes: [] as [string, unknown][],
}));
const same = (left?: readonly unknown[], right?: readonly unknown[]) =>
	left !== undefined &&
	right !== undefined &&
	left.length === right.length &&
	left.every((value, index) => Object.is(value, right[index]));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = state.index++;
		if (!state.slots[index])
			state.slots[index] = {
				value: typeof initial === "function" ? initial() : initial,
			};
		return [
			state.slots[index].value,
			(next: unknown) => {
				state.slots[index].value =
					typeof next === "function" ? next(state.slots[index].value) : next;
			},
		];
	},
	useRef: (initial: unknown) => {
		const index = state.index++;
		state.slots[index] ??= { value: { current: initial } };
		return state.slots[index].value;
	},
	useCallback: (callback: unknown, deps: readonly unknown[]) => {
		const index = state.index++;
		if (!same(state.slots[index]?.deps, deps)) state.slots[index] = { value: callback, deps };
		return state.slots[index].value;
	},
	useLayoutEffect: () => undefined,
	useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
		const index = state.index++;
		if (same(state.slots[index]?.deps, deps)) return;
		const cleanup = state.slots[index]?.cleanup;
		state.slots[index] = { deps };
		state.effects.push(() => {
			cleanup?.();
			const result = effect();
			if (typeof result === "function") state.slots[index].cleanup = result;
		});
	},
}));

const translate = (key: string, _fallback?: string, vars?: { permission?: string }) =>
	vars?.permission ? `${key}:${vars.permission}` : key;
const settingsTranslate = (key: string, fallback?: string) => fallback ?? key;
vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: () => translate,
	useI18n: () => ({ t: settingsTranslate }),
}));
vi.mock("@/lib/appSettings", () => ({ saveAppSetting: vi.fn() }));
vi.mock("@heroui/react", () => ({ Button: "button" }));
vi.mock("motion/react", () => ({ useReducedMotion: () => true, motion: { div: "div" } }));
vi.mock("@/components/feedback/ErrorReportButton", () => ({ ErrorReportButton: "report" }));
vi.mock("./PermissionsConfetti", () => ({ PermissionsConfetti: "confetti" }));
vi.mock("./OnboardingLayout", () => ({
	OnboardingBody: "body",
	OnboardingFooter: "footer",
	OnboardingHeader: "header",
	OnboardingPrimaryAction: "primary",
	OnboardingTitle: "title",
}));
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
	if (!node || typeof node !== "object") return [];
	if (Array.isArray(node)) return node.flatMap(nodes);
	const element = node as ReactElement<{ children?: ReactNode }>;
	return [element, ...nodes(element.props?.children)];
}
const flush = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};
function render() {
	state.index = 0;
	const result = OnboardingPermissions({ onFinish: vi.fn() });
	for (const effect of state.effects.splice(0)) effect();
	return nodes(result);
}
const alert = () => render().find((node) => node.props?.role === "alert");
const allow = () =>
	render().find((node) => node.props?.["aria-label"] === "allowPermission:screen")!;
beforeEach(() => {
	state.slots = [];
	state.effects = [];
	vi.useFakeTimers();
	vi.stubGlobal("document", {
		visibilityState: "visible",
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	});
	vi.stubGlobal("window", {
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		setInterval,
		clearInterval,
		electronAPI: {
			getPlatform: vi.fn(async () => "darwin"),
			getScreenRecordingPermissionStatus: vi.fn(async () => ({
				success: true,
				status: "denied",
			})),
			getAccessibilityPermissionStatus: vi.fn(async () => ({ success: true, trusted: true })),
			openScreenRecordingPreferences: vi.fn(async () => ({ success: false })),
		},
	});
});
afterEach(() => {
	for (const slot of state.slots) slot.cleanup?.();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
it("keeps a failed permission request visible through successful status polls and clears it on retry", async () => {
	render();
	await flush();
	render();
	allow().props.onPress();
	await flush();
	expect(alert()?.props.children[0]).toBe("permissionFailed");
	await vi.advanceTimersByTimeAsync(3000);
	await flush();
	expect(alert()?.props.children[0]).toBe("permissionFailed");
	vi.mocked(window.electronAPI.openScreenRecordingPreferences).mockResolvedValue({
		success: true,
	});
	allow().props.onPress();
	await flush();
	expect(alert()).toBeUndefined();
});
it("clears a stale failed-request report after status checks verify all permissions recovered", async () => {
	render();
	await flush();
	render();
	allow().props.onPress();
	await flush();
	render();
	vi.mocked(window.electronAPI.getScreenRecordingPermissionStatus).mockResolvedValue({
		success: true,
		status: "granted",
	});
	await vi.advanceTimersByTimeAsync(3000);
	await flush();
	const tree = render();
	expect(tree.find((node) => node.type === "primary")?.props.isDisabled).toBe(false);
	expect(tree.find((node) => node.props?.role === "alert")).toBeUndefined();
});
it("clears a status-check error when the permission service recovers", async () => {
	vi.mocked(window.electronAPI.getScreenRecordingPermissionStatus).mockRejectedValueOnce(
		new Error("Unavailable"),
	);
	render();
	await flush();
	render();
	expect(alert()?.props.children[0]).toBe("checkFailed");
	await vi.advanceTimersByTimeAsync(3000);
	await flush();
	expect(alert()).toBeUndefined();
});

function renderSettings() {
	state.index = 0;
	const result = RecordingPermissionsSettings({});
	for (const effect of state.effects.splice(0)) effect();
	return nodes(result);
}
function settingsButton(label: string) {
	return renderSettings().find(
		(node) =>
			node.type === Button &&
			(node.props.children === label || node.props["aria-label"] === label),
	);
}
function settingsStatus(title: string) {
	const row = renderSettings().find(
		(node) => node.type === SettingsRow && node.props.title === title,
	);
	const children = nodes(row).find((node) => node.props.role === "status")?.props.children;
	return Array.isArray(children)
		? children.filter((child) => typeof child === "string").join("")
		: children;
}
function focusSettings() {
	const listener = vi
		.mocked(window.addEventListener)
		.mock.calls.find(([type]) => type === "focus")?.[1];
	expect(listener).toBeTypeOf("function");
	(listener as () => void)();
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const initialMedia = { success: true, microphone: "not-determined", camera: "not-determined" };

describe("recording-settings permission refresh", () => {
	beforeEach(() => {
		window.electronAPI.getMediaPermissionStatus = vi.fn().mockResolvedValue(initialMedia);
		window.electronAPI.requestMediaPermission = vi
			.fn()
			.mockResolvedValue({ success: true, granted: true });
		window.electronAPI.openMediaPermissionPreferences = vi
			.fn()
			.mockResolvedValue({ success: true });
	});

	for (const granted of [true, false]) {
		it(`reads fresh permission status after an overlapping focus check (granted=${granted})`, async () => {
			const stale = deferred<typeof initialMedia>();
			const fresh = deferred<typeof initialMedia>();
			const permission = deferred<{ success: boolean; granted: boolean }>();
			const status = vi.mocked(window.electronAPI.getMediaPermissionStatus);
			status
				.mockResolvedValueOnce(initialMedia)
				.mockReturnValueOnce(stale.promise)
				.mockReturnValueOnce(fresh.promise);
			vi.mocked(window.electronAPI.requestMediaPermission).mockReturnValueOnce(
				permission.promise,
			);
			renderSettings();
			await flush();
			expect(settingsStatus("Microphone")).toBe("Not requested");
			(settingsButton("Allow microphone")!.props.onClick as () => void)();
			focusSettings();
			await flush();
			expect(status).toHaveBeenCalledTimes(2);
			permission.resolve({ success: true, granted });
			await flush();
			// The still-running read captured status before the native prompt completed.
			stale.resolve(initialMedia);
			await flush();
			expect(status).toHaveBeenCalledTimes(3);
			expect(renderSettings()[0].props["aria-busy"]).toBe(true);
			expect(settingsButton("Allow microphone")?.props.disabled).toBe(true);
			fresh.resolve({ ...initialMedia, microphone: granted ? "granted" : "denied" });
			await flush();
			expect(settingsStatus("Microphone")).toBe(granted ? "Allowed" : "Not allowed");
			expect(renderSettings()[0].props["aria-busy"]).toBe(false);
			expect(settingsButton("Allow microphone")).toBeUndefined();
			expect(!!settingsButton("Open System Settings: Microphone")).toBe(!granted);
			expect(renderSettings().filter((node) => node.props.role === "alert")).toHaveLength(0);
			expect(window.electronAPI.requestMediaPermission).toHaveBeenCalledExactlyOnceWith(
				"microphone",
			);
		});
	}

	it("coalesces focus notifications during the initial read into one fresh read", async () => {
		const stale = deferred<typeof initialMedia>();
		const status = vi.mocked(window.electronAPI.getMediaPermissionStatus);
		status
			.mockReturnValueOnce(stale.promise)
			.mockResolvedValueOnce({ ...initialMedia, camera: "granted" });
		renderSettings();
		await flush();
		focusSettings();
		focusSettings();
		focusSettings();
		expect(status).toHaveBeenCalledTimes(1);
		stale.resolve(initialMedia);
		await flush();
		expect(status).toHaveBeenCalledTimes(2);
		expect(settingsStatus("Camera")).toBe("Allowed");
		expect(renderSettings()[0].props["aria-busy"]).toBe(false);
	});

	it("refreshes after System Settings opens while a focus check is in flight", async () => {
		const stale = deferred<typeof initialMedia>();
		const opened = deferred<{ success: boolean }>();
		const status = vi.mocked(window.electronAPI.getMediaPermissionStatus);
		status.mockResolvedValueOnce(initialMedia).mockReturnValueOnce(stale.promise);
		vi.mocked(window.electronAPI.openScreenRecordingPreferences).mockReturnValueOnce(
			opened.promise,
		);
		vi.mocked(window.electronAPI.getScreenRecordingPermissionStatus)
			.mockResolvedValueOnce({ success: true, status: "denied" })
			.mockResolvedValueOnce({ success: true, status: "denied" })
			.mockResolvedValueOnce({ success: true, status: "granted" });
		renderSettings();
		await flush();
		(settingsButton("Open System Settings: Screen Recording")!.props.onClick as () => void)();
		focusSettings();
		await flush();
		opened.resolve({ success: true });
		await flush();
		stale.resolve(initialMedia);
		await flush();
		expect(status).toHaveBeenCalledTimes(3);
		expect(settingsStatus("Screen Recording")).toBe("Allowed");
		expect(renderSettings()[0].props["aria-busy"]).toBe(false);
	});

	it("clears a status failure when its queued follow-up succeeds", async () => {
		const stale = deferred<typeof initialMedia>();
		const fresh = deferred<typeof initialMedia>();
		const status = vi.mocked(window.electronAPI.getMediaPermissionStatus);
		status.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
		renderSettings();
		await flush();
		focusSettings();
		stale.resolve({ ...initialMedia, success: false });
		await flush();
		expect(renderSettings().filter((node) => node.props.role === "alert")).toHaveLength(1);
		expect(renderSettings()[0].props["aria-busy"]).toBe(true);
		fresh.resolve({ ...initialMedia, microphone: "granted" });
		await flush();
		expect(status).toHaveBeenCalledTimes(2);
		expect(settingsStatus("Microphone")).toBe("Allowed");
		expect(renderSettings().filter((node) => node.props.role === "alert")).toHaveLength(0);
		expect(renderSettings()[0].props["aria-busy"]).toBe(false);
	});

	it("retains a failed request report through the queued status refresh", async () => {
		const stale = deferred<typeof initialMedia>();
		const permission = deferred<{ success: boolean; granted: boolean }>();
		const status = vi.mocked(window.electronAPI.getMediaPermissionStatus);
		status
			.mockResolvedValueOnce(initialMedia)
			.mockReturnValueOnce(stale.promise)
			.mockResolvedValueOnce({ ...initialMedia, camera: "denied" });
		vi.mocked(window.electronAPI.requestMediaPermission).mockReturnValueOnce(
			permission.promise,
		);
		renderSettings();
		await flush();
		(settingsButton("Allow camera")!.props.onClick as () => void)();
		focusSettings();
		await flush();
		permission.resolve({ success: false, granted: false });
		await flush();
		stale.resolve(initialMedia);
		await flush();
		expect(status).toHaveBeenCalledTimes(3);
		expect(settingsStatus("Camera")).toBe("Not allowed");
		expect(settingsButton("Open System Settings: Camera")?.props.disabled).toBe(false);
		const alerts = renderSettings().filter((node) => node.props.role === "alert");
		expect(alerts).toHaveLength(1);
		expect(alerts[0].props.children).toContain(
			"Could not request access. Try again or enable access in System Settings.",
		);
	});

	it("does not run a queued refresh after unmount", async () => {
		const stale = deferred<typeof initialMedia>();
		const status = vi.mocked(window.electronAPI.getMediaPermissionStatus);
		status.mockReturnValueOnce(stale.promise);
		renderSettings();
		await flush();
		focusSettings();
		for (const slot of state.slots) slot.cleanup?.();
		stale.resolve(initialMedia);
		await flush();
		expect(status).toHaveBeenCalledTimes(1);
		expect(window.removeEventListener).toHaveBeenCalledWith("focus", expect.any(Function));
	});
});
