import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type TrackResult = { frames: number; channels: number; rms: number[]; leftEqualsRight: boolean };

// Compiles the production AudioTimelineTrack, feeds it audio with gaps, overlaps and
// a mono 24 kHz device format, and reads the encoded sidecar back.
describe.skipIf(process.platform !== "darwin")("AudioTimelineTrack", () => {
	let directory: string;
	let results: Record<string, TrackResult>;
	let warnings: string;

	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), "recordly-audio-track-"));
		const source = readFileSync(
			new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
			"utf8",
		);
		const track = source.slice(
			source.indexOf("let targetCaptureFPS"),
			source.indexOf("final class ScreenCaptureRecorder"),
		);
		writeFileSync(
			join(directory, "main.swift"),
			`
import Foundation
import AVFoundation
import CoreMedia
${track}

let directory = CommandLine.arguments[1]

/// A buffer of a 440 Hz tone, as ScreenCaptureKit would deliver it.
func tone(frames: Int, rate: Double = 48_000, channels: AVAudioChannelCount = 2) -> CMSampleBuffer {
	let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: channels, interleaved: false)!
	let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames))!
	buffer.frameLength = AVAudioFrameCount(frames)
	for channel in 0..<Int(channels) {
		for frame in 0..<frames {
			buffer.floatChannelData![channel][frame] = 0.5 * sin(2 * .pi * 440 * Float(frame) / Float(rate))
		}
	}
	var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: CMTimeScale(rate)), presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
	var sampleBuffer: CMSampleBuffer?
	CMSampleBufferCreate(allocator: nil, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil, refcon: nil, formatDescription: format.formatDescription, sampleCount: frames, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil, sampleBufferOut: &sampleBuffer)
	CMSampleBufferSetDataBufferFromAudioBufferList(sampleBuffer!, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, bufferList: buffer.audioBufferList)
	return sampleBuffer!
}

func at(_ seconds: Double) -> CMTime { CMTime(seconds: seconds, preferredTimescale: 48_000) }

func run(_ name: String, padTo endFrame: Int64, _ feed: (AudioTimelineTrack) -> Void) async -> String {
	let url = URL(fileURLWithPath: directory).appendingPathComponent("\\(name).m4a")
	let track = try! AudioTimelineTrack(label: name, sidecarURL: url, sidecarBitRate: 160_000, inlineInput: nil, inlineWriter: nil)
	feed(track)
	_ = await track.finish(padTo: endFrame)
	let file = try! AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
	let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))!
	try! file.read(into: buffer)
	let left = buffer.floatChannelData![0]
	let right = buffer.floatChannelData![Int(file.processingFormat.channelCount) - 1]
	// RMS of each 10 ms window, to see where tone and silence landed.
	var rms: [String] = []
	var window = 0
	while (window + 1) * 480 <= Int(buffer.frameLength) {
		var sum: Float = 0
		for frame in (window * 480)..<((window + 1) * 480) { sum += left[frame] * left[frame] }
		rms.append(String(format: "%.4f", (sum / 480).squareRoot()))
		window += 1
	}
	var leftEqualsRight = true
	for frame in 0..<Int(buffer.frameLength) where abs(left[frame] - right[frame]) > 1e-4 { leftEqualsRight = false }
	return "\\"\\(name)\\": {\\"frames\\": \\(file.length), \\"channels\\": \\(file.processingFormat.channelCount), \\"rms\\": [\\(rms.joined(separator: ","))], \\"leftEqualsRight\\": \\(leftEqualsRight)}"
}

let done = DispatchSemaphore(value: 0)
Task {
	var entries: [String] = []
	entries.append(await run("contiguous", padTo: 4_800) { track in
		for index in 0..<5 { track.append(tone(frames: 960), at: at(Double(index) * 0.02)) }
	})
	entries.append(await run("gap", padTo: 4_800) { track in
		track.append(tone(frames: 960), at: at(0))
		track.append(tone(frames: 960), at: at(0.02))
		track.append(tone(frames: 960), at: at(0.08))
	})
	entries.append(await run("overlap", padTo: 3_840) { track in
		track.append(tone(frames: 1_920), at: at(0))
		track.append(tone(frames: 1_920), at: at(0))
		track.append(tone(frames: 1_920), at: at(0.04))
	})
	entries.append(await run("beforeZero", padTo: 1_920) { track in
		track.append(tone(frames: 1_920), at: at(-0.03))
	})
	entries.append(await run("limit", padTo: 2_400) { track in
		track.limit(atFrame: 2_400)
		for index in 0..<5 { track.append(tone(frames: 960), at: at(Double(index) * 0.02)) }
	})
	entries.append(await run("monoMic", padTo: 4_800) { track in
		for index in 0..<10 { track.append(tone(frames: 240, rate: 24_000, channels: 1), at: at(Double(index) * 0.01)) }
	})
	// A writer that has stopped never takes audio again, so the track must not queue any for it.
	let writer = try! AVAssetWriter(outputURL: URL(fileURLWithPath: directory).appendingPathComponent("cancelled.mp4"), fileType: .mp4)
	let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 2])
	writer.add(input)
	writer.startWriting()
	writer.startSession(atSourceTime: .zero)
	writer.cancelWriting()
	let cancelled = try! AudioTimelineTrack(label: "cancelled", sidecarURL: nil, sidecarBitRate: 160_000, inlineInput: input, inlineWriter: writer)
	for index in 0..<5 { cancelled.append(tone(frames: 960), at: at(Double(index) * 0.02)) }
	_ = await cancelled.finish(padTo: 4_800)
	print("{" + entries.joined(separator: ",") + "}")
	done.signal()
}
done.wait()
`,
		);
		const executable = join(directory, "harness");
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
		results = JSON.parse(run.stdout);
		warnings = run.stderr;
	}, 180_000);

	afterAll(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
	});

	const isTone = (value: number) => value > 0.2;
	const isSilent = (value: number) => value < 0.02;

	it("writes contiguous buffers back to back", () => {
		expect(results.contiguous.frames).toBe(4_800);
		expect(results.contiguous.rms.every(isTone)).toBe(true);
	});

	it("keeps later audio at its time when buffers go missing", () => {
		const { frames, rms } = results.gap;
		expect(frames).toBe(4_800);
		// 0-40 ms tone, 40-80 ms silence for the missing buffers, 80-100 ms tone.
		expect(rms.slice(0, 3).every(isTone)).toBe(true);
		expect(rms.slice(5, 7).every(isSilent)).toBe(true);
		expect(rms.slice(8, 10).every(isTone)).toBe(true);
	});

	it("trims audio that repeats time already written", () => {
		expect(results.overlap.frames).toBe(3_840);
		expect(results.overlap.rms.slice(0, 7).every(isTone)).toBe(true);
	});

	it("drops the part of a buffer captured before time zero", () => {
		expect(results.beforeZero.frames).toBe(1_920);
		// 480 frames of tone survive, then the track is padded to the end.
		expect(isTone(results.beforeZero.rms[0])).toBe(true);
		expect(results.beforeZero.rms.slice(2).every(isSilent)).toBe(true);
	});

	it("cuts audio after the stop", () => {
		expect(results.limit.frames).toBe(2_400);
		expect(results.limit.rms.slice(0, 4).every(isTone)).toBe(true);
	});

	it("converts a mono 24 kHz microphone to 48 kHz stereo", () => {
		const { frames, channels, rms, leftEqualsRight } = results.monoMic;
		expect(frames).toBe(4_800);
		expect(channels).toBe(2);
		expect(leftEqualsRight).toBe(true);
		expect(rms.slice(1, 8).every(isTone)).toBe(true);
	});

	it("queues no audio for a writer that has stopped", () => {
		expect(warnings).not.toContain("cancelled audio buffers never reached");
	});
});
