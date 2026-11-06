import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingController } from "./OnboardingController";
import { RecordlySignInDialog } from "./RecordlySignInDialog";
import { RecordingPermissionsDialog } from "./RecordingPermissionsDialog";

const state = vi.hoisted(() => ({
	slots: [] as { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }[],
	index: 0,
	effects: [] as (() => void)[],
	settings: new Map<string, unknown>(),
	writes: [] as [string, unknown][],
}));
const same = (left?: readonly unknown[], right?: readonly unknown[]) =>
	left !== undefined && right !== undefined && left.length === right.length &&
	left.every((value, index) => Object.is(value, right[index]));
vi.mock("react", async (importOriginal) => ({
	...await importOriginal<typeof import("react")>(),
	useState: (initial: unknown) => {
		const index = state.index++;
		if (!state.slots[index]) state.slots[index] = {
			value: typeof initial === "function" ? initial() : initial,
		};
		return [state.slots[index].value, (next: unknown) => {
			state.slots[index].value = typeof next === "function" ? next(state.slots[index].value) : next;
		}];
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
vi.mock("@/lib/appSettings", () => ({
	loadAppSetting: (key: string) => state.settings.get(key) ?? null,
	saveAppSetting: (key: string, value: unknown) => {
		state.settings.set(key, value);
		state.writes.push([key, value]);
		return true;
	},
}));
vi.mock("./RecordlySignInDialog", () => ({ RecordlySignInDialog: () => null }));
vi.mock("./RecordingPermissionsDialog", () => ({ RecordingPermissionsDialog: () => null }));

const pendingKey = "recordly.onboarding.permissionsRequested";
const seenKey = "recordly.onboarding.v1.seen";
const user = { id: "restored-account" } as User;
const hud = vi.fn(async () => undefined);
const closeWindow = vi.fn(async () => undefined);
function render(overrides: Partial<Parameters<typeof OnboardingController>[0]> = {}) {
	state.index = 0;
	const result = OnboardingController({
		requestNonce: 0, ready: true, user, configured: true, standalone: true, ...overrides,
	});
	for (const effect of state.effects.splice(0)) effect();
	return result;
}
beforeEach(() => {
	state.slots = [];
	state.effects = [];
	state.settings.clear();
	state.writes = [];
	vi.clearAllMocks();
	vi.stubEnv("DEV", true);
	vi.stubGlobal("window", {
		location: { search: "?windowType=onboarding" },
		electronAPI: {
			showOnboardingWindow: vi.fn(async () => false),
			onRecordingPermissionsRequested: vi.fn(() => () => undefined),
			showRecordingHud: hud,
			closeOnboardingWindow: closeWindow,
		},
	});
});

describe("onboarding account and permission restart", () => {
	it("uses the restored real account on an ordinary development launch", () => {
		render();
		const result = render();
		expect(result?.type).toBe(RecordlySignInDialog);
		expect(result?.props).toMatchObject({ onboarding: true, preview: true, user });
	});

	it("keeps explicit real sign-in required in development", () => {
		window.location.search = "?windowType=onboarding&onboardingPreview=0";
		render();
		expect(render()?.props.preview).toBe(false);
	});

	for (const seen of [false, true]) {
		for (const pending of [false, true]) {
			it(`does not replay a dismissed dev tour after recording recreates the editor (seen=${seen}, pending=${pending})`, () => {
				render();
				render()?.props.onWindowClose();
				expect(state.settings.get("recordly.dev.onboardingDismissed")).toBe(true);
				state.settings.set(seenKey, seen);
				state.settings.set(pendingKey, pending);
				// Recording closes the HUD and creates a fresh editor renderer; hooks
				// reset while app settings and the restored auth session survive.
				state.slots = [];
				window.location.search = "?windowType=editor";
				render({ standalone: false });
				render({ standalone: false });
				expect(window.electronAPI.showOnboardingWindow).not.toHaveBeenCalled();
			});
		}
	}

	it("opens the optional dev window only once while account identity refreshes", () => {
		window.location.search = "?windowType=editor";
		render({ standalone: false });
		render({ standalone: false, user: { ...user } });
		expect(window.electronAPI.showOnboardingWindow).toHaveBeenCalledExactlyOnceWith({ preview: true });
	});

	it("preserves production account gating even if the dev tour was dismissed", () => {
		vi.stubEnv("DEV", false);
		state.settings.set("recordly.dev.onboardingDismissed", true);
		state.settings.set(seenKey, true);
		render({ standalone: false, user: null });
		const result = render({ standalone: false, user: null });
		expect(result?.props).toMatchObject({ requireSignIn: true, open: true, user: null });
	});

	it("requires production sign-in when a previously restored session expires", () => {
		vi.stubEnv("DEV", false);
		state.settings.set(seenKey, true);
		render({ standalone: false });
		render({ standalone: false, user: null });
		const result = render({ standalone: false, user: null });
		expect(result?.props).toMatchObject({ requireSignIn: true, open: true, user: null });
	});

	it("resumes unfinished first-run permissions after closing and restarting", async () => {
		window.location.search = "?windowType=onboarding&onboardingPreview=0";
		state.settings.set(pendingKey, true);
		render();
		const first = render();
		expect(first?.type).toBe(RecordlySignInDialog);
		expect(first?.props).toMatchObject({ onboarding: true, startWithPermissions: true });
		first?.props.onWindowClose();
		expect(state.settings.get(pendingKey)).toBe(true);
		state.slots = [];
		render();
		const resumed = render();
		expect(resumed?.type).toBe(RecordlySignInDialog);
		resumed?.props.onAuthenticated();
		await Promise.resolve();
		expect(state.settings.get(seenKey)).toBe(true);
		expect(state.settings.get(pendingKey)).toBe(false);
		expect(hud).toHaveBeenCalledOnce();
	});

	it("resumes later permission recovery without rewriting completed onboarding", async () => {
		state.settings.set(seenKey, true);
		window.location.search = "?windowType=onboarding&onboardingPreview=0";
		state.settings.set(pendingKey, true);
		render();
		const recovery = render();
		expect(recovery?.type).toBe(RecordingPermissionsDialog);
		recovery?.props.onFinish();
		await Promise.resolve();
		expect(state.settings.get(pendingKey)).toBe(false);
		expect(state.writes.some(([key]) => key === seenKey)).toBe(false);
	});
});
