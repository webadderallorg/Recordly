import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHORTCUTS, mergeWithDefaults, serializeShortcuts } from "./shortcuts";

describe("split shortcut migration", () => {
	it("updates an existing saved C default to the primary-modifier B binding", () => {
		expect(
			mergeWithDefaults({ ...DEFAULT_SHORTCUTS, splitClip: { key: "c" } }).splitClip,
		).toEqual({ key: "b", ctrl: true });
	});
	it("preserves a customized split shortcut", () => {
		expect(mergeWithDefaults({ splitClip: { key: "x", shift: true } }).splitClip).toEqual({
			key: "x",
			shift: true,
		});
	});
	it("does not overwrite another action's custom Cmd/Ctrl+B binding", () => {
		expect(
			mergeWithDefaults({ splitClip: { key: "c" }, addZoom: { key: "b", ctrl: true } })
				.splitClip,
		).toEqual({ key: "c" });
	});
});

it("does not migrate an explicitly saved C binding on subsequent loads", () => {
	const first = mergeWithDefaults({ ...DEFAULT_SHORTCUTS, splitClip: { key: "c" } });
	const manual = serializeShortcuts({
		...first,
		splitClip: { key: "c" },
		addAnnotation: { key: "p", shift: true },
	});
	expect(mergeWithDefaults(manual)).toMatchObject({
		splitClip: { key: "c" },
		addAnnotation: { key: "p", shift: true },
	});
	expect(mergeWithDefaults(serializeShortcuts(mergeWithDefaults(manual))).splitClip).toEqual({
		key: "c",
	});
});
it("does not retry a collision-skipped migration after the user changes the conflict", () => {
	const first = serializeShortcuts(
		mergeWithDefaults({ splitClip: { key: "c" }, addZoom: { key: "b", ctrl: true } }),
	);
	expect(mergeWithDefaults({ ...first, addZoom: { key: "z" } }).splitClip).toEqual({ key: "c" });
});

const providerHooks = vi.hoisted(() => {
	const slots: unknown[] = [];
	let cursor = 0;
	let effects: (() => void)[] = [];
	return {
		reset() {
			slots.length = 0;
			cursor = 0;
			effects = [];
		},
		render<T>(factory: () => T): T {
			cursor = 0;
			effects = [];
			const result = factory();
			for (const effect of effects) effect();
			return result;
		},
		useCallback: <T>(callback: T) => callback,
		useMemo: <T>(factory: () => T) => factory(),
		useRef<T>(current: T) {
			const index = cursor++;
			slots[index] ??= { current };
			return slots[index] as { current: T };
		},
		useState<T>(initial: T) {
			const index = cursor++;
			let state = slots[index] as { value: T; set: (value: T) => void } | undefined;
			if (!state) {
				const created = {
					value: initial,
					set: (value: T) => {
						created.value = value;
					},
				};
				slots[index] = created;
				state = created;
			}
			return [state.value, state.set] as const;
		},
		useEffect(effect: () => void, _deps: readonly unknown[]) {
			const index = cursor++;
			if (!slots[index]) {
				slots[index] = true;
				effects.push(effect);
			}
		},
	};
});
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	...providerHooks,
}));
vi.mock("@/utils/platformUtils", () => ({ isMac: async () => false }));
import { ShortcutsProvider } from "../contexts/ShortcutsContext";
function provider() {
	return providerHooks.render(() => ShortcutsProvider({ children: null })).props.value;
}
const flushProvider = async () => {
	await Promise.resolve();
	await Promise.resolve();
};
afterEach(() => vi.unstubAllGlobals());

it("persists the migration once, orders its write before manual C, and preserves C after reload", async () => {
	providerHooks.reset();
	let stored = { ...DEFAULT_SHORTCUTS, splitClip: { key: "c" } } as Record<string, unknown>;
	let finishMigration!: () => void;
	const save = vi.fn((config: Record<string, unknown>) => {
		if (save.mock.calls.length === 1)
			return new Promise((resolve) => {
				finishMigration = () => {
					stored = config;
					resolve({ success: true });
				};
			});
		stored = config;
		return Promise.resolve({ success: true });
	});
	vi.stubGlobal("window", {
		electronAPI: { getShortcuts: async () => stored, saveShortcuts: save },
	});
	provider();
	await flushProvider();
	expect(save).toHaveBeenCalledWith(
		expect.objectContaining({ version: 1, splitClip: { key: "b", ctrl: true } }),
	);
	const current = provider();
	const manual = { ...current.shortcuts, splitClip: { key: "c" } };
	current.setShortcuts(manual);
	const saving = current.persistShortcuts(manual);
	await flushProvider();
	expect(save).toHaveBeenCalledTimes(1);
	finishMigration();
	await saving;
	expect(stored).toMatchObject({ version: 1, splitClip: { key: "c" } });
	providerHooks.reset();
	provider();
	await flushProvider();
	expect(provider().shortcuts.splitClip).toEqual({ key: "c" });
	expect(save).toHaveBeenCalledTimes(2);
});

it("does not hydrate or migrate over a manual save while the initial load is delayed", async () => {
	providerHooks.reset();
	let load!: (value: unknown) => void;
	const saved = vi.fn(async () => ({ success: true }));
	vi.stubGlobal("window", {
		electronAPI: {
			getShortcuts: () =>
				new Promise((resolve) => {
					load = resolve;
				}),
			saveShortcuts: saved,
		},
	});
	const current = provider();
	const manual = { ...DEFAULT_SHORTCUTS, splitClip: { key: "c" } };
	current.setShortcuts(manual);
	await current.persistShortcuts(manual);
	load({ ...DEFAULT_SHORTCUTS, splitClip: { key: "c" } });
	await flushProvider();
	expect(provider().shortcuts.splitClip).toEqual({ key: "c" });
	expect(saved).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ version: 1, splitClip: { key: "c" } }),
	);
});
