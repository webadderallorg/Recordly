import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type WrittenFile = { canAdd: boolean; status: number; codec: string | null; frames: number };

// Compile WebcamRecorder from the helper source and write real files with its settings.
// A setting the encoder rejects raises an Objective-C exception there, as in the helper.
describe.skipIf(process.platform !== "darwin")("native webcam writer settings", () => {
	let directory: string;
	let report: { hevc: WrittenFile; h264: WrittenFile; hevcBitRate: number; keyFrames: number };
	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), "recordly-webcam-"));
		const source = readFileSync(
			new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
			"utf8",
		);
		const webcamRecorder = source.slice(
			source.indexOf("/// Records the camera next to the screen capture"),
			source.indexOf("final class ScreenCaptureRecorder"),
		);
		writeFileSync(
			join(directory, "main.swift"),
			`
import AVFoundation
${webcamRecorder}
func write(codec: AVVideoCodecType, to url: URL) -> [String: Any] {
    let writer = try! AVAssetWriter(url: url, fileType: .mp4)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: WebcamRecorder.videoSettings(codec: codec, width: 1280, height: 720))
    let canAdd = writer.canAdd(input)
    if !canAdd { return ["canAdd": false, "status": writer.status.rawValue, "codec": NSNull(), "frames": 0] }
    writer.add(input)
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
    writer.startWriting()
    writer.startSession(atSourceTime: .zero)
    for frame in 0..<30 {
        var buffer: CVPixelBuffer?
        CVPixelBufferCreate(nil, 1280, 720, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, nil, &buffer)
        while !input.isReadyForMoreMediaData { usleep(1_000) }
        adaptor.append(buffer!, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: 30))
    }
    input.markAsFinished()
    let done = DispatchSemaphore(value: 0)
    writer.finishWriting { done.signal() }
    done.wait()
    let track = AVURLAsset(url: url).tracks(withMediaType: .video).first
    let subtype = (track?.formatDescriptions.first).map { CMFormatDescriptionGetMediaSubType($0 as! CMFormatDescription) }
    let codecName = subtype.map { type in String(bytes: [24, 16, 8, 0].map { UInt8((type >> $0) & 0xff) }, encoding: .ascii) ?? "?" }
    return ["canAdd": true, "status": writer.status.rawValue, "codec": codecName ?? NSNull(), "frames": 30]
}
let directory = CommandLine.arguments[1]
let settings = WebcamRecorder.videoSettings(codec: .hevc, width: 1280, height: 720)
let compression = settings[AVVideoCompressionPropertiesKey] as! [String: Any]
let report: [String: Any] = [
    "hevc": write(codec: .hevc, to: URL(fileURLWithPath: directory + "/hevc.mp4")),
    "h264": write(codec: .h264, to: URL(fileURLWithPath: directory + "/h264.mp4")),
    "hevcBitRate": compression[AVVideoAverageBitRateKey] as! Int,
    "keyFrames": compression[AVVideoMaxKeyFrameIntervalKey] as! Int,
]
print(String(data: try! JSONSerialization.data(withJSONObject: report), encoding: .utf8)!)
`,
		);
		const executable = join(directory, "webcam");
		const build = spawnSync(
			"swiftc",
			[
				"-module-cache-path",
				join(directory, "cache"),
				join(directory, "main.swift"),
				"-o",
				executable,
			],
			{ encoding: "utf8", timeout: 120_000 },
		);
		expect(build.status, build.stderr).toBe(0);
		const run = spawnSync(executable, [directory], { encoding: "utf8", timeout: 60_000 });
		expect(run.status, run.stderr).toBe(0);
		report = JSON.parse(run.stdout);
	}, 200_000);
	afterAll(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
	});

	it("writes a 720p HEVC webcam file", () => {
		expect(report.hevc).toEqual({ canAdd: true, status: 2, codec: "hvc1", frames: 30 });
	});

	it("writes the H.264 fallback the same way", () => {
		expect(report.h264).toEqual({ canAdd: true, status: 2, codec: "avc1", frames: 30 });
	});

	it("uses 3 Mbit/s and a key frame every 2 s", () => {
		expect(report.hevcBitRate).toBe(3_000_000);
		expect(report.keyFrames).toBe(60);
	});
});

