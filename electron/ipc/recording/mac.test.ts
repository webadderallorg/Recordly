import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: () => "/tmp/recordly-test" },
	BrowserWindow: { getAllWindows: () => [] },
}));

import {
	assertRequestedMacSystemAudioArtifact,
	createMacAudioCapturePlan,
	waitForNativeCaptureStart,
} from "./mac";

describe("waitForNativeCaptureStart", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns the time when the helper reports capture readiness", async () => {
		const child = new EventEmitter() as EventEmitter & {
			stdout: EventEmitter;
		};
		child.stdout = new EventEmitter();
		vi.spyOn(Date, "now").mockReturnValue(123456);

		const ready = waitForNativeCaptureStart(child as never);
		child.stdout.emit("data", Buffer.from("Recording started\n"));

		await expect(ready).resolves.toBe(123456);
	});
});

describe("createMacAudioCapturePlan", () => {
	it("keeps system sound native and always routes a requested microphone through Chromium", () => {
		expect(
			createMacAudioCapturePlan({
				capturesSystemAudio: true,
				capturesMicrophone: true,
			}),
		).toEqual({
			capturesSystemAudio: true,
			capturesMicrophoneNatively: false,
			browserMicrophoneRequired: true,
		});
	});

	it("does not manufacture audio capture when both sources are disabled", () => {
		expect(
			createMacAudioCapturePlan({
				capturesSystemAudio: false,
				capturesMicrophone: false,
			}),
		).toEqual({
			capturesSystemAudio: false,
			capturesMicrophoneNatively: false,
			browserMicrophoneRequired: false,
		});
	});
});

describe("assertRequestedMacSystemAudioArtifact", () => {
	it("rejects a recording that silently lost its requested system-audio sidecar", () => {
		expect(() =>
			assertRequestedMacSystemAudioArtifact({
				requested: true,
				path: "/tmp/recording.system.m4a",
				fileSizeBytes: null,
			}),
		).toThrow(/system audio/i);
	});

	it("accepts a non-empty requested system-audio sidecar", () => {
		expect(() =>
			assertRequestedMacSystemAudioArtifact({
				requested: true,
				path: "/tmp/recording.system.m4a",
				fileSizeBytes: 4096,
			}),
		).not.toThrow();
	});

	it("does not require a sidecar when system sound was disabled", () => {
		expect(() =>
			assertRequestedMacSystemAudioArtifact({
				requested: false,
				path: null,
				fileSizeBytes: null,
			}),
		).not.toThrow();
	});
});
