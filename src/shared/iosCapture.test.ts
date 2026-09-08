import { describe, expect, it } from "vitest";
import {
	IOS_CAPTURE_CAPABILITIES,
	isIOSDeviceSource,
	parseIOSCaptureCommand,
	parseIOSCaptureEvent,
	parseNativeIOSCaptureCommand,
	validateNativeTime,
} from "./iosCapture";

const source = {
	sourceType: "ios-device" as const,
	id: "ios-device:device_a",
	deviceToken: "device_a",
	displayName: "Phone",
	generation: 1,
	deviceAudio: "unknown" as const,
};

describe("iOS capture contracts", () => {
	it("does not mistake an ios source for a desktop source", () => {
		expect(isIOSDeviceSource(source)).toBe(true);
		expect(isIOSDeviceSource({ id: "screen:1", name: "Screen" })).toBe(false);
		expect(isIOSDeviceSource({ sourceType: "ios-device", id: "screen:1" })).toBe(false);
	});

	it("rejects malformed device identity and inventory generations", () => {
		expect(isIOSDeviceSource({ ...source, deviceToken: "../phone" })).toBe(false);
		expect(isIOSDeviceSource({ ...source, displayName: "x".repeat(257) })).toBe(false);
		expect(isIOSDeviceSource({ ...source, generation: -1 })).toBe(false);
		expect(isIOSDeviceSource({ ...source, generation: 1.5 })).toBe(false);
		expect(isIOSDeviceSource({ ...source, unexpected: true })).toBe(false);
	});

	it("validates bounded signed rational native time", () => {
		expect(validateNativeTime({ value: "-9223372036854775808", timescale: 1 })).toBe(true);
		expect(validateNativeTime({ value: "9223372036854775807", timescale: 1_000_000_000 })).toBe(
			true,
		);
		expect(validateNativeTime({ value: "9223372036854775808", timescale: 1 })).toBe(false);
		expect(validateNativeTime({ value: "1.5", timescale: 1_000 })).toBe(false);
		expect(validateNativeTime({ value: "1", timescale: 0 })).toBe(false);
		expect(validateNativeTime({ value: "1", timescale: 1.5 })).toBe(false);
		expect(validateNativeTime({ value: "1", timescale: 1_000_000_001 })).toBe(false);
	});

	it("rejects unknown protocol versions, commands, extra keys and renderer paths", () => {
		expect(() =>
			parseIOSCaptureCommand({ protocolVersion: 2, requestId: "r1", command: "hello" }),
		).toThrow();
		expect(() =>
			parseIOSCaptureCommand({ protocolVersion: 1, requestId: "r1", command: "erase" }),
		).toThrow();
		expect(() =>
			parseIOSCaptureCommand({
				protocolVersion: 1,
				requestId: "r1",
				command: "hello",
				executable: "/tmp/x",
			}),
		).toThrow();
		expect(() =>
			parseIOSCaptureCommand({
				protocolVersion: 1,
				requestId: "r1",
				command: "prepare",
				generation: 1,
				payload: {
					deviceToken: "device_a",
					options: { deviceAudio: false, microphoneToken: null },
					outputPath: "/tmp/untrusted.mov",
				},
			}),
		).toThrow();
	});

	it("accepts strict renderer commands and only the native parser accepts storage capability", () => {
		const rendererCommand = {
			protocolVersion: 1 as const,
			requestId: "r1",
			command: "prepare" as const,
			generation: 1,
			payload: {
				deviceToken: "device_a",
				options: { deviceAudio: true, microphoneToken: "mic_1" },
			},
		};
		expect(parseIOSCaptureCommand(rendererCommand)).toEqual(rendererCommand);
		const nativeCommand = {
			...rendererCommand,
			sessionId: "3d594650-3436-4a5a-b6a7-5ff45ecf73d0",
			payload: {
				...rendererCommand.payload,
				inventoryGeneration: rendererCommand.generation,
			},
			storage: {
				sessionRoot: "/approved/ios-session",
				allowedRelativeNames: ["source-video.mov", "native-timing.json"],
			},
		};
		expect(() => parseIOSCaptureCommand(nativeCommand)).toThrow();
		expect(parseNativeIOSCaptureCommand(nativeCommand)).toEqual(nativeCommand);
		expect(() =>
			parseNativeIOSCaptureCommand({
				...nativeCommand,
				storage: { ...nativeCommand.storage, allowedRelativeNames: ["../escape.mov"] },
			}),
		).toThrow();
	});

	it("rejects stale session structure and oversized identifiers", () => {
		expect(() =>
			parseIOSCaptureCommand({
				protocolVersion: 1,
				requestId: "x".repeat(129),
				command: "hello",
			}),
		).toThrow();
		expect(() =>
			parseIOSCaptureCommand({
				protocolVersion: 1,
				requestId: "r1",
				command: "start",
				sessionId: "not-a-uuid",
			}),
		).toThrow();
		expect(() =>
			parseIOSCaptureCommand({
				protocolVersion: 1,
				requestId: "r1",
				command: "start",
				sessionId: "3d594650-3436-4a5a-b6a7-5ff45ecf73d0",
				generation: 0,
			}),
		).toThrow();
	});

	it("parses a complete native-finalized event and rejects unknown metadata", () => {
		const event = {
			protocolVersion: 1 as const,
			event: "nativeFinalized" as const,
			sequence: 7,
			sessionId: "3d594650-3436-4a5a-b6a7-5ff45ecf73d0",
			generation: 2,
			payload: {
				result: {
					sessionId: "3d594650-3436-4a5a-b6a7-5ff45ecf73d0",
					stopReason: "user",
					format: {
						codedWidth: 1179,
						codedHeight: 2556,
						displayWidth: 1179,
						displayHeight: 2556,
						codec: "h264",
						colorPrimaries: null,
						transferFunction: null,
						ycbcrMatrix: null,
						fullRange: null,
						transform: [1, 0, 0, 1, 0, 0],
						observedFrameRate: 59.94,
						fingerprint: "fmt_1",
					},
					mode: "passthrough",
					video: {
						relativeName: "source-video.mov",
						mediaKind: "video",
						firstHostTime: { value: "100000", timescale: 1000 },
						duration: { value: "5000", timescale: 1000 },
						sampleCount: 300,
						mediaFormat: { codec: "h264", width: 1179, height: 2556 },
					},
					timingFile: "native-timing.json",
					timing: {
						version: 1,
						timeline: "host-mapped",
						gapsRepresentedInMedia: true,
						streams: [
							{
								mediaKind: "video",
								firstHostTime: { value: "100000", timescale: 1000 },
								duration: { value: "5000", timescale: 1000 },
								rate: { numerator: "1", denominator: "1" },
								clockAnchor: {
									hostTime: { value: "100000", timescale: 1000 },
									mediaTime: { value: "0", timescale: 1000 },
								},
								gaps: [],
							},
						],
					},
				},
			},
		};
		expect(parseIOSCaptureEvent(event)).toEqual(event);
		expect(() =>
			parseIOSCaptureEvent({
				...event,
				payload: { ...event.payload, executable: "/tmp/helper" },
			}),
		).toThrow();
		expect(() =>
			parseIOSCaptureEvent({
				...event,
				payload: { result: { ...event.payload.result, videoPath: "/tmp/video.mov" } },
			}),
		).toThrow();
	});

	it("publishes fixed capture capabilities", () => {
		expect(IOS_CAPTURE_CAPABILITIES).toEqual({
			supportsPause: false,
			supportsWebcam: false,
			supportsTouchTelemetry: false,
			previewMaxLongestEdge: 480,
			previewMaxFramesPerSecond: 5,
			previewMaxJpegBytes: 128 * 1024,
			protocolVersion: 1,
		});
	});

	it("accepts hello capabilities independently of JSON key order", () => {
		const reversedCapabilities = Object.fromEntries(
			Object.entries(IOS_CAPTURE_CAPABILITIES).reverse(),
		);
		expect(
			parseIOSCaptureEvent({
				protocolVersion: 1,
				event: "accepted",
				sequence: 1,
				requestId: "r1",
				payload: { build: "dev", protocolVersion: 1, capabilities: reversedCapabilities },
			}).event,
		).toBe("accepted");
	});
});
