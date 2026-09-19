import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock i18n context
vi.mock("../../../contexts/I18nContext", () => ({
	useScopedT: () => (key: string) => `translated:${key}`,
}));

// Mock toast wrapper
vi.mock("../../../lib/toast", () => ({
	toast: {
		error: vi.fn(),
		errorAlways: vi.fn(),
	},
}));

// Mock focusMode ref module
const setFocusModeEnabledRefMock = vi.fn();
const setFocusModeInitializedMock = vi.fn();
vi.mock("../../../lib/focusMode", () => ({
	setFocusModeEnabledRef: (val: boolean) => setFocusModeEnabledRefMock(val),
	setFocusModeInitialized: () => setFocusModeInitializedMock(),
}));

// Custom minimal hook runner to simulate React lifecycle in Node
let stateMap: Map<number, unknown> = new Map();
let stateSetters: Map<number, (v: unknown) => void> = new Map();
let effectCleanups: Array<(() => void) | undefined> = [];
let stateIndex = 0;
let effectCallbacks: Array<() => void | (() => void)> = [];

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useState: (initial: unknown) => {
			const idx = stateIndex++;
			if (!stateMap.has(idx)) {
				stateMap.set(idx, typeof initial === "function" ? initial() : initial);
			}
			const setter = (val: unknown) => {
				const next = typeof val === "function" ? val(stateMap.get(idx)) : val;
				stateMap.set(idx, next);
			};
			stateSetters.set(idx, setter);
			return [stateMap.get(idx), setter];
		},
		useEffect: (effect: () => void | (() => void)) => {
			effectCallbacks.push(effect);
		},
		useCallback: (fn: (...args: unknown[]) => unknown) => fn,
	};
});

describe("useFocusMode hook", () => {
	let mockGetFocusModeStatus: ReturnType<typeof vi.fn>;
	let mockSetFocusMode: ReturnType<typeof vi.fn>;
	let mockOnFocusModeChanged: ReturnType<typeof vi.fn>;
	let listenerCallback: ((result: unknown) => void) | null = null;
	const unsubscribeMock = vi.fn();

	beforeEach(() => {
		stateMap.clear();
		stateSetters.clear();
		effectCleanups = [];
		effectCallbacks = [];
		stateIndex = 0;
		listenerCallback = null;
		unsubscribeMock.mockClear();
		setFocusModeEnabledRefMock.mockClear();
		setFocusModeInitializedMock.mockClear();

		mockGetFocusModeStatus = vi.fn().mockResolvedValue({
			success: true,
			enabled: false,
			supported: true,
		});

		mockSetFocusMode = vi.fn().mockResolvedValue({
			success: true,
			enabled: true,
			supported: true,
		});

		mockOnFocusModeChanged = vi.fn((cb) => {
			listenerCallback = cb;
			return unsubscribeMock;
		});

		(globalThis as unknown as { electronAPI: unknown }).electronAPI = {
			getFocusModeStatus: mockGetFocusModeStatus,
			setFocusMode: mockSetFocusMode,
			onFocusModeChanged: mockOnFocusModeChanged,
		};
		(globalThis as unknown as { window: unknown }).window = globalThis;
	});

	afterEach(() => {
		Reflect.deleteProperty(globalThis, "electronAPI");
		Reflect.deleteProperty(globalThis, "window");
		vi.clearAllMocks();
	});

	async function runHook() {
		stateIndex = 0;
		effectCallbacks = [];
		const { useFocusMode } = await import("./useFocusMode");
		// biome-ignore lint/correctness/useHookAtTopLevel: runHook is a test-only hook runner, not a React component
		const hookResult = useFocusMode();

		// Run mounted effects
		for (const cb of effectCallbacks) {
			const cleanup = cb();
			if (typeof cleanup === "function") {
				effectCleanups.push(cleanup);
			}
		}

		return hookResult;
	}

	it("queries getFocusModeStatus on mount and syncs state", async () => {
		mockGetFocusModeStatus.mockResolvedValueOnce({
			success: true,
			enabled: true,
			supported: true,
		});

		const result = await runHook();
		expect(mockGetFocusModeStatus).toHaveBeenCalled();
		// Wait for microtasks to resolve
		await Promise.resolve();
		await Promise.resolve();

		expect(setFocusModeEnabledRefMock).toHaveBeenCalledWith(true);
		expect(result.focusModeEnabled).toBe(false); // initial return before async resolves
	});

	it("subscribes to onFocusModeChanged and cleans up on unmount", async () => {
		await runHook();
		expect(mockOnFocusModeChanged).toHaveBeenCalled();
		expect(listenerCallback).toBeDefined();

		// Trigger change event
		listenerCallback!({ success: true, enabled: true, supported: true });
		expect(setFocusModeEnabledRefMock).toHaveBeenCalledWith(true);

		// Trigger cleanups
		for (const cleanup of effectCleanups) {
			cleanup?.();
		}
		expect(unsubscribeMock).toHaveBeenCalled();
	});

	it("toggles focus mode and calls setFocusMode", async () => {
		const result = await runHook();
		await result.toggleFocusMode();

		expect(mockSetFocusMode).toHaveBeenCalledWith(true);
		expect(setFocusModeEnabledRefMock).toHaveBeenCalledWith(true);
	});

	it("shows error toast when toggle fails", async () => {
		const { toast } = await import("../../../lib/toast");
		mockSetFocusMode.mockResolvedValueOnce({
			success: false,
			error: "Custom error message",
		});

		const result = await runHook();
		await result.toggleFocusMode();

		expect(toast.errorAlways).toHaveBeenCalledWith("Custom error message");
	});
});
