import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { resolveFixtureFFmpeg } from "../../verify-ios-capture-fixture.mjs";
export const VARIANTS = [
	"portrait",
	"landscape",
	"odd-dimension",
	"delayed-microphone",
	"negative-offset",
	"internal-gap",
	"silent-static",
	"timing-30m",
];
function args(argv) {
	const parsed = {};
	for (let i = 0; i < argv.length; i += 2) {
		const key = argv[i];
		if (!["--output-dir", "--variant"].includes(key) || parsed[key] || !argv[i + 1])
			throw new Error("Use --output-dir /absolute/new-directory --variant name");
		parsed[key] = argv[i + 1];
	}
	if (!path.isAbsolute(parsed["--output-dir"] ?? "") || !VARIANTS.includes(parsed["--variant"]))
		throw new Error(`Choose an absolute output directory and variant: ${VARIANTS.join(", ")}`);
	return parsed;
}
async function ffmpeg(binary, argv) {
	await new Promise((resolve, reject) => {
		const child = spawn(
			binary,
			["-hide_banner", "-loglevel", "error", "-nostdin", "-n", ...argv],
			{ shell: false, stdio: ["ignore", "ignore", "pipe"] },
		);
		let error = "";
		child.stderr.on("data", (chunk) => {
			error = (error + chunk.toString("utf8")).slice(-4096);
		});
		child.once("error", reject);
		child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(error))));
	});
}
export async function generateFixture(outputDir, variant) {
	if (!path.isAbsolute(outputDir) || !VARIANTS.includes(variant))
		throw new Error("Invalid fixture output/variant");
	const binary = resolveFixtureFFmpeg();
	await fs.mkdir(outputDir, { mode: 0o700 });
	const directory = await fs.realpath(outputDir);
	const width = variant === "landscape" ? 426 : variant === "odd-dimension" ? 241 : 240;
	const height = variant === "landscape" ? 240 : variant === "odd-dimension" ? 427 : 426;
	const durationMs = variant === "timing-30m" ? 1800000 : 4000;
	const duration = durationMs / 1000;
	const fps = 30;
	const silent = variant === "silent-static";
	const offsetMs =
		variant === "delayed-microphone" ? 250 : variant === "negative-offset" ? -120 : 0;
	const localEvents = silent
		? []
		: variant === "timing-30m"
			? [500, durationMs - 500]
			: variant === "internal-gap"
				? [500, 3500]
				: [500, 2000, 3500];
	const eventTimesMs = localEvents
		.map((t) => t + offsetMs)
		.filter((t) => t >= 0 && t < durationMs);
	const audioKind = ["delayed-microphone", "negative-offset"].includes(variant)
		? "microphone"
		: "device-audio";
	const audioName = audioKind === "microphone" ? "microphone.mov" : "device-audio.mov";
	const source = path.join(directory, "source-video.mov");
	const audio = path.join(directory, audioName);
	const movie = path.join(directory, "recording.mov");
	const fontCandidates =
		process.platform === "darwin"
			? [
					"/System/Library/Fonts/Menlo.ttc",
					"/System/Library/Fonts/Supplemental/Courier New.ttf",
				]
			: ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"];
	let font;
	for (const candidate of fontCandidates) {
		try {
			await fs.access(candidate);
			font = candidate;
			break;
		} catch {
			/* Optional evidence unavailable; retain explicit fallback. */
		}
	}
	if (!font) throw new Error("Fixture generation requires an installed monospace font");
	const filters = [
		`format=yuv444p`,
		`drawbox=x=0:y=0:w=iw:h=ih:color=white:t=1`,
		`drawbox=x=10:y=45:w=60:h=40:color=red:t=fill`,
		`drawbox=x=80:y=45:w=60:h=40:color=green:t=fill`,
		`drawbox=x=150:y=45:w=60:h=40:color=blue:t=fill`,
		`drawtext=fontfile='${font}':text='R       G       B':fontcolor=white:fontsize=12:x=15:y=58`,
		`drawtext=fontfile='${font}':text='Fine UI 0123456789 AaBb':fontcolor=white:fontsize=10:x=${silent ? "12" : "12+10*sin(t)"}:y=100`,
	];
	if (!silent)
		filters.push(
			`drawbox=x=iw-25:y=ih-25:w=20:h=20:color=white:t=fill:enable='${eventTimesMs.map((t) => `between(t,${t / 1000},${t / 1000 + 1 / fps})`).join("+")}'`,
		);
	const pixelFormat = variant === "odd-dimension" ? "yuv444p" : "yuv420p";
	await ffmpeg(binary, [
		"-f",
		"lavfi",
		"-i",
		`color=c=0x18202a:s=${width}x${height}:r=${fps}:d=${duration},format=yuv444p`,
		"-vf",
		filters.join(","),
		"-an",
		"-c:v",
		"libx264",
		"-preset",
		"ultrafast",
		"-crf",
		"12",
		"-pix_fmt",
		pixelFormat,
		"-x264-params",
		"colorprim=bt709:transfer=bt709:colormatrix=bt709",
		"-color_primaries",
		"bt709",
		"-color_trc",
		"bt709",
		"-colorspace",
		"bt709",
		"-color_range",
		"tv",
		"-movflags",
		"+faststart+write_colr",
		source,
	]);
	const pulses = localEvents
		.map((t) => `between(t\\,${t / 1000}\\,${t / 1000 + 0.01})`)
		.join("+");
	const expression = silent ? "0" : `0.8*sin(2*PI*1000*t)*(${pulses})`;
	await ffmpeg(binary, [
		"-f",
		"lavfi",
		"-i",
		`aevalsrc=${expression}:s=48000:d=${duration}`,
		"-c:a",
		"pcm_s16le",
		audio,
	]);
	const trim = Math.max(0, -offsetMs) / 1000,
		delay = Math.max(0, offsetMs);
	await ffmpeg(binary, [
		"-i",
		source,
		"-i",
		audio,
		"-filter_complex",
		`[1:a:0]atrim=start=${trim},asetpts=PTS-STARTPTS,adelay=${delay}:all=1,aresample=48000,volume=1,apad,atrim=duration=${duration}[a]`,
		"-map",
		"0:v:0",
		"-map",
		"[a]",
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		"-b:a",
		"128k",
		"-ar",
		"48000",
		"-ac",
		"1",
		"-t",
		String(duration),
		"-movflags",
		"+faststart",
		movie,
	]);
	const hash = createHash("sha256").update(variant).digest("hex");
	const sessionId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
	const sourceColour = {
		colorPrimaries: "ITU_R_709_2",
		transferFunction: "ITU_R_709_2",
		ycbcrMatrix: "ITU_R_709_2",
		fullRange: false,
	};
	const format = {
		codedWidth: width,
		codedHeight: height,
		displayWidth: width,
		displayHeight: height,
		codec: "avc1",
		...sourceColour,
		transform: [1, 0, 0, 1, 0, 0],
		observedFrameRate: fps,
		fingerprint: `synthetic-${variant}`,
	};
	const firstHostTime = { value: "1000000000000", timescale: 1000 };
	const audioStart = {
		value: String(BigInt(firstHostTime.value) + BigInt(offsetMs)),
		timescale: 1000,
	};
	const mediaDuration = { value: String(durationMs), timescale: 1000 };
	const stream = {
		mediaKind: audioKind,
		firstHostTime: audioStart,
		duration: mediaDuration,
		rate: { numerator: "1", denominator: "1" },
		clockAnchor: { hostTime: audioStart, mediaTime: { value: "0", timescale: 1000 } },
		gaps:
			variant === "internal-gap"
				? [
						{
							start: { value: "1000", timescale: 1000 },
							duration: { value: "1500", timescale: 1000 },
						},
					]
				: [],
	};
	const timing = {
		version: 1,
		timeline: "host-mapped",
		gapsRepresentedInMedia: true,
		streams: [stream],
	};
	const nativeResult = {
		sessionId,
		stopReason: "user-stop",
		mode: "passthrough",
		format,
		video: {
			relativeName: "source-video.mov",
			mediaKind: "video",
			firstHostTime,
			duration: mediaDuration,
			sampleCount: duration * fps,
			mediaFormat: { codec: "avc1", width, height },
		},
		[audioKind === "microphone" ? "microphone" : "deviceAudio"]: {
			relativeName: audioName,
			mediaKind: audioKind,
			firstHostTime: audioStart,
			duration: mediaDuration,
			sampleCount: duration * 48000,
			mediaFormat: { codec: "lpcm", sampleRate: 48000, channels: 1 },
		},
		timingFile: "native-timing.json",
		timing,
	};
	const expected = {
		fixtureVersion: 1,
		name: variant,
		sessionId,
		videoFile: "recording.mov",
		videoMode: "passthrough",
		durationMs,
		durationToleranceMs: 50,
		displayGeometry: { width, height, transform: [1, 0, 0, 1, 0, 0] },
		audio: {
			required: true,
			channels: 1,
			eventToleranceMs: 80,
			streams: [{ kind: audioKind, eventTimesMs }],
		},
		expectedVideoSamples: duration * fps,
		permittedSampleLoss: 0,
		sourceColour,
		terminalStatus: "completed",
		provenance:
			"Synthetic lavfi media generated by Recordly fixture utility; CC0-1.0. This is authored software fixture data, not a native writer or physical-device capture.",
		compareSourceVideoPayload: true,
	};
	await fs.writeFile(path.join(directory, "expected.json"), JSON.stringify(expected, null, 2));
	await fs.writeFile(
		path.join(directory, "native-timing.json"),
		JSON.stringify({ timing, result: nativeResult }, null, 2),
	);
	await fs.writeFile(
		path.join(directory, "capture-journal.json"),
		JSON.stringify(
			{
				version: 1,
				sessionId,
				createdAt: "2026-09-08T00:00:00.000Z",
				state: "committed",
				nativeResult,
				committedFile: "recording.mov",
				syntheticFixture: true,
			},
			null,
			2,
		),
	);
	return { directory, expectedPath: path.join(directory, "expected.json") };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const parsed = args(process.argv.slice(2));
		const result = await generateFixture(parsed["--output-dir"], parsed["--variant"]);
		process.stdout.write(`${JSON.stringify(result)}\n`);
	} catch (error) {
		process.stderr.write(`${String(error)}\n`);
		process.exitCode = 1;
	}
}
