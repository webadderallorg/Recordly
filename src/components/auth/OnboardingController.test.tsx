import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingController } from "./OnboardingController";
import { RecordingPermissionsDialog } from "./RecordingPermissionsDialog";
import { RecordlySignInDialog } from "./RecordlySignInDialog";

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
		requestNonce: 0,
		ready: true,
		user,
		configured: true,
		standalone: true,
		...overrides,
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
	hud.mockReset().mockResolvedValue(undefined);
	closeWindow.mockReset().mockResolvedValue(undefined);
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
		expect(window.electronAPI.showOnboardingWindow).toHaveBeenCalledExactlyOnceWith({
			preview: true,
		});
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

for (const rejected of [false, true]) {
	it(`opens the existing inline onboarding fallback when native creation ${rejected ? "rejects" : "returns false"}`, async () => {
		vi.mocked(window.electronAPI.showOnboardingWindow).mockImplementation(async () => {
			if (rejected) throw new Error("Window unavailable");
			return false;
		});
		window.location.search = "?windowType=editor";
		render({ standalone: false });
		for (let i = 0; i < 4; i++) await Promise.resolve();
		const result = render({ standalone: false });
		expect(result?.type).toBe(RecordlySignInDialog);
		expect(result?.props).toMatchObject({ onboarding: true, open: true });
	});
}

it("handles HUD recreation rejection without closing the only native window", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
	hud.mockRejectedValueOnce(new Error("Native window unavailable"));
	render();
	render()?.props.onAuthenticated();
	for (let n = 0; n < 5; n++) await Promise.resolve();
	expect(hud).toHaveBeenCalledOnce();
	expect(closeWindow).not.toHaveBeenCalled();
	expect(render()?.props.open).toBe(true);
	expect(state.settings.get("recordly.dev.onboardingDismissed")).toBeUndefined();
	expect(error).toHaveBeenCalledWith("[onboarding] Could not return to the recording HUD.");
	error.mockRestore();
});

for (const rejectedStep of ["hud", "close"] as const) {
	it(`keeps permission recovery open and retries when ${rejectedStep} rejects`, async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.stubEnv("DEV", false);
		state.settings.set(seenKey, true);
		state.settings.set(pendingKey, true);
		render();
		const recovery = render();
		expect(recovery?.type).toBe(RecordingPermissionsDialog);
		expect(recovery?.props.open).toBe(true);
		if (rejectedStep === "hud") {
			hud.mockImplementationOnce(async () => {
				expect(state.settings.get(pendingKey)).toBe(true);
				throw new Error("HUD unavailable");
			});
		} else {
			closeWindow.mockImplementationOnce(async () => {
				// Persist completion before the native window can destroy this renderer.
				expect(state.settings.get(pendingKey)).toBe(false);
				throw new Error("Window close failed");
			});
		}
		recovery?.props.onFinish();
		recovery?.props.onFinish();
		for (let n = 0; n < 10; n++) await Promise.resolve();
		expect(hud).toHaveBeenCalledOnce();
		expect(closeWindow).toHaveBeenCalledTimes(rejectedStep === "hud" ? 0 : 1);
		expect(state.settings.get(pendingKey)).toBe(true);
		expect(state.settings.get(seenKey)).toBe(true);
		const retry = render();
		expect(retry?.type).toBe(RecordingPermissionsDialog);
		expect(retry?.props.open).toBe(true);
		closeWindow.mockImplementation(async () => {
			expect(state.settings.get(pendingKey)).toBe(false);
			expect(render()?.props.open).toBe(true);
		});
		retry?.props.onFinish();
		for (let n = 0; n < 10; n++) await Promise.resolve();
		expect(hud).toHaveBeenCalledTimes(2);
		expect(closeWindow).toHaveBeenCalledTimes(rejectedStep === "hud" ? 1 : 2);
		expect(state.settings.get(pendingKey)).toBe(false);
		expect(render()?.props).toMatchObject({ open: false, startWithPermissions: false });
		expect(error).toHaveBeenCalledExactlyOnceWith(
			"[onboarding] Could not return to the recording HUD.",
		);
		error.mockRestore();
	});
}

