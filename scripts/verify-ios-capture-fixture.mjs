import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function resolveFixtureFFmpeg() {
	try {
		const binary = require("ffmpeg-static");
		if (typeof binary === "string" && existsSync(binary)) return binary;
	} catch {
		/* Optional evidence unavailable; retain explicit fallback. */
	}
	const lookup = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], {
		encoding: "utf8",
		shell: false,
	});
	const candidates = [
		...(lookup.status === 0 ? lookup.stdout.trim().split(/\r?\n/) : []),
		"/opt/homebrew/bin/ffmpeg",
		"/usr/local/bin/ffmpeg",
		"/usr/bin/ffmpeg",
	];
	const binary = candidates.find((p) => p && existsSync(p));
	if (!binary) throw new Error("FFmpeg is unavailable");
	return binary;
}
export function parseArguments(args) {
	const result = {};
	const allowed = new Set(["session-dir", "expected", "report"]);
	for (let i = 0; i < args.length; i += 2) {
		const key = args[i]?.replace(/^--/, "");
		if (
			!args[i]?.startsWith("--") ||
			!allowed.has(key) ||
			result[key] ||
			!args[i + 1] ||
			args[i + 1].startsWith("--")
		)
			throw new Error("Expected --session-dir, --expected and --report exactly once");
		result[key] = args[i + 1];
	}
	if ([...allowed].some((key) => !result[key] || !path.isAbsolute(result[key])))
		throw new Error("All three named arguments must be absolute paths");
	return result;
}
const finite = (n) => typeof n === "number" && Number.isFinite(n);
export function validateExpected(expected) {
	if (
		!expected ||
		expected.fixtureVersion !== 1 ||
		typeof expected.name !== "string" ||
		!expected.name ||
		!["passthrough", "h264-encode"].includes(expected.videoMode) ||
		!finite(expected.durationMs) ||
		expected.durationMs <= 0 ||
		!finite(expected.durationToleranceMs) ||
		expected.durationToleranceMs < 0
	)
		throw new Error("Invalid fixture expectations");
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			expected.sessionId,
		) ||
		!["recording.mov", "source-video.mov"].includes(expected.videoFile)
	)
		throw new Error("Invalid fixture session");
	const geometry = expected.displayGeometry;
	if (
		!geometry ||
		!finite(geometry.width) ||
		geometry.width <= 0 ||
		!finite(geometry.height) ||
		geometry.height <= 0 ||
		!Array.isArray(geometry.transform) ||
		geometry.transform.length !== 6 ||
		!geometry.transform.every(finite)
	)
		throw new Error("Invalid display geometry");
	const audio = expected.audio;
	if (
		!audio ||
		typeof audio.required !== "boolean" ||
		![1, 2].includes(audio.channels) ||
		!finite(audio.eventToleranceMs) ||
		audio.eventToleranceMs < 0 ||
		audio.eventToleranceMs > 80 ||
		!Array.isArray(audio.streams) ||
		audio.streams.length > 2
	)
		throw new Error("Invalid audio expectations");
	for (const stream of audio.streams)
		if (
			!["device-audio", "microphone"].includes(stream.kind) ||
			!Array.isArray(stream.eventTimesMs) ||
			!stream.eventTimesMs.every((n) => finite(n) && n >= 0 && n <= expected.durationMs)
		)
			throw new Error("Invalid audio events");
	if (
		!Number.isInteger(expected.expectedVideoSamples) ||
		expected.expectedVideoSamples < 1 ||
		!Number.isInteger(expected.permittedSampleLoss) ||
		expected.permittedSampleLoss < 0 ||
		expected.permittedSampleLoss >= expected.expectedVideoSamples ||
		!expected.sourceColour ||
		!["completed", "interrupted"].includes(expected.terminalStatus) ||
		typeof expected.provenance !== "string" ||
		!expected.provenance
	)
		throw new Error("Missing fixture provenance, media or terminal expectations");
	for (const key of ["colorPrimaries", "transferFunction", "ycbcrMatrix"])
		if (expected.sourceColour[key] !== null && typeof expected.sourceColour[key] !== "string")
			throw new Error("Invalid colour expectation");
	if (
		expected.sourceColour.fullRange !== null &&
		typeof expected.sourceColour.fullRange !== "boolean"
	)
		throw new Error("Invalid range expectation");
	return expected;
}
export function evaluateFixture(expected, observation) {
	validateExpected(expected);
	const checks = [];
	const check = (name, passed, actual, requested) =>
		checks.push({
			name,
			passed: Boolean(passed),
			actual: actual ?? null,
			expected: requested ?? null,
		});
	const inspected = observation.inspection;
	const video = inspected?.video;
	check(
		"decodable",
		inspected?.decodable && video && observation.decodeSucceeded,
		Boolean(inspected?.decodable && video && observation.decodeSucceeded),
		true,
	);
	check(
		"display-geometry",
		video?.displayWidth === expected.displayGeometry.width &&
			video?.displayHeight === expected.displayGeometry.height,
		video ? { width: video.displayWidth, height: video.displayHeight } : null,
		expected.displayGeometry,
	);
	check(
		"transform",
		JSON.stringify(video?.transform) === JSON.stringify(expected.displayGeometry.transform),
		video?.transform,
		expected.displayGeometry.transform,
	);
	let durationMs = null;
	try {
		durationMs =
			(Number(BigInt(inspected.duration.value)) * 1000) / inspected.duration.timescale;
	} catch {
		/* Optional evidence unavailable; retain explicit fallback. */
	}
	check(
		"duration",
		finite(durationMs) &&
			Math.abs(durationMs - expected.durationMs) <= expected.durationToleranceMs,
		durationMs,
		expected.durationMs,
	);
	check(
		"soundtrack",
		expected.audio.required
			? Boolean(
					inspected?.audio &&
						inspected.audio.channels === expected.audio.channels &&
						inspected.audio.sampleRate === 48000,
				)
			: !inspected?.audio,
		inspected?.audio ?? null,
		expected.audio.required,
	);
	const events = [...new Set(expected.audio.streams.flatMap((s) => s.eventTimesMs))].sort(
		(a, b) => a - b,
	);
	const observed = observation.audioEventTimesMs ?? [];
	check(
		"audio-event-timing",
		events.length === observed.length &&
			events.every(
				(time, index) =>
					Math.abs(time - observed[index]) <= expected.audio.eventToleranceMs,
			),
		observed,
		events,
	);
	check(
		"sample-loss",
		Number.isInteger(observation.decodedVideoSamples) &&
			observation.decodedVideoSamples >=
				expected.expectedVideoSamples - expected.permittedSampleLoss,
		observation.decodedVideoSamples,
		expected.expectedVideoSamples,
	);
	check(
		"colour",
		Object.entries(expected.sourceColour).every(([key, value]) => video?.[key] === value),
		video
			? Object.fromEntries(Object.keys(expected.sourceColour).map((key) => [key, video[key]]))
			: null,
		expected.sourceColour,
	);
	check(
		"video-mode",
		observation.videoMode === expected.videoMode,
		observation.videoMode,
		expected.videoMode,
	);
	check(
		"terminal-status",
		observation.terminalStatus === expected.terminalStatus,
		observation.terminalStatus,
		expected.terminalStatus,
	);
	if (expected.compareSourceVideoPayload)
		check(
			"copied-video-payload",
			Boolean(observation.sourcePayloadHash) &&
				observation.sourcePayloadHash === observation.finalPayloadHash,
			observation.finalPayloadHash,
			observation.sourcePayloadHash,
		);
	return {
		fixtureVersion: 1,
		fixtureName: expected.name,
		passed: checks.every((c) => c.passed),
		checks,
	};
}
async function safeFile(root, name) {
	if (name !== path.basename(name) || name.includes("\\"))
		throw new Error("Unsafe fixture filename");
	const file = path.join(root, name);
	const stat = await fs.lstat(file);
	if (!stat.isFile() || stat.isSymbolicLink() || (await fs.realpath(file)) !== file)
		throw new Error("Unsafe fixture file");
	return file;
}
export async function inspectFixtureMedia(root, name, sessionId) {
	if (process.platform !== "darwin")
		throw new Error("Native media inspection requires macOS; fixture was not verified");
	const helper = path.join(
		repository,
		"electron",
		"native",
		"bin",
		`darwin-${process.arch}`,
		"recordly-ios-device-helper",
	);
	await fs.access(helper);
	return new Promise((resolve, reject) => {
		const child = spawn(helper, [], {
			shell: false,
			stdio: ["pipe", "pipe", "pipe", "ignore"],
		});
		let buffer = "";
		let settled = false;
		let inspection;
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			finish(new Error("Native inspection timed out"));
		}, 30000);
		function finish(error) {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (error) reject(error);
			else resolve(inspection);
		}
		child.stderr.on("data", () => undefined);
		child.stdout.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			if (buffer.length > 65536) {
				child.kill("SIGKILL");
				finish(new Error("Oversized inspector response"));
				return;
			}
			while (true) {
				const index = buffer.indexOf("\n");
				if (index < 0) break;
				const line = buffer.slice(0, index);
				buffer = buffer.slice(index + 1);
				try {
					const event = JSON.parse(line);
					if (event.requestId === "fixture-inspect" && event.event === "error") {
						child.stdin.end();
						finish(
							new Error(
								`Native inspection rejected media: ${event.payload?.code ?? "UNKNOWN"}`,
							),
						);
					}
					if (event.requestId === "fixture-inspect" && event.payload?.inspection) {
						inspection = event.payload.inspection;
						child.stdin.end();
					}
				} catch {
					child.kill("SIGKILL");
					finish(new Error("Malformed native inspector response"));
				}
			}
		});
		child.once("error", finish);
		child.once("close", (code) =>
			finish(
				code === 0 && inspection
					? undefined
					: new Error("Native inspection did not complete"),
			),
		);
		child.stdin.write(
			`${JSON.stringify({ protocolVersion: 1, requestId: "fixture-inspect", command: "inspectMedia", sessionId, payload: { relativeName: name }, storage: { sessionRoot: root, allowedRelativeNames: [name] } })}\n`,
		);
	});
}
async function runFFmpeg(binary, args, onStdout) {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
		let diagnostics = "";
		child.stdout.on("data", onStdout);
		child.stderr.on("data", (c) => {
			diagnostics = (diagnostics + c.toString("utf8")).slice(-4096);
		});
		child.once("error", reject);
		child.once("close", (code) =>
			code === 0 ? resolve() : reject(new Error(`Fixture FFmpeg failed: ${diagnostics}`)),
		);
	});
}
export async function decodeFixtureAudio(binary, file) {
	let carry = Buffer.alloc(0),
		sampleIndex = 0,
		lastEvent = -Infinity;
	const events = [];
	await runFFmpeg(
		binary,
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-copyts",
			"-i",
			file,
			"-map",
			"0:a:0",
			"-af",
			"aresample=48000:async=1:first_pts=0",
			"-f",
			"f32le",
			"-ac",
			"1",
			"-ar",
			"48000",
			"pipe:1",
		],
		(chunk) => {
			const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
			const end = data.length - (data.length % 4);
			for (let offset = 0; offset < end; offset += 4) {
				const amplitude = Math.abs(data.readFloatLE(offset));
				const time = sampleIndex++ / 48;
				if (amplitude > 0.06 && time - lastEvent > 100) {
					events.push(time);
					lastEvent = time;
				}
			}
			carry = data.subarray(end);
		},
	);
	return events;
}
export async function verifyFixture({ sessionDir, expectedPath, reportPath }, deps = {}) {
	const expected = validateExpected(JSON.parse(await fs.readFile(expectedPath, "utf8")));
	const root = await fs.realpath(sessionDir);
	if ((await fs.lstat(sessionDir)).isSymbolicLink()) throw new Error("Unsafe fixture directory");
	const observation = { decodeSucceeded: false, decodedVideoSamples: 0, audioEventTimesMs: [] };
	const errors = [];
	try {
		const movie = await safeFile(root, expected.videoFile);
		const binary = deps.ffmpeg ?? resolveFixtureFFmpeg();
		observation.inspection = await (deps.inspectMedia ?? inspectFixtureMedia)(
			root,
			expected.videoFile,
			expected.sessionId,
		);
		let progress = "";
		await runFFmpeg(
			binary,
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-xerror",
				"-i",
				movie,
				"-map",
				"0:v:0",
				"-progress",
				"pipe:1",
				"-f",
				"null",
				"-",
			],
			(chunk) => {
				progress += chunk.toString("utf8");
				while (true) {
					const newline = progress.indexOf("\n");
					if (newline < 0) break;
					const line = progress.slice(0, newline);
					progress = progress.slice(newline + 1);
					const match = /^frame=(\d+)$/.exec(line);
					if (match) observation.decodedVideoSamples = Number(match[1]);
				}
			},
		);
		observation.decodeSucceeded = true;
		if (observation.inspection.audio)
			observation.audioEventTimesMs = await decodeFixtureAudio(binary, movie);
		if (expected.compareSourceVideoPayload) {
			for (const [key, file] of [
				["sourcePayloadHash", await safeFile(root, "source-video.mov")],
				["finalPayloadHash", movie],
			]) {
				let hash = "";
				await runFFmpeg(
					binary,
					[
						"-hide_banner",
						"-loglevel",
						"error",
						"-i",
						file,
						"-map",
						"0:v:0",
						"-c:v",
						"copy",
						"-f",
						"hash",
						"-hash",
						"sha256",
						"pipe:1",
					],
					(chunk) => {
						hash += chunk.toString("utf8");
					},
				);
				observation[key] = hash.trim();
			}
		}
		const journal = JSON.parse(
			await fs.readFile(await safeFile(root, "capture-journal.json"), "utf8"),
		);
		observation.videoMode = journal.nativeResult?.mode ?? journal.mode;
		const reason = journal.nativeResult?.stopReason ?? journal.stopReason;
		observation.terminalStatus =
			journal.state === "committed"
				? ["user-stop", "userStop", "stopped", "stop", "completed"].includes(reason)
					? "completed"
					: "interrupted"
				: journal.state;
	} catch (error) {
		errors.push(String(error));
	}
	const report = {
		...evaluateFixture(expected, observation),
		errors,
		inspectionSource: deps.inspectMedia ? "injected-test-inspector" : "native-helper",
		physicalDeviceEvidence: false,
	};
	report.passed = report.passed && errors.length === 0;
	await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
	return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const args = parseArguments(process.argv.slice(2));
		const report = await verifyFixture({
			sessionDir: args["session-dir"],
			expectedPath: args.expected,
			reportPath: args.report,
		});
		process.stdout.write(`${report.passed ? "PASS" : "FAIL"}: ${report.fixtureName}\n`);
		process.exitCode = report.passed ? 0 : 1;
	} catch (error) {
		process.stderr.write(`${String(error)}\n`);
		process.exitCode = 1;
	}
}