// The renderer passes Chromium's label, which adds " (<vendor>:<product>)" to the camera's
// macOS name whenever the camera has a model ID (VideoCaptureDeviceDescriptor::GetNameAndModel).
describe.skipIf(process.platform !== "darwin")("native webcam camera matching", () => {
	let results: Record<string, boolean>;
	let picks: Record<string, number>;
	beforeAll(() => {
		const directory = mkdtempSync(join(tmpdir(), "recordly-webcam-match-"));
		const source = readFileSync(
			new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
			"utf8",
		);
		const webcamRecorder = source.slice(
			source.indexOf("/// Records the camera next to the screen capture"),
			source.indexOf("final class ScreenCaptureRecorder"),
		);
		const cases: [string, string, string][] = [
			["plain", "FaceTime HD Camera", "FaceTime HD Camera"],
			["chromium-suffix", "FaceTime HD Camera", "FaceTime HD Camera (05ac:8514)"],
			["usb-suffix", "Logitech BRIO", "Logitech BRIO (046d:085e)"],
			["other-camera", "FaceTime HD Camera", "Logitech BRIO (046d:085e)"],
			["prefix-only", "iPhone Camera", "iPhone Camera Desk View (05ac:1234)"],
			["not-a-model-id", "Studio Display Camera", "Studio Display Camera (Built-in)"],
		];
		writeFileSync(
			join(directory, "main.swift"),
			`import AVFoundation
${webcamRecorder}
var out: [String: Bool] = [:]
${cases.map(([key, name, label]) => `out[${JSON.stringify(key)}] = WebcamRecorder.labelMatches(name: ${JSON.stringify(name)}, label: ${JSON.stringify(label)})`).join("\n")}
func pick(_ names: [String], _ label: String) -> Int { WebcamRecorder.matchingCamera(names: names, label: label) ?? -1 }
var picks: [String: Int] = [:]
picks["one"] = pick(["FaceTime HD Camera", "Logitech BRIO"], "Logitech BRIO (046d:085e)")
picks["two-same-name"] = pick(["Logitech BRIO", "Logitech BRIO"], "Logitech BRIO (046d:085e)")
picks["none"] = pick(["FaceTime HD Camera"], "Logitech BRIO (046d:085e)")
let both: [String: Any] = ["matches": out, "picks": picks]
print(String(data: try! JSONSerialization.data(withJSONObject: both), encoding: .utf8)!)
`,
		);
		const built = spawnSync(
			"swiftc",
			["-o", join(directory, "match"), join(directory, "main.swift")],
			{ encoding: "utf8" },
		);
		if (built.status !== 0) throw new Error(built.stderr);
		({ matches: results, picks } = JSON.parse(
			spawnSync(join(directory, "match"), [], { encoding: "utf8" }).stdout,
		));
		rmSync(directory, { recursive: true, force: true });
	}, 180_000);

	it("matches the macOS name with or without Chromium's model suffix", () => {
		expect(results.plain).toBe(true);
		expect(results["chromium-suffix"]).toBe(true);
		expect(results["usb-suffix"]).toBe(true);
	});

	it("does not match another camera or a different name", () => {
		expect(results["other-camera"]).toBe(false);
		expect(results["prefix-only"]).toBe(false);
		expect(results["not-a-model-id"]).toBe(false);
	});

	it("picks the one matching camera, and none when two cameras share the name", () => {
		expect(picks.one).toBe(1);
		expect(picks["two-same-name"]).toBe(-1);
		expect(picks.none).toBe(-1);
	});
});