it("keeps the existing dialog visible throughout the pending native handoff", async () => {
	vi.stubEnv("DEV", false);
	state.settings.set(seenKey, true);
	state.settings.set(pendingKey, true);
	let releaseHud!: () => void;
	let releaseClose!: () => void;
	hud.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				releaseHud = resolve;
			}),
	);
	closeWindow.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				releaseClose = resolve;
			}),
	);
	render();
	render()?.props.onFinish();
	expect(render()?.props.open).toBe(true);
	expect(state.settings.get(pendingKey)).toBe(true);
	expect(closeWindow).not.toHaveBeenCalled();
	releaseHud();
	for (let n = 0; n < 3; n++) await Promise.resolve();
	expect(closeWindow).toHaveBeenCalledOnce();
	expect(state.settings.get(pendingKey)).toBe(false);
	expect(render()?.props.open).toBe(true);
	releaseClose();
	for (let n = 0; n < 10; n++) await Promise.resolve();
	expect(render()?.props.open).toBe(false);
});

it("persists the dev dismissal before native destruction and restores it if close rejects", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
	state.settings.set(pendingKey, true);
	closeWindow.mockImplementationOnce(async () => {
		expect(state.settings.get("recordly.dev.onboardingDismissed")).toBe(true);
		expect(render()?.props.open).toBe(true);
		throw new Error("Close unavailable");
	});
	render();
	render()?.props.onAuthenticated();
	for (let n = 0; n < 10; n++) await Promise.resolve();
	expect(render()?.props).toMatchObject({ open: true, preview: true });
	expect(state.settings.get("recordly.dev.onboardingDismissed")).not.toBe(true);
	expect(state.settings.get(pendingKey)).toBe(true);
	closeWindow.mockImplementation(async () => {
		expect(state.settings.get("recordly.dev.onboardingDismissed")).toBe(true);
	});
	render()?.props.onAuthenticated();
	for (let n = 0; n < 10; n++) await Promise.resolve();
	expect(state.settings.get("recordly.dev.onboardingDismissed")).toBe(true);
	expect(state.settings.get(pendingKey)).toBe(true);
	expect(render()?.props.open).toBe(false);
	error.mockRestore();
});

it("opens production permission recovery only once for each new request nonce", () => {
	vi.stubEnv("DEV", false);
	window.location.search = "?windowType=editor";
	state.settings.set(seenKey, true);
	vi.mocked(window.electronAPI.showOnboardingWindow).mockResolvedValue(true);
	render({ standalone: false, requestNonce: 1 });
	render({ standalone: false, requestNonce: 1, user: { ...user } });
	expect(state.settings.get(pendingKey)).toBe(true);
	expect(window.electronAPI.showOnboardingWindow).toHaveBeenCalledExactlyOnceWith({
		preview: false,
	});
	render({ standalone: false, requestNonce: 2 });
	render({ standalone: false, requestNonce: 2, user: { ...user } });
	expect(window.electronAPI.showOnboardingWindow).toHaveBeenCalledTimes(2);
	expect(vi.mocked(window.electronAPI.showOnboardingWindow).mock.calls[1]).toEqual([
		{ preview: false },
	]);
	expect(state.settings.get(seenKey)).toBe(true);
	expect(state.writes.some(([key]) => key === seenKey)).toBe(false);
});

it("opens real permission recovery from a native event even after the dev tour was dismissed", async () => {
	window.location.search = "?windowType=editor";
	state.settings.set(seenKey, true);
	state.settings.set("recordly.dev.onboardingDismissed", true);
	render({ standalone: false });
	expect(window.electronAPI.showOnboardingWindow).not.toHaveBeenCalled();
	const requestPermissions = vi
		.mocked(window.electronAPI.onRecordingPermissionsRequested)
		.mock.calls.at(-1)?.[0];
	expect(requestPermissions).toBeTypeOf("function");
	requestPermissions!();
	expect(state.settings.get(pendingKey)).toBe(true);
	expect(window.electronAPI.showOnboardingWindow).toHaveBeenCalledExactlyOnceWith({
		preview: false,
	});
	await vi.waitFor(() => {
		const recovery = render({ standalone: false });
		expect(recovery?.type).toBe(RecordingPermissionsDialog);
		expect(recovery?.props.open).toBe(true);
	});
	expect(window.electronAPI.showOnboardingWindow).toHaveBeenCalledOnce();
	expect(state.settings.get(seenKey)).toBe(true);
	expect(state.settings.get("recordly.dev.onboardingDismissed")).toBe(true);
	expect(
		state.writes.some(([key]) => key === seenKey || key === "recordly.dev.onboardingDismissed"),
	).toBe(false);
});
