import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffprobe from "ffprobe-static";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Compile and execute the production PCM queue, with synthetic samples only.
// This suite never requests screen, camera, or microphone access.
describe.skipIf(process.platform !== "darwin")("native recording audio continuity", () => {
	let directory: string;
	let executable: string;
	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), "recordly-native-audio-"));
		executable = join(directory, "probe");
		const source = readFileSync(
			new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
			"utf8",
		);
		const queueSource = source.slice(0, source.indexOf("final class RecorderService"));
		writeFileSync(
			join(directory, "main.swift"),
			`${queueSource}
func check(_ condition: Bool, _ reason: String) {
    if !condition { fputs("FAIL: \\(reason)\\n", stderr); exit(2) }
}
func sample(_ time: Double, frames: Int = 4800, value: Float = 0.25) -> CMSampleBuffer {
    let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)!
    let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames))!
    pcm.frameLength = AVAudioFrameCount(frames)
    for channel in 0..<2 {
        for index in 0..<frames { pcm.floatChannelData![channel][index] = value }
    }
    var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48000), presentationTimeStamp: CMTime(seconds: time, preferredTimescale: 48000), decodeTimeStamp: .invalid)
    var buffer: CMSampleBuffer?
    check(CMSampleBufferCreate(allocator: kCFAllocatorDefault, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil, refcon: nil, formatDescription: format.formatDescription, sampleCount: frames, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil, sampleBufferOut: &buffer) == noErr, "create PCM sample")
    check(CMSampleBufferSetDataBufferFromAudioBufferList(buffer!, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, bufferList: pcm.audioBufferList) == noErr, "attach PCM data")
    return buffer!
}
// Match the real three-channel interleaved microphone callback: valid PCM,
// but no channel layout in its CoreMedia description.
func microphoneSampleWithoutLayout() -> CMSampleBuffer {
    var asbd = AudioStreamBasicDescription(mSampleRate: 48000, mFormatID: kAudioFormatLinearPCM, mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked, mBytesPerPacket: 12, mFramesPerPacket: 1, mBytesPerFrame: 12, mChannelsPerFrame: 3, mBitsPerChannel: 32, mReserved: 0)
    var description: CMAudioFormatDescription?
    check(CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &description) == noErr, "microphone format without layout")
    let layout = AVAudioChannelLayout(layoutTag: kAudioChannelLayoutTag_DiscreteInOrder | 3)!
    let format = AVAudioFormat(streamDescription: &asbd, channelLayout: layout)!
    let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4800)!
    pcm.frameLength = 4800
    for index in 0..<4800 {
        for channel in 0..<3 { pcm.floatChannelData![0][index * 3 + channel] = Float(channel + 1) / 4 }
    }
    var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48000), presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
    var buffer: CMSampleBuffer?
    check(CMSampleBufferCreate(allocator: kCFAllocatorDefault, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil, refcon: nil, formatDescription: description!, sampleCount: 4800, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil, sampleBufferOut: &buffer) == noErr, "microphone sample")
    check(CMSampleBufferSetDataBufferFromAudioBufferList(buffer!, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, bufferList: pcm.audioBufferList) == noErr, "microphone data")
    return buffer!
}
func time(_ value: Double) -> CMTime { CMTime(seconds: value, preferredTimescale: 48000) }
extension ScreenCaptureRecorder {
    func mappedCaptureTime(_ value: Double, outputType: SCStreamOutputType) -> CMTime {
        self.firstSampleTime = time(100)
        return self.adjustedPresentationTime(for: sample(100 + value), outputType: outputType)!
    }
    func simulateInterruptedStream(_ path: String, interrupt: Bool = true, elapsed: Double = 0.5) throws {
        let writer = try AVAssetWriter(url: URL(fileURLWithPath: path), fileType: .mp4)
        let video = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 16, AVVideoHeightKey: 16])
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: video, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: 16, kCVPixelBufferHeightKey as String: 16])
        let audio = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 160000])
        let realtime = CommandLine.arguments.count < 4 || CommandLine.arguments[3] != "buffered"
        video.expectsMediaDataInRealTime = realtime
        audio.expectsMediaDataInRealTime = realtime
        writer.add(video)
        writer.add(audio)
        check(writer.startWriting(), "partial writer starts")
        writer.startSession(atSourceTime: .zero)
        var pixel: CVPixelBuffer?
        check(CVPixelBufferCreate(kCFAllocatorDefault, 16, 16, kCVPixelFormatType_32BGRA, nil, &pixel) == kCVReturnSuccess, "synthetic video buffer")
        CVPixelBufferLockBaseAddress(pixel!, [])
        memset(CVPixelBufferGetBaseAddress(pixel!)!, 0, CVPixelBufferGetDataSize(pixel!))
        CVPixelBufferUnlockBaseAddress(pixel!, [])
        while !video.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.001) }
        check(adaptor.append(pixel!, withPresentationTime: .zero), "partial first video frame")
        while !video.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.001) }
        check(adaptor.append(pixel!, withPresentationTime: time(0.4)), "partial last video frame")
        self.assetWriter = writer
        self.videoInput = video
        self.videoPixelBufferAdaptor = adaptor
        self.lastCroppedPixelBuffer = pixel
        var videoFormat: CMVideoFormatDescription?
        check(CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixel!, formatDescriptionOut: &videoFormat) == noErr, "video format")
        var videoTiming = CMSampleTimingInfo(duration: time(1.0 / 60), presentationTimeStamp: time(0.4), decodeTimeStamp: .invalid)
        var videoSample: CMSampleBuffer?
        check(CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixel!, formatDescription: videoFormat!, sampleTiming: &videoTiming, sampleBufferOut: &videoSample) == noErr, "video sample")
        self.lastSampleBuffer = videoSample
        self.inlineAudioInput = audio
        self.outputURL = URL(fileURLWithPath: path)
        self.firstSampleTime = CMClockGetTime(CMClockGetHostTimeClock()) - time(elapsed)
        self.lastVideoPresentationTime = time(0.4)
        self.lastVideoDuration = time(1.0 / 60)
        self.frameCount = 2
        self.sessionStarted = true
        self.isRecording = true
        self.appendAudioSampleBuffer(sample(0), to: audio, of: writer, firstSampleTime: &self.firstInlineAudioSampleTime, lastPresentationTime: &self.lastInlineAudioPresentationTime, presentationTime: .zero)
        if interrupt {
            self.queue.async { self.interruptCapture(NSError(domain: "synthetic-stream-error", code: 55, userInfo: [NSLocalizedDescriptionKey: "Synthetic stream interruption"])) }
        } else {
            self.startStillFrameTimer()
        }
    }
    func simulateEmptyAudioCallbacks() {
        let invalid = sample(0)
        check(CMSampleBufferInvalidate(invalid) == noErr, "invalidate callback buffer")
        self.deliverAudioSampleBuffer(invalid, of: .audio, from: nil)
        var empty: CMSampleBuffer?
        let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)!
        check(CMSampleBufferCreate(allocator: kCFAllocatorDefault, dataBuffer: nil, dataReady: true, makeDataReadyCallback: nil, refcon: nil, formatDescription: format.formatDescription, sampleCount: 0, sampleTimingEntryCount: 0, sampleTimingArray: nil, sampleSizeEntryCount: 0, sampleSizeArray: nil, sampleBufferOut: &empty) == noErr, "empty callback buffer")
        self.deliverAudioSampleBuffer(empty!, of: .audio, from: nil)
    }
}
func run(_ mode: String) async {
    if mode == "empty-callback" {
        let recorder = ScreenCaptureRecorder()
        try! recorder.simulateInterruptedStream(CommandLine.arguments[2], interrupt: false)
        recorder.simulateEmptyAudioCallbacks()
        try? await Task.sleep(nanoseconds: 20_000_000)
        _ = try! await recorder.stopCapture()
        return
    }
    if mode == "still-stop" {
        let recorder = ScreenCaptureRecorder()
        try! recorder.simulateInterruptedStream(CommandLine.arguments[2], interrupt: false, elapsed: 5)
        try? await Task.sleep(nanoseconds: 600_000_000)
        let path = try! await recorder.stopCapture()
        check(path == CommandLine.arguments[2], "still recording path")
        return
    }
    if mode == "interruption" {
        let recorder = ScreenCaptureRecorder()
        try! recorder.simulateInterruptedStream(CommandLine.arguments[2])
        // The actual interruption/finalization path must terminate this subprocess.
        while true { try? await Task.sleep(nanoseconds: 100_000_000) }
    }
    if mode == "devices" {
        let devices = [(name: "USB Mic", uniqueID: "usb"), (name: "Built-in", uniqueID: "internal")]
        check(matchMicrophoneCaptureDeviceID(label: "USB Mic", deviceId: "chromium-hash", devices: devices) == "usb", "unique label match")
        check(matchMicrophoneCaptureDeviceID(label: "Built-in", deviceId: "usb", devices: devices) == "usb", "native identity takes priority")
        check(matchMicrophoneCaptureDeviceID(label: "Missing", deviceId: "hash", devices: devices) == nil, "missing selection does not map to default")
        check(matchMicrophoneCaptureDeviceID(label: "USB Mic", deviceId: "hash", devices: [("USB Mic", "one"), ("USB Mic", "two")]) == nil, "ambiguous labels do not choose arbitrarily")
        check(matchMicrophoneCaptureDeviceID(label: "USB Mic (14ed:1012)", deviceId: "chromium-hash", devices: devices) == "usb", "Chromium transport suffix is removed")
        check(matchMicrophoneCaptureDeviceID(label: "USB Mic (14ed:1012)", deviceId: "internal", devices: devices) == "internal", "native identity beats stripped label")
        check(matchMicrophoneCaptureDeviceID(label: "USB Mic (Built-in)", deviceId: "hash", devices: [("USB Mic", "one"), ("USB Mic", "two")]) == nil, "ambiguous stripped labels do not choose arbitrarily")
        check(matchMicrophoneCaptureDeviceID(label: "USB Mic (Built-in)", deviceId: "hash", devices: [("USB Mic (Built-in)", "exact"), ("USB Mic", "stripped")]) == "exact", "literal suffix in actual device name is preserved")
        return
    }
    if mode == "delivery" {
        let budget = AudioDeliveryBudget()
        check(budget.reserve(bytes: 1, duration: 1).accepted, "first bounded delivery")
        budget.release(bytes: 1, duration: 1)
        check(budget.reserve(bytes: 4 * 1024 * 1024, duration: 1).accepted, "byte budget inclusive")
        let overflow = budget.reserve(bytes: 1, duration: 0.1)
        check(!overflow.accepted && overflow.reportFailure, "overflow is terminal and reported")
        check(!budget.reserve(bytes: 1, duration: 0.1).reportFailure, "only one failure dispatch")
        let durationBudget = AudioDeliveryBudget()
        check(!durationBudget.reserve(bytes: 1, duration: 2.1).accepted, "time budget enforced")
        return
    }
    if mode == "aac" {
        let output = URL(fileURLWithPath: CommandLine.arguments[2])
        let writer = try! AVAssetWriter(url: output, fileType: .m4a)
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 160000])
        input.expectsMediaDataInRealTime = true
        writer.add(input)
        check(writer.startWriting(), "AAC writer starts")
        writer.startSession(atSourceTime: .zero)
        let queue = AudioSampleQueue(isReady: { input.isReadyForMoreMediaData }, canWrite: { writer.status == .writing }, append: { input.append($0) })
        for index in 0..<150 {
            if [25, 50, 75, 100, 125].contains(index) { continue }
            while !input.isReadyForMoreMediaData { try? await Task.sleep(nanoseconds: 1_000_000) }
            queue.enqueue(sample(Double(index) / 10), at: time(Double(index) / 10))
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        let failure = await queue.finish(at: time(15))
        check(failure == nil, "AAC queue completes: \\(failure?.localizedDescription ?? "")")
        check(abs(queue.endTime.seconds - 15) < 0.0001, "AAC timeline retains 15 seconds")
        check(queue.silenceFrames == 24000, "500ms of missing input represented as silence")
        input.markAsFinished()
        await writer.finishWriting()
        check(writer.status == .completed, "AAC file finalized")
        return
    }
    var ready = mode != "stall" && mode != "bounds" && mode != "timeout"
    var appended: [CMSampleBuffer] = []
    let queue = AudioSampleQueue(isReady: { ready }, canWrite: { true }, append: { appended.append($0); return true })
    switch mode {
    case "multichannel-microphone":
        let microphone = microphoneSampleWithoutLayout()
        check(CMAudioFormatDescriptionGetChannelLayout(microphone.formatDescription!, sizeOut: nil) == nil, "repro has no channel layout")
        queue.enqueue(microphone, at: time(-0.05))
        queue.enqueue(microphone, at: time(0.05))
        queue.enqueue(microphone, at: time(0.2))
        check(await queue.finish(at: time(0.35)) == nil, "multichannel startup, gap and tail complete")
        check(appended.reduce(0) { $0 + $1.numSamples } == 16800, "microphone timeline retains all frames")
        check(appended[0].numSamples == 2400, "microphone trims pre-video frames")
        check(queue.silenceFrames == 4800, "multichannel gaps and tail are silent")
        for buffer in appended {
            check(buffer.formatDescription!.audioStreamBasicDescription!.mChannelsPerFrame == 3, "channel count preserved")
            var values = [Float](repeating: -1, count: buffer.numSamples * 3)
            let data = buffer.dataBuffer!
            let status = values.withUnsafeMutableBytes { bytes in CMBlockBufferCopyDataBytes(data, atOffset: 0, dataLength: data.dataLength, destination: bytes.baseAddress!) }
            check(status == noErr, "read multichannel PCM")
            let silence = buffer.presentationTimeStamp == time(0.15) || buffer.presentationTimeStamp == time(0.3)
            for index in values.indices {
                check(abs(values[index] - (silence ? 0 : Float(index % 3 + 1) / 4)) < 0.0001, "trim preserves channel values and padding is zero")
            }
        }
    case "start-boundary":
        let recorder = ScreenCaptureRecorder()
        // An audio callback may cover both sides of video's first frame.
        // Keep only its post-origin samples; the next packet must stay at 50ms.
        let first = recorder.mappedCaptureTime(-0.05, outputType: .audio)
        queue.enqueue(sample(-0.05, value: 0.25), at: first)
        queue.enqueue(sample(0.05, value: 0.75), at: recorder.mappedCaptureTime(0.05, outputType: .audio))
        check(await queue.finish(at: time(0.15)) == nil, "straddling packet completes")
        check(appended.count == 2, "two post-origin audio portions")
        check(appended[0].numSamples == 2400, "pre-origin samples trimmed")
        check(appended[1].numSamples == 4800, "following speech is retained in full")
        check(appended[1].presentationTimeStamp == time(0.05), "next packet stays at its capture time")
        check(recorder.mappedCaptureTime(-0.05, outputType: .screen) == .zero, "video still starts at zero")
    case "timeline":
        queue.enqueue(sample(0), at: .zero)
        queue.enqueue(sample(0.6), at: time(0.6))
        check(await queue.finish(at: time(0.8)) == nil, "gap and tail finish")
        check(appended.reduce(0) { $0 + $1.numSamples } == 38400, "missing intervals preserve total PCM duration")
        check(queue.silenceFrames == 28800, "gap and tail silence count")
    case "stall":
        queue.enqueue(sample(0), at: .zero)
        queue.enqueue(sample(0.1), at: time(0.1))
        check(appended.isEmpty, "temporary backpressure retains speech")
        ready = true
        check(await queue.finish(at: time(0.2)) == nil, "stalled input drains")
        check(appended.reduce(0) { $0 + $1.numSamples } == 9600 && queue.silenceFrames == 0, "both speech buffers retained")
    case "bounds":
        for index in 0..<30 { queue.enqueue(sample(Double(index) / 10), at: time(Double(index) / 10)) }
        check(queue.failure != nil, "sustained encoder overload fails explicitly")
        check(queue.peakQueuedDuration <= 2 && queue.peakQueuedBytes <= 4 * 1024 * 1024, "encoder memory/time bounded")
    case "timeout":
        queue.enqueue(sample(0), at: .zero)
        let started = ProcessInfo.processInfo.systemUptime
        check(await queue.finish(at: time(0.1), timeout: 0.03) != nil, "permanent stall errors")
        check(ProcessInfo.processInfo.systemUptime - started < 0.5, "stall deadline bounded")
    case "long-gap":
        queue.enqueue(sample(0), at: .zero)
        queue.enqueue(sample(15), at: time(15))
        check(await queue.finish(at: time(15.1)) == nil, "long gap drains across batches")
        check(abs(queue.endTime.seconds - 15.1) < 0.0001, "gap beyond 10 seconds never compacts")
        check(appended.reduce(0) { $0 + $1.numSamples } == 724800, "long gap PCM frame count")
    case "overlap":
        queue.enqueue(sample(0), at: .zero)
        queue.enqueue(sample(0.05), at: time(0.05))
        check(await queue.finish(at: time(0.15)) == nil, "overlap trimmed")
        check(appended.reduce(0) { $0 + $1.numSamples } == 7200, "overlap does not duplicate time")
    case "invalid-gap":
        queue.enqueue(sample(121), at: time(121))
        check(queue.failure != nil, "pathological timestamp errors rather than unbounded silence")
    default: fatalError("unknown probe")
    }
}
Task { await run(CommandLine.arguments[1]); print("PASS"); exit(0) }
dispatchMain()
`,
		);
		const build = spawnSync("swiftc", ["-O", join(directory, "main.swift"), "-o", executable], {
			encoding: "utf8",
			timeout: 60_000,
		});
		expect(build.status, build.stderr).toBe(0);
	}, 60_000);
	afterAll(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
	});
	it.each([
		"multichannel-microphone",
		"start-boundary",
		"timeline",
		"stall",
		"bounds",
		"timeout",
		"long-gap",
		"overlap",
		"invalid-gap",
		"devices",
		"delivery",
	])("handles %s with real PCM buffers", (mode) => {
		const result = spawnSync(executable, [mode], { encoding: "utf8", timeout: 10_000 });
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain("PASS");
	});
	it("ignores invalid and empty audio callbacks without interrupting a valid recording", () => {
		const output = join(directory, "empty-callback.mp4");
		const result = spawnSync(executable, ["empty-callback", output], {
			encoding: "utf8",
			timeout: 10_000,
		});
		expect(result.status, result.stderr).toBe(0);
		expect(result.stderr).not.toContain("CAPTURE_INTERRUPTED");
	});

	// Allow both bounded native processes to finish under the full suite's CPU load.
	it.each([
		"realtime",
		"buffered",
	])("keeps a still frame and its audio through the real stop time (%s)", (mode) => {
		const output = join(directory, `still-${mode}.mp4`);
		const result = spawnSync(executable, ["still-stop", output, mode], {
			encoding: "utf8",
			timeout: 15_000,
		});
		expect(result.status, result.stderr).toBe(0);
		const probe = spawnSync(
			ffprobe.path,
			["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "json", output],
			{ encoding: "utf8", timeout: 10_000 },
		);
		expect(probe.status, probe.stderr).toBe(0);
		for (const stream of JSON.parse(probe.stdout).streams) {
			expect(Number(stream.duration)).toBeGreaterThanOrEqual(5);
			expect(Number(stream.duration)).toBeLessThan(7);
		}
	}, 30_000);

	it("finalizes playable partial audio/video and exits after a stream interruption", () => {
		const output = join(directory, "interrupted.mp4");
		const result = spawnSync(executable, ["interruption", output], {
			encoding: "utf8",
			timeout: 15_000,
		});
		expect(result.signal, result.stderr).toBeNull();
		expect(result.status, result.stderr).toBe(1);
		expect(result.stderr).toContain("CAPTURE_INTERRUPTED: Synthetic stream interruption");
		expect(result.stdout).toContain(`Recording interrupted. Output path: ${output}`);
		const probe = spawnSync(
			ffprobe.path,
			["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", output],
			{ encoding: "utf8", timeout: 5_000 },
		);
		expect(probe.status, probe.stderr).toBe(0);
		expect(
			JSON.parse(probe.stdout)
				.streams.map((stream: { codec_type: string }) => stream.codec_type)
				.sort(),
		).toEqual(["audio", "video"]);
	});

	it("preserves the AAC timeline after 500ms of missing source samples over 15s", () => {
		const output = join(directory, "gap.m4a");
		const result = spawnSync(executable, ["aac", output], {
			encoding: "utf8",
			timeout: 15_000,
		});
		expect(result.status, result.stderr).toBe(0);
		const probe = spawnSync(
			ffprobe.path,
			["-v", "error", "-show_entries", "stream=duration", "-of", "json", output],
			{ encoding: "utf8", timeout: 5_000 },
		);
		expect(probe.status, probe.stderr).toBe(0);
		const duration = Number(JSON.parse(probe.stdout).streams[0].duration);
		// AAC priming and whole packets can add a few frames; a 500ms compaction cannot pass.
		expect(duration).toBeGreaterThanOrEqual(15);
		expect(duration).toBeLessThan(15.1);
	});
});
