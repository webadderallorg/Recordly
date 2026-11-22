import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initializeEncoder } from "./legacyVideoEncoding";
import { probeSupportedMp4Dimensions } from "./mp4Support";

const support = vi.fn();
let callbacks: VideoEncoderInit;
class Encoder {
	static isConfigSupported = support;
	configure = vi.fn();
	constructor(init: VideoEncoderInit) {
		callbacks = init;
	}
}
function context() {
	return {
		config: {
			codec: "avc1.640033",
			videoUrl: "/source.mp4",
			width: 3840,
			height: 2160,
			frameRate: 60,
			bitrate: 12000000,
		},
		muxer: { addVideoChunk: vi.fn(async () => undefined) },
		cancelled: false,
	} as unknown as Parameters<typeof initializeEncoder>[0];
}
beforeEach(() => {
	support.mockReset();
	vi.stubGlobal("VideoEncoder", Encoder);
});
afterEach(() => vi.unstubAllGlobals());
it("uses the full-size probed fallback codec and writes that codec into muxer metadata", async () => {
	support.mockImplementation(async (config: VideoEncoderConfig) => ({
		supported: config.codec === "avc1.640034",
		config,
	}));
	const probed = await probeSupportedMp4Dimensions({
		width: 3840,
		height: 2160,
		frameRate: 60,
		getBitrate: () => 12000000,
	});
	expect(probed).toMatchObject({ capped: false, encoderPath: { codec: "avc1.640034" } });
	const state = context();
	state.config.preferredEncoderPath = probed.encoderPath;
	await initializeEncoder(state);
	expect(vi.mocked(state.encoder!.configure)).toHaveBeenCalledWith(
		expect.objectContaining({ codec: "avc1.640034", width: 3840, height: 2160, framerate: 60 }),
	);
	state.encodeQueue = 1;
	callbacks.output({} as EncodedVideoChunk, {
		decoderConfig: {
			codec: "avc1.640034",
			description: new Uint8Array([1, 2]),
			codedWidth: 3840,
			codedHeight: 2160,
		},
	});
	await state.pendingMuxing;
	expect(state.muxer!.addVideoChunk).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			decoderConfig: expect.objectContaining({ codec: "avc1.640034" }),
		}),
	);
});
it("retains the configured codec as fallback when the preferred path is no longer supported", async () => {
	const state = context();
	state.config.preferredEncoderPath = {
		codec: "avc1.640034",
		hardwareAcceleration: "prefer-hardware",
	};
	support.mockImplementation(async (config: VideoEncoderConfig) => ({
		supported: config.codec === "avc1.640033",
		config,
	}));
	await initializeEncoder(state);
	expect(support.mock.calls[0][0].codec).toBe("avc1.640034");
	expect(state.encoder!.configure).toHaveBeenCalledWith(
		expect.objectContaining({ codec: "avc1.640033" }),
	);
});
it("tries compatibility codecs after unsupported profiles throw", async () => {
	support.mockImplementation(async (config: VideoEncoderConfig) => {
		if (config.codec !== "avc1.4d401f") throw new TypeError("Unsupported profile");
		return { supported: config.hardwareAcceleration === "prefer-software", config };
	});
	const state = context();
	await initializeEncoder(state);
	expect(state.encoder!.configure).toHaveBeenCalledWith(
		expect.objectContaining({ codec: "avc1.4d401f", hardwareAcceleration: "prefer-software" }),
	);
});
it("reports failure when no full-size codec is supported", async () => {
	support.mockResolvedValue({ supported: false });
	const state = context();
	await expect(initializeEncoder(state)).rejects.toThrow("Video encoding not supported");
	expect(state.encoder!.configure).not.toHaveBeenCalled();
});
