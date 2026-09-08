import { afterEach, expect, it, vi } from "vitest";
import type { IOSCaptureEvent } from "../../../../src/shared/iosCapture";
import { getRecordingLease } from "../recordingLease";
import { IOSCaptureController, type IOSControllerDependencies } from "./controller";
import type { IOSHelperTransport } from "./helperProcess";
import type { IOSSessionStorage } from "./storage";

const source = {
	sourceType: "ios-device",
	id: "ios-device:phone",
	deviceToken: "phone",
	displayName: "Phone",
	generation: 1,
	deviceAudio: "unknown",
} as const;
const controllers: IOSCaptureController[] = [];
function transport() {
	const listeners = new Set<(event: IOSCaptureEvent) => void>();
	let sequence = 0;
	const helper: IOSHelperTransport = {
		request: vi.fn(async (input) => {
			if (input.command === "discover")
				queueMicrotask(() => {
					const event: IOSCaptureEvent = {
						protocolVersion: 1,
						event: "inventoryChanged",
						sequence: ++sequence,
						payload: { devices: [source], microphones: [], inventoryGeneration: 1 },
					};
					for (const listener of listeners) listener(event);
				});
			return {
				protocolVersion: 1,
				event: "accepted",
				requestId: "test",
				sequence: ++sequence,
				payload: {},
			};
		}),
		onEvent: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		onExit: () => () => undefined,
		onPreview: () => () => undefined,
		shutdown: vi.fn(async () => undefined),
	};
	return helper;
}
function controller(overrides: Partial<IOSControllerDependencies>) {
	const instance = new IOSCaptureController({
		enabled: true,
		createHelper: async () => transport(),
		allocate: async () => {
			throw new Error("allocation unexpected");
		},
		permissions: async () => undefined,
		finalize: async () => {
			throw new Error("finalization unexpected");
		},
		discard: async () => undefined,
		onCommitted: () => undefined,
		...overrides,
	});
	controllers.push(instance);
	return instance;
}
afterEach(async () => {
	for (const instance of controllers.splice(0)) await instance.shutdown();
});

it("shutdown waits for a pending helper creation and closes it before any hello or discover command", async () => {
	let created!: (helper: IOSHelperTransport) => void;
	const creation = new Promise<IOSHelperTransport>((resolve) => {
		created = resolve;
	});
	const instance = controller({ createHelper: () => creation });
	const discovery = instance.discover();
	const rejected = expect(discovery).rejects.toThrow("HELPER_UNAVAILABLE");
	let stopped = false;
	const shutdown = instance.shutdown().then(() => {
		stopped = true;
	});
	await Promise.resolve();
	expect(stopped).toBe(false);
	const helper = transport();
	created(helper);
	await Promise.all([rejected, shutdown]);
	expect(helper.request).not.toHaveBeenCalled();
	expect(helper.shutdown).toHaveBeenCalledOnce();
	expect(getRecordingLease()).toBeNull();
});

it("cancelling while allocation is pending deletes only the newly allocated empty session and cannot reopen inputs", async () => {
	let allocated!: (storage: IOSSessionStorage) => void;
	const allocation = new Promise<IOSSessionStorage>((resolve) => {
		allocated = resolve;
	});
	const helper = transport();
	const discard = vi.fn(async () => undefined);
	const instance = controller({
		createHelper: async () => helper,
		allocate: () => allocation,
		discard,
	});
	await instance.discover();
	const preparation = instance.prepare({
		deviceToken: "phone",
		generation: 1,
		options: { deviceAudio: false, microphoneToken: null },
	});
	const rejected = expect(preparation).rejects.toThrow("INVALID_REQUEST");
	await Promise.resolve();
	const sessionId = instance.getSnapshot().sessionId!;
	await instance.release(sessionId);
	const storage = {
		sessionId,
		directory: `/tmp/ios-${sessionId}`,
		journalPath: `/tmp/ios-${sessionId}/capture-journal.json`,
	};
	allocated(storage);
	await rejected;
	expect(discard).toHaveBeenCalledExactlyOnceWith(storage);
	expect(
		vi.mocked(helper.request).mock.calls.some(([request]) => request.command === "prepare"),
	).toBe(false);
	expect(instance.getSnapshot()).toMatchObject({ phase: "idle", sessionId: null });
	expect(getRecordingLease()).toBeNull();
});
