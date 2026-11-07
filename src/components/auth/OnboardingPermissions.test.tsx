import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnboardingPermissions } from "./OnboardingPermissions";

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
vi.mock("@/contexts/I18nContext", () => ({ useScopedT: () => translate }));
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
it("allows completion after permissions recover without silently removing the failed-request report", async () => {
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
	expect(tree.find((node) => node.props?.role === "alert")?.props.children[0]).toBe(
		"permissionFailed",
	);
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
