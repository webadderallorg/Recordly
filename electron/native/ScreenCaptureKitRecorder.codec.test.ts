import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type CodecReport = {
	sizes: { width: number; height: number; h264: boolean; hevc: boolean; chosen: string }[];
	hevcSettings: Record<string, unknown>;
	writer: { canAdd: boolean; status: number; error: string | null; codec: string | null } | null;
};

// Compile the production codec helpers against the real VideoToolbox and ask it which
// hardware encoders exist at each size. CI runners may have no hardware encoder at all,
// so the expectations follow what this machine reports.
describe.skipIf(process.platform !== "darwin")("video codec choice", () => {
	let directory: string;
	let report: CodecReport;
	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), "recordly-codec-"));
		const source = readFileSync(
			new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
			"utf8",
		);
		const helpers = source.slice(
			source.indexOf("/// True when a hardware encoder can open a session"),
			source.indexOf("final class ScreenCaptureRecorder"),
		);
		writeFileSync(
			join(directory, "main.swift"),
			`
import AVFoundation
import VideoToolbox
${helpers}
let sizes = [(1920, 1080), (3840, 2160), (4096, 2656), (4112, 2658), (6016, 3384)].map { size in
    [
        "width": size.0,
        "height": size.1,
        "h264": hardwareVideoEncoderAvailable(kCMVideoCodecType_H264, width: size.0, height: size.1),
        "hevc": hardwareVideoEncoderAvailable(kCMVideoCodecType_HEVC, width: size.0, height: size.1),
        "chosen": preferredVideoCodec(width: size.0, height: size.1).rawValue,
    ] as [String: Any]
}
let h264Settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: 4112,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 25_000_000,
        AVVideoMaxKeyFrameIntervalKey: 30,
        AVVideoH264EntropyModeKey: AVVideoH264EntropyModeCABAC,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    ],
]
var hevc = hevcVideoSettings(from: h264Settings)
hevc[AVVideoCodecKey] = (hevc[AVVideoCodecKey] as! AVVideoCodecType).rawValue

// Write 10 frames the way startCapture sets up the writer: the real assistant settings,
// switched to HEVC. A key HEVC rejects would raise an Objective-C exception here.
func writeHevcSample(width: Int, height: Int, to url: URL) -> [String: Any] {
    let assistant = AVOutputSettingsAssistant(preset: .preset3840x2160)!
    let format = try! CMVideoFormatDescription(
        videoCodecType: CMFormatDescription.MediaSubType(rawValue: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange),
        width: width, height: height)
    assistant.sourceVideoFormat = format
    var settings = assistant.videoSettings!
    settings[AVVideoWidthKey] = width
    settings[AVVideoHeightKey] = height
    settings = hevcVideoSettings(from: settings)
    let writer = try! AVAssetWriter(url: url, fileType: .mp4)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings, sourceFormatHint: format)
    input.expectsMediaDataInRealTime = true
    let canAdd = writer.canAdd(input)
    if !canAdd { return ["canAdd": false, "status": writer.status.rawValue, "error": NSNull(), "codec": NSNull()] }
    writer.add(input)
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
    writer.startWriting()
    writer.startSession(atSourceTime: .zero)
    for frame in 0..<10 {
        var buffer: CVPixelBuffer?
        CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, nil, &buffer)
        while !input.isReadyForMoreMediaData { usleep(1_000) }
        adaptor.append(buffer!, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: 30))
    }
    input.markAsFinished()
    let done = DispatchSemaphore(value: 0)
    writer.finishWriting { done.signal() }
    done.wait()
    let track = AVURLAsset(url: url).tracks(withMediaType: .video).first
    let codec = (track?.formatDescriptions.first).map { desc -> String in
        let type = CMFormatDescriptionGetMediaSubType(desc as! CMFormatDescription)
        return String(bytes: [24, 16, 8, 0].map { UInt8((type >> $0) & 0xff) }, encoding: .ascii) ?? "?"
    }
    return ["canAdd": true, "status": writer.status.rawValue,
            "error": writer.error.map { String(describing: $0) } ?? NSNull(), "codec": codec ?? NSNull()]
}
let output = CommandLine.arguments[1]
let writerReport: Any = hardwareVideoEncoderAvailable(kCMVideoCodecType_HEVC, width: 4112, height: 2658)
    ? writeHevcSample(width: 4112, height: 2658, to: URL(fileURLWithPath: output))
    : NSNull()
let json = try! JSONSerialization.data(withJSONObject: ["sizes": sizes, "hevcSettings": hevc, "writer": writerReport])
print(String(data: json, encoding: .utf8)!)
`,
		);
		const executable = join(directory, "codec");
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
		const run = spawnSync(executable, [join(directory, "sample.mp4")], {
			encoding: "utf8",
			timeout: 60_000,
		});
		expect(run.status, run.stderr).toBe(0);
		report = JSON.parse(run.stdout);
	}, 150_000);
	afterAll(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
	});

	// This restates the rule; what it checks is that the probe runs and gives a codec per size.
	it("keeps H.264 where its hardware encoder works, else uses hardware HEVC", () => {
		for (const size of report.sizes) {
			const expected = size.h264 ? "avc1" : size.hevc ? "hvc1" : "avc1";
			expect(size.chosen, `${size.width}x${size.height}`).toBe(expected);
		}
	});

	it("keeps the H.264 bit rate and key frame interval when switching to HEVC", () => {
		expect(report.hevcSettings).toEqual({
			AVVideoCodecKey: "hvc1",
			AVVideoWidthKey: 4112,
			AVVideoCompressionPropertiesKey: {
				AverageBitRate: 25_000_000,
				MaxKeyFrameInterval: 30,
				ProfileLevel: "HEVC_Main_AutoLevel",
			},
		});
	});

	it.skipIf(process.platform !== "darwin")(
		"writes a playable HEVC file from the real H.264 preset at 4112x2658",
		() => {
			if (report.writer === null) {
				// No hardware HEVC encoder on this machine (e.g. a CI VM): nothing to write.
				return;
			}
			expect(report.writer).toEqual({ canAdd: true, status: 2, error: null, codec: "hvc1" });
		},
	);
});
