import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppUpdateSettings } from "./AppUpdateSettings";

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

const translate = (_key: string, fallback?: string) => fallback ?? _key;
vi.mock("@/contexts/I18nContext", () => ({ useI18n: () => ({ t: translate, locale: "en" }) }));
vi.mock("@/components/feedback/ErrorReportButton", () => ({ ErrorReportButton: "report" }));
vi.mock("@/components/feedback/LocalizedError", () => ({ LocalizedError: "localized-error" }));
vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/components/ui/switch", () => ({ Switch: "switch" }));
vi.mock("../SettingsRow", () => ({ SettingsRow: "row" }));
vi.mock("../SettingsInfo", () => ({ SettingsInfo: "info" }));
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
	const result = AppUpdateSettings();
	for (const effect of state.effects.splice(0)) effect();
	return nodes(result);
}
beforeEach(() => {
	state.slots = [];
	state.effects = [];
	vi.stubGlobal("window", {
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		electronAPI: {
			getUpdateStatusSummary: vi.fn(async () => ({
				status: "idle",
				currentVersion: "2.0.0",
				availableVersion: null,
			})),
			getExperimentalUpdatesEnabled: vi.fn(async () => {
				throw new Error("IPC channel unavailable");
			}),
			getAutomaticUpdateDownloadsEnabled: vi.fn(async () => false),
			getAppVersion: vi.fn(async () => "2.0.0"),
		},
	});
});
afterEach(() => {
	for (const slot of state.slots) slot.cleanup?.();
	vi.unstubAllGlobals();
});
it("describes a channel load failure and preserves the underlying cause for reporting", async () => {
	render();
	await flush();
	const tree = render();
	const alert = tree.find((node) => node.props?.role === "alert");
	expect(alert?.props.children[0]).toBe("Could not load the update channel. Try again.");
	expect(tree.find((node) => node.type === "report")?.props.error).toContain(
		"IPC channel unavailable",
	);
	expect(alert?.props.children[0]).not.toContain("change");
});
it("clears the channel error after a successful retry", async () => {
	render();
	await flush();
	const tree = render();
	vi.mocked(window.electronAPI.getExperimentalUpdatesEnabled).mockResolvedValue(false);
	const retry = tree.find(
		(node) => node.type === "button" && node.props.children === "Try again",
	);
	expect(retry).toBeDefined();
	retry?.props.onClick();
	await flush();
	expect(render().some((node) => node.props?.role === "alert")).toBe(false);
});
