import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => {
	const slots: unknown[] = [];
	let cursor = 0;
	let effects: (() => void)[] = [];
	return {
		reset() {
			slots.length = 0;
			cursor = 0;
			effects = [];
		},
		render<T>(render: () => T): T {
			cursor = 0;
			effects = [];
			const value = render();
			for (const effect of effects) effect();
			return value;
		},
		useCallback: <T>(value: T) => value,
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
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), ...hooks }));
vi.mock("@/lib/auth/recordlyAuth", () => ({ hasRecordlySession: async () => true }));
import { useRecorderPreferences } from "./useRecorderPreferences";

let preferences!: (value: unknown) => void;
let countdown!: (value: unknown) => void;
const savedPreferences = vi.fn();
const savedCountdown = vi.fn();
beforeEach(() => {
	hooks.reset();
	vi.clearAllMocks();
	const pendingPreferences = new Promise((resolve) => {
		preferences = resolve;
	});
	const pendingCountdown = new Promise((resolve) => {
		countdown = resolve;
	});
	vi.stubGlobal("window", {
		electronAPI: {
			getPlatform: async () => "darwin",
			getRecordingPreferences: () => pendingPreferences,
			getCountdownDelay: () => pendingCountdown,
			setRecordingPreferences: savedPreferences,
			setCountdownDelay: savedCountdown,
		},
	});
});
afterEach(() => vi.unstubAllGlobals());
const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
};
const stored = {
	success: true,
	microphoneEnabled: false,
	microphoneDeviceId: "stored-mic",
	systemAudioEnabled: true,
	webcamEnabled: true,
	webcamDeviceId: "stored-camera",
};

it("preserves immediate edits while restoring untouched fields from delayed preferences", async () => {
	const initial = hooks.render(useRecorderPreferences);
	initial.persistMicrophoneEnabled(true);
	initial.persistMicrophoneDeviceId("chosen-mic");
	initial.persistWebcamEnabled(false);
	initial.setCountdownDelay(0);
	preferences(stored);
	countdown({ success: true, delay: 5 });
	await flush();
	const current = hooks.render(useRecorderPreferences);
	expect(current).toMatchObject({
		microphoneEnabled: true,
		microphoneDeviceId: "chosen-mic",
		webcamEnabled: false,
		countdownDelay: 0,
		systemAudioEnabled: true,
		webcamDeviceId: "stored-camera",
	});
	expect(savedPreferences.mock.calls).toEqual([
		[{ microphoneEnabled: true }],
		[{ microphoneDeviceId: "chosen-mic" }],
		[{ webcamEnabled: false }],
	]);
	expect(savedCountdown).toHaveBeenCalledExactlyOnceWith(0);
});

it("preserves explicit false/default-device edits even when state values have not changed", async () => {
	const initial = hooks.render(useRecorderPreferences);
	initial.setMicrophoneEnabled(false);
	initial.persistSystemAudioEnabled(false);
	initial.persistWebcamDeviceId(undefined);
	preferences({ ...stored, microphoneEnabled: true });
	countdown({ success: true, delay: 0 });
	await flush();
	const current = hooks.render(useRecorderPreferences);
	expect(current).toMatchObject({
		microphoneEnabled: false,
		systemAudioEnabled: false,
		webcamDeviceId: undefined,
		microphoneDeviceId: "stored-mic",
		webcamEnabled: true,
		countdownDelay: 0,
	});
	expect(savedPreferences.mock.calls).toEqual([
		[{ systemAudioEnabled: false }],
		[{ webcamDeviceId: undefined }],
	]);
});
