import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Compile production queue logic and use real AAC writers. No capture permissions or devices.
describe.skipIf(process.platform !== "darwin")("native audio continuity", () => {
	let directory: string;
	let results: Record<string, { frames: number; marker: number; silentGap: boolean }>;
	let pressure: {
		dropped: number;
		peakBytes: number;
		peakSeconds: number;
		failedFinish: boolean;
		terminalFailure: boolean;
	};
	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), "recordly-audio-continuity-"));
		const source = readFileSync(
			new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
			"utf8",
		);
		const queue = source.slice(
			source.indexOf("final class AudioSampleQueue"),
			source.indexOf("final class ScreenCaptureRecorder"),
		);
		writeFileSync(
			join(directory, "main.swift"),
			String.raw`
import Foundation
import AVFoundation
import CoreMedia
${queue}
func at(_ seconds: Double) -> CMTime { CMTime(seconds: seconds, preferredTimescale: 48_000) }
func tone(index: Int, rate: Double = 48_000, channels: AVAudioChannelCount = 2, interleaved: Bool = false) -> CMSampleBuffer {
 let frames = Int(rate / 100)
 let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: channels, interleaved: interleaved)!
 let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames))!
 pcm.frameLength = AVAudioFrameCount(frames)
 let frequency: Float = index >= 70 ? 1500 : 500
 for channel in 0..<Int(channels) {
  for frame in 0..<frames { pcm.floatChannelData![interleaved ? 0 : channel][interleaved ? frame * Int(channels) + channel : frame] = 0.5 * sin(2 * .pi * frequency * Float(frame) / Float(rate)) }
 }
 var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: CMTimeScale(rate)), presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
 var sample: CMSampleBuffer?
 precondition(CMSampleBufferCreate(allocator: nil, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil, refcon: nil,
  formatDescription: format.formatDescription, sampleCount: frames, sampleTimingEntryCount: 1, sampleTimingArray: &timing,
  sampleSizeEntryCount: 0, sampleSizeArray: nil, sampleBufferOut: &sample) == noErr)
 precondition(CMSampleBufferSetDataBufferFromAudioBufferList(sample!, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, bufferList: pcm.audioBufferList) == noErr)
 return sample!
}
func energy(_ values: UnsafePointer<Float>, offset: Int, count: Int, frequency: Double) -> Double {
 var real = 0.0, imaginary = 0.0
 for index in 0..<count {
  let angle = 2 * Double.pi * frequency * Double(index) / 48_000
  real += Double(values[offset + index]) * cos(angle)
  imaginary += Double(values[offset + index]) * sin(angle)
 }
 return real * real + imaginary * imaginary
}
func run(_ name: String) async -> String {
 let url = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent(name + ".m4a")
 let writer = try! AVAssetWriter(url: url, fileType: .m4a)
 let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey:kAudioFormatMPEG4AAC, AVSampleRateKey:48_000, AVNumberOfChannelsKey:2, AVEncoderBitRateKey:160_000])
 input.expectsMediaDataInRealTime = true
 writer.add(input)
 precondition(writer.startWriting())
 writer.startSession(atSourceTime: .zero)
 var blocked = false
 let samples = AudioSampleQueue(isReady: { !blocked && input.isReadyForMoreMediaData }, canWrite: { writer.status == .writing }, append: { input.append($0) })
 for index in 0..<(name == "overflow" ? 400 : 100) {
  if name == "gap" && index >= 40 && index < 60 { continue }
  if name == "tail" && index >= 80 { continue }
  if name == "leading" && index < 20 { continue }
  blocked = (name == "stall" && index >= 40 && index < 60) || (name == "overflow" && index < 300)
  if name == "overflow" && index >= 300 { try? await Task.sleep(nanoseconds: 1_000_000) }
  let toneIndex = name == "overflow" ? (index >= 370 ? 70 : 0) : index
  samples.enqueue(tone(index: toneIndex, rate: name == "mono" ? 24_000 : 48_000, channels: name == "mono" ? 1 : 2, interleaved: name == "interleaved"), at: at(Double(index) / 100 - ((name == "partialOverlap" || name == "interleaved") && index == 50 ? 0.005 : 0)))
  if name == "overlap" && index == 50 { samples.enqueue(tone(index: index), at: at(0.50)) }
 }
 blocked = false
 let error = await samples.finish(at: at(name == "overflow" ? 4 : 1))
 precondition(error == nil, name + ": " + String(describing: error))
 input.markAsFinished()
 await writer.finishWriting()
 precondition(writer.status == .completed, String(describing: writer.error))
 let file = try! AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
 let pcm = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))!
 try! file.read(into: pcm)
 let data = pcm.floatChannelData![0]
 var marker = -1.0
 for offset in stride(from: 0, to: Int(pcm.frameLength) - 480, by: 480) {
  if energy(data, offset: offset, count: 480, frequency: 1500) > 4 * energy(data, offset: offset, count: 480, frequency: 500) {
   marker = Double(offset) / 48_000
   break
  }
 }
 var gapPower = 0.0
 for index in 22_080..<26_400 { gapPower += Double(data[index] * data[index]) }
 return "\"\(name)\":{\"frames\":\(pcm.frameLength),\"marker\":\(marker),\"silentGap\":\(gapPower / 4320 < 0.001)}"
}
let done = DispatchSemaphore(value: 0)
Task {
 var entries: [String] = []
 for name in ["contiguous", "gap", "stall", "tail", "leading", "overlap", "partialOverlap", "interleaved", "mono", "overflow"] { entries.append(await run(name)) }
 var blocked = true
 var writable = true
 let pressure = AudioSampleQueue(isReady: { !blocked }, canWrite: { writable }, append: { _ in true })
 for index in 0..<1000 { pressure.enqueue(tone(index: index), at: at(Double(index) / 100)) }
 let failedFinish = await pressure.finish(at: at(10), timeout: 0) != nil
 let terminal = AudioSampleQueue(isReady: { false }, canWrite: { writable }, append: { _ in true })
 terminal.enqueue(tone(index: 0), at: .zero)
 writable = false
 let terminalFailure = await terminal.finish(at: at(0.01), timeout: 0) != nil
 var writes = 0
 let longGap = AudioSampleQueue(isReady: { true }, canWrite: { true }, append: { _ in writes += 1; return true })
 longGap.enqueue(tone(index: 0), at: at(10))
 precondition(writes <= 16)
 let longGapError = await longGap.finish(at: at(10), timeout: 0)
 precondition(longGapError == nil, "Progressing gap restoration must not time out")
 precondition(longGap.endTime == at(10))
 var clipReady = false
 var clippedFrames = 0
 let clipped = AudioSampleQueue(isReady: { clipReady }, canWrite: { true }, append: { clippedFrames += $0.numSamples; return true })
 for index in 0..<10 { clipped.enqueue(tone(index: index), at: at(Double(index) / 100)) }
 clipReady = true
 let clipError = await clipped.finish(at: at(0.055), timeout: 0)
 precondition(clipError == nil && clippedFrames == 2640, "Queued audio must stop at the final media time")
 print("{\"tracks\":{" + entries.joined(separator: ",") + "},\"pressure\":{\"dropped\":\(pressure.droppedBuffers),\"peakBytes\":\(pressure.peakQueuedBytes),\"peakSeconds\":\(pressure.peakQueuedDuration),\"failedFinish\":\(failedFinish),\"terminalFailure\":\(terminalFailure)}}")
 done.signal()
}
done.wait()
`,
		);
		const executable = join(directory, "probe");
		const build = spawnSync(
			"swiftc",
			[
				"-module-cache-path",
				join(directory, "cache"),
				join(directory, "main.swift"),
				"-o",
				executable,
			],
			{ encoding: "utf8", timeout: 60_000 },
		);
		expect(build.status, build.stderr).toBe(0);
		const run = spawnSync(executable, [directory], { encoding: "utf8", timeout: 30_000 });
		expect(run.status, run.stderr).toBe(0);
		({ tracks: results, pressure } = JSON.parse(run.stdout));
	}, 90_000);
	afterAll(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
	});

	it.each([
		"contiguous",
		"gap",
		"stall",
		"tail",
		"leading",
		"overlap",
		"partialOverlap",
		"interleaved",
		"mono",
	])("keeps %s audio one second long and its later tone aligned", (name) => {
		expect(results[name].frames / 48_000).toBeCloseTo(1, 1);
		expect(results[name].marker).toBeCloseTo(0.7, 1);
		expect(results[name].marker - results.contiguous.marker).toBeCloseTo(0, 2);
	});
	it("keeps later speech aligned after sustained overload exceeds the queue limit", () => {
		expect(results.overflow.frames / 48_000).toBeCloseTo(4, 1);
		expect(results.overflow.marker).toBeCloseTo(3.7, 1);
		expect(results.overflow.marker - results.contiguous.marker).toBeCloseTo(3, 2);
	});
	it("preserves an actual missing interval as silence", () => {
		expect(results.gap.silentGap).toBe(true);
	});
	it("retains speech across temporary backpressure", () => {
		expect(results.stall.silentGap).toBe(false);
	});
	it("bounds retained audio under sustained backpressure", () => {
		expect(pressure.dropped).toBeGreaterThan(0);
		expect(pressure.peakBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
		expect(pressure.peakSeconds).toBeLessThanOrEqual(2);
	});
	it("fails finalization when the encoder remains blocked or stops", () => {
		expect(pressure.failedFinish).toBe(true);
		expect(pressure.terminalFailure).toBe(true);
	});
});
