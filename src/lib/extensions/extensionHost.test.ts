import { describe, expect, it } from "vitest";
import { ExtensionHost } from "./extensionHost";
import type { RecordlyExtensionAPI } from "./types";

interface ExtensionHostPrivateApi {
	createAPI(
		extensionId: string,
		extensionPath: string,
		permissions: string[],
		disposables: (() => void)[],
	): RecordlyExtensionAPI;
}

function createAudioApi(host: ExtensionHost): RecordlyExtensionAPI {
	return (host as unknown as ExtensionHostPrivateApi).createAPI(
		"com.test.click-sound",
		"/tmp/recordly-extension",
		["audio"],
		[],
	);
}

describe("ExtensionHost export audio capture", () => {
	it("captures playSound calls as export audio cues", () => {
		const host = new ExtensionHost();
		const api = createAudioApi(host);

		host.beginExportAudioCapture();
		host.setExportAudioCaptureTime(1234.4);
		const stop = api.playSound("sounds/click.mp3", { volume: 0.8 });
		const cues = host.finishExportAudioCapture();

		expect(typeof stop).toBe("function");
		expect(cues).toEqual([
			{
				id: "com.test.click-sound-sound-0",
				extensionId: "com.test.click-sound",
				timeMs: 1234,
				audioPath: "file:///tmp/recordly-extension/sounds/click.mp3",
				volume: 0.8,
			},
		]);
	});

	it("lets a captured sound be stopped before export regions are finalized", () => {
		const host = new ExtensionHost();
		const api = createAudioApi(host);

		host.beginExportAudioCapture();
		host.setExportAudioCaptureTime(100);
		const stop = api.playSound("sounds/click.mp3");
		stop();

		expect(host.finishExportAudioCapture()).toEqual([]);
	});

	it("ignores export playSound calls until an export capture time is set", () => {
		const host = new ExtensionHost();
		const api = createAudioApi(host);

		host.beginExportAudioCapture();
		api.playSound("sounds/click.mp3");

		expect(host.finishExportAudioCapture()).toEqual([]);
	});

	it("clamps negative export capture times to zero", () => {
		const host = new ExtensionHost();
		const api = createAudioApi(host);

		host.beginExportAudioCapture();
		host.setExportAudioCaptureTime(-10);
		api.playSound("sounds/click.mp3");

		expect(host.finishExportAudioCapture()[0]).toMatchObject({ timeMs: 0 });
	});

	it("does not capture sounds for non-finite export capture times", () => {
		const host = new ExtensionHost();
		const api = createAudioApi(host);

		host.beginExportAudioCapture();
		host.setExportAudioCaptureTime(Number.NaN);
		api.playSound("sounds/click.mp3");
		host.setExportAudioCaptureTime(Number.POSITIVE_INFINITY);
		api.playSound("sounds/click.mp3");

		expect(host.finishExportAudioCapture()).toEqual([]);
	});
});
