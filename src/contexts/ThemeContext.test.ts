import { afterEach, describe, expect, it, vi } from "vitest";
import { loadThemePreference, persistThemePreference, ThemeProvider } from "./ThemeContext";

const hooks = vi.hoisted(() => ({
	effects: [] as Array<() => void | (() => void)>,
	setters: [] as Array<ReturnType<typeof vi.fn>>,
}));

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: <T>(initial: T | (() => T)) => {
		const setter = vi.fn();
		hooks.setters.push(setter);
		return [typeof initial === "function" ? (initial as () => T)() : initial, setter];
	},
	useCallback: <T>(callback: T) => callback,
	useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));

function createStorageMock(initialValues: Record<string, string> = {}): Storage {
	const store = new Map(Object.entries(initialValues));

	return {
		get length() {
			return store.size;
		},
		clear() {
			store.clear();
		},
		getItem(key) {
			return store.get(key) ?? null;
		},
		key(index) {
			return Array.from(store.keys())[index] ?? null;
		},
		removeItem(key) {
			store.delete(key);
		},
		setItem(key, value) {
			store.set(key, value);
		},
	};
}

function stubElectronSettings(initialValues: Record<string, unknown> = {}) {
	const store = new Map(Object.entries(initialValues));

	Object.defineProperty(globalThis, "electronAPI", {
		configurable: true,
		value: {
			getAppSetting: (key: string) => (store.has(key) ? store.get(key) : null),
			setAppSetting: (key: string, value: unknown) => {
				store.set(key, value);
				return true;
			},
		} as Pick<Window["electronAPI"], "getAppSetting" | "setAppSetting">,
	});

	return store;
}

describe("ThemeContext persistence", () => {
	afterEach(() => {
		hooks.effects.length = 0;
		hooks.setters.length = 0;
		vi.unstubAllGlobals();
		Reflect.deleteProperty(globalThis, "electronAPI");
	});

	it("loads the persisted theme preference from Electron app settings", () => {
		stubElectronSettings({ "recordly.theme": "dark" });

		expect(loadThemePreference()).toBe("dark");
	});

	it("saves the theme preference to Electron app settings", () => {
		const settingsStore = stubElectronSettings();

		persistThemePreference("dark");

		expect(settingsStore.get("recordly.theme")).toBe("dark");
	});

	it("falls back to localStorage when Electron settings are unavailable", () => {
		vi.stubGlobal("localStorage", createStorageMock({ "recordly.theme": "light" }));

		expect(loadThemePreference()).toBe("light");
	});

	it("synchronizes a system theme change that arrives before the listener is installed", () => {
		stubElectronSettings({ "recordly.theme": "system" });
		const query = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
		vi.stubGlobal("matchMedia", () => query);
		vi.stubGlobal("document", {
			documentElement: { dataset: {}, classList: { add: vi.fn(), remove: vi.fn() } },
		});

		ThemeProvider({ children: null });
		query.matches = true;
		const cleanups = hooks.effects.map((effect) => effect());
		expect(hooks.setters[1]).toHaveBeenCalledWith("dark");
		for (const cleanup of cleanups) cleanup?.();
	});
});
