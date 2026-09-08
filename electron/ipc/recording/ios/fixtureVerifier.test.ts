import { expect, it } from "vitest";
const verifierPath = new URL("../../../../scripts/verify-ios-capture-fixture.mjs", import.meta.url)
	.href;
const fixture = {
	fixtureVersion: 1,
	name: "test",
	sessionId: "3d594650-3436-4a5a-b6a7-5ff45ecf73d0",
	videoFile: "recording.mov",
	videoMode: "passthrough",
	durationMs: 4000,
	durationToleranceMs: 50,
	displayGeometry: { width: 240, height: 426, transform: [1, 0, 0, 1, 0, 0] },
	audio: {
		required: true,
		channels: 1,
		eventToleranceMs: 80,
		streams: [{ kind: "microphone", eventTimesMs: [500, 2000] }],
	},
	expectedVideoSamples: 40,
	permittedSampleLoss: 0,
	sourceColour: {
		colorPrimaries: null,
		transferFunction: null,
		ycbcrMatrix: null,
		fullRange: null,
	},
	terminalStatus: "completed",
	provenance: "Synthetic generated fixture; CC0-1.0",
	compareSourceVideoPayload: true,
};
const observation = {
	inspection: {
		decodable: true,
		duration: { value: "4000", timescale: 1000 },
		video: {
			displayWidth: 240,
			displayHeight: 426,
			transform: [1, 0, 0, 1, 0, 0],
			colorPrimaries: null,
			transferFunction: null,
			ycbcrMatrix: null,
			fullRange: null,
		},
		audio: { channels: 1, sampleRate: 48000 },
	},
	decodeSucceeded: true,
	decodedVideoSamples: 40,
	audioEventTimesMs: [500, 2000],
	videoMode: "passthrough",
	terminalStatus: "completed",
	sourcePayloadHash: "same",
	finalPayloadHash: "same",
};
it("rejects unknown/missing CLI args and malformed expectations", async () => {
	const { parseArguments, validateExpected } = await import(verifierPath);
	expect(() => parseArguments(["--session-dir", "/tmp"])).toThrow();
	expect(() => parseArguments(["--unknown", "x"])).toThrow();
	expect(() => validateExpected({ ...fixture, durationMs: -1 })).toThrow();
});
it("reports honest failed checks for rotation, displaced/missing audio, wrong duration and truncation", async () => {
	const { evaluateFixture } = await import(verifierPath);
	expect(evaluateFixture(fixture, observation).passed).toBe(true);
	for (const changed of [
		{
			inspection: {
				...observation.inspection,
				video: { ...observation.inspection.video, transform: [0, 1, -1, 0, 426, 0] },
			},
		},
		{ audioEventTimesMs: [750, 2250] },
		{ inspection: { ...observation.inspection, audio: undefined } },
		{ inspection: { ...observation.inspection, duration: { value: "2000", timescale: 1000 } } },
		{ decodeSucceeded: false },
		{ decodedVideoSamples: 39 },
		{ finalPayloadHash: "different" },
	]) {
		const report = evaluateFixture(fixture, { ...observation, ...changed });
		expect(report.passed).toBe(false);
		expect(report.checks.some((check: { passed: boolean }) => !check.passed)).toBe(true);
	}
});

it("measures displaced soundtrack events in the video timeline with real FFmpeg", async (context) => {
	const fs = await import("node:fs/promises");
	const { existsSync } = await import("node:fs");
	const path = await import("node:path");
	const os = await import("node:os");
	const { execFileSync } = await import("node:child_process");
	const binary = path.resolve(
		"node_modules/ffmpeg-static",
		process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
	);
	if (!existsSync(binary)) {
		context.skip();
		return;
	}
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ios-fixture-audio-"));
	try {
		const source = path.join(directory, "source.mov");
		const shifted = path.join(directory, "shifted.mov");
		execFileSync(binary, [
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=64x96:r=10:d=2",
			"-f",
			"lavfi",
			"-i",
			"aevalsrc=0.8*sin(2*PI*1000*t)*between(t\\,0.5\\,0.51):s=48000:d=2",
			"-c:v",
			"libx264",
			"-c:a",
			"aac",
			source,
		]);
		execFileSync(binary, [
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			source,
			"-itsoffset",
			"0.25",
			"-i",
			source,
			"-map",
			"0:v:0",
			"-map",
			"1:a:0",
			"-c",
			"copy",
			shifted,
		]);
		const { decodeFixtureAudio } = await import(verifierPath);
		const normal = await decodeFixtureAudio(binary, source),
			displaced = await decodeFixtureAudio(binary, shifted);
		expect(normal[0]).toBeCloseTo(500, 0);
		expect(Math.abs(displaced[0] - normal[0] - 250)).toBeLessThan(2);
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});
