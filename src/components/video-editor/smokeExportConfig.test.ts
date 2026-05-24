import { describe, expect, it } from "vitest";

import { getDevOpenRecordingConfig, getSmokeExportConfig } from "./smokeExportConfig";

describe("getSmokeExportConfig", () => {
	it("keeps smoke export disabled when the flag is absent", () => {
		expect(getSmokeExportConfig("?smokeInput=/tmp/input.mp4")).toEqual({
			enabled: false,
			inputPath: null,
			outputPath: null,
			useNativeExport: false,
			encodingMode: undefined,
			shadowIntensity: undefined,
			webcamInputPath: null,
			webcamShadow: undefined,
			webcamSize: undefined,
			pipelineModel: undefined,
			backendPreference: undefined,
			renderBackend: undefined,
			maxEncodeQueue: undefined,
			maxDecodeQueue: undefined,
			maxPendingFrames: undefined,
			projectPath: null,
			quality: undefined,
			fps: undefined,
		});
	});

	it("parses the enabled smoke export query contract", () => {
		const config = getSmokeExportConfig(
			"?smokeExport=1" +
				"&smokeInput=/tmp/input.mp4" +
				"&smokeOutput=/tmp/output.mp4" +
				"&smokeUseNativeExport=1" +
				"&smokeEncodingMode=quality" +
				"&smokeShadowIntensity=0" +
				"&smokeWebcamInput=/tmp/webcam.mp4" +
				"&smokeWebcamShadow=1.5" +
				"&smokeWebcamSize=0.75" +
				"&smokePipelineModel=legacy" +
				"&smokeBackendPreference=breeze" +
				"&smokeRenderBackend=webgpu" +
				"&smokeMaxEncodeQueue=8" +
				"&smokeMaxDecodeQueue=9" +
				"&smokeMaxPendingFrames=10" +
				"&smokeProject=/tmp/project.recordly" +
				"&smokeQuality=source" +
				"&smokeFps=60",
		);

		expect(config).toEqual({
			enabled: true,
			inputPath: "/tmp/input.mp4",
			outputPath: "/tmp/output.mp4",
			useNativeExport: true,
			encodingMode: "quality",
			shadowIntensity: 0,
			webcamInputPath: "/tmp/webcam.mp4",
			webcamShadow: 1.5,
			webcamSize: 0.75,
			pipelineModel: "legacy",
			backendPreference: "breeze",
			renderBackend: "webgpu",
			maxEncodeQueue: 8,
			maxDecodeQueue: 9,
			maxPendingFrames: 10,
			projectPath: "/tmp/project.recordly",
			quality: "source",
			fps: 60,
		});
	});

	it("drops invalid optional smoke export values", () => {
		const config = getSmokeExportConfig(
			"?smokeExport=1" +
				"&smokeEncodingMode=slow" +
				"&smokeShadowIntensity=-1" +
				"&smokeWebcamShadow=nan" +
				"&smokeWebcamSize=-0.1" +
				"&smokePipelineModel=classic" +
				"&smokeBackendPreference=native" +
				"&smokeRenderBackend=canvas" +
				"&smokeMaxEncodeQueue=0" +
				"&smokeMaxDecodeQueue=-4" +
				"&smokeMaxPendingFrames=abc" +
				"&smokeQuality=ultra" +
				"&smokeFps=25",
		);

		expect(config).toMatchObject({
			enabled: true,
			useNativeExport: false,
			encodingMode: undefined,
			shadowIntensity: undefined,
			webcamShadow: undefined,
			webcamSize: undefined,
			pipelineModel: undefined,
			backendPreference: undefined,
			renderBackend: undefined,
			maxEncodeQueue: undefined,
			maxDecodeQueue: undefined,
			maxPendingFrames: undefined,
			quality: undefined,
			fps: undefined,
		});
	});
});

describe("getDevOpenRecordingConfig", () => {
	it("reads dev-open paths independently from smoke export", () => {
		expect(
			getDevOpenRecordingConfig(
				"?devOpenInput=/tmp/input.mp4&devOpenWebcam=/tmp/webcam.mp4",
			),
		).toEqual({
			inputPath: "/tmp/input.mp4",
			webcamInputPath: "/tmp/webcam.mp4",
		});
	});
});
