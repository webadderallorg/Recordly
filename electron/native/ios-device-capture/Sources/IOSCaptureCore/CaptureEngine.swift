import Foundation
import AVFoundation
import CoreMedia
import IOKit.pwr_mgt

/// All methods and mutable state run on `queue`; AVFoundation delegates use this same queue.
public final class CaptureEngine: NSObject, @unchecked Sendable, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate {
    public let queue = DispatchQueue(label: "recordly.ios.capture", qos: .userInitiated)
    public var emit: ((String, [String: Any], String?, String?, UInt32) -> Void)?
    public var didShutdown: (() -> Void)?
    private lazy var discovery = DeviceDiscovery(queue: queue)
    private let preview = PreviewEncoder()
    private var session: AVCaptureSession?
    private var micSession: AVCaptureSession?
    private var videoOutput: AVCaptureVideoDataOutput?
    private var deviceAudioOutput: AVCaptureAudioDataOutput?
    private var micOutput: AVCaptureAudioDataOutput?
    private var clock: CaptureClock?
    private var micClock: CaptureClock?
    private var sessionId: String?
    private var generation: UInt32 = 0
    private var source: [String: Any]?
    private var token: String?
    private var options: [String: Any] = [:]
    private var storage: SessionStorage?
    private var timing: NativeTimingStore?
    private var format: IOSVideoFormat?
    private var mode: String?
    private var descriptionHint: CMFormatDescription?
    private var video: VideoWriter?
    private var deviceAudio: AudioWriter?
    private var microphone: AudioWriter?
    private var phase = "idle"
    private var prepareRequest: String?
    private var startRequest: String?
    private var stopRequest: String?
    private var deadline: DispatchWorkItem?
    private var progressTimer: DispatchSourceTimer?
    private var observers: [NSObjectProtocol] = []
    private var finalResult: [String: Any]?
    private var shutdownPending = false
    private var delivered = 0
    private var dropped = 0
    private var assertion: IOPMAssertionID = 0
    private var armHostTime: CMTime?
    private var rawVideoNegotiation = RawVideoNegotiation()
    private var acceptedRequests = Set<String>()
    private var acceptedOrder = [String]()
    public override init() { super.init() }
    static func recommendedVideoSettings(mode: String, output: AVCaptureVideoDataOutput?) -> [String: Any]? {
        guard mode == "h264-encode", let output,
              output.availableVideoCodecTypesForAssetWriter(writingTo: .mov).contains(.h264) else { return nil }
        return output.recommendedVideoSettings(forVideoCodecType: .h264, assetWriterOutputFileType: .mov)
    }
    private func event(_ name: String, _ payload: [String: Any] = [:], request: String? = nil) {
        if name == "accepted", let request {
            if acceptedRequests.insert(request).inserted { acceptedOrder.append(request) }
            if acceptedOrder.count > 128 { acceptedRequests.remove(acceptedOrder.removeFirst()) }
        }
        // Once accepted, failures belong to the session lifecycle, not a settled request.
        let responseRequest = name == "error" && request.map(acceptedRequests.contains) == true ? nil : request
        emit?(name, payload, responseRequest, sessionId, generation)
    }
    public func handle(_ command: ProtocolCommand) {
        dispatchPrecondition(condition: .onQueue(queue))
        do {
            if let id = command.sessionId, command.command != "prepare", command.command != "inspectMedia", id != sessionId { throw CaptureFailure("INVALID_REQUEST") }
            switch command.command {
            case "hello": emit?("accepted", ["build": "recordly-ios-device-helper-1", "protocolVersion": 1, "capabilities": ["supportsPause": false, "supportsWebcam": false, "supportsTouchTelemetry": false, "previewMaxLongestEdge": 480, "previewMaxFramesPerSecond": 5, "previewMaxJpegBytes": 131072, "protocolVersion": 1]], command.requestId, nil, generation)
            case "discover":
                discovery.changed = { [weak self] snapshot in
                    guard let self else { return }; self.event("inventoryChanged", snapshot)
                    if let token = self.token, !self.discovery.contains(token: token) { self.interrupt("DEVICE_DISCONNECTED") }
                }
                let refreshDiscovery = ["idle", "failed", "completed"].contains(phase)
                try discovery.start(refresh: refreshDiscovery); event("accepted", request: command.requestId); event("inventoryChanged", discovery.snapshot(), request: command.requestId)
            case "prepare": try prepare(command)
            case "setPreviewEnabled":
                guard command.generation == generation, let enabled = command.payload["enabled"] as? Bool else { throw CaptureFailure("INVALID_REQUEST") }
                preview.setEnabled(enabled); event("accepted", request: command.requestId)
            case "start": try start(command)
            case "stop", "cancel":
                event("accepted", request: command.requestId)
                stopRequest = command.requestId
                finish(reason: command.command == "cancel" ? "cancelled" : "user-stop")
            case "release":
                guard !["starting", "recording", "finalising"].contains(phase) else { throw CaptureFailure("RECORDING_BUSY") }
                releaseInputs(); phase = "idle"; event("accepted", request: command.requestId)
            case "inspectMedia":
                guard let settings = command.storage, let name = command.payload["relativeName"] as? String else { throw CaptureFailure("INVALID_REQUEST") }
                let location = try SessionStorage(settings).file(name)
                let requestId = command.requestId, requestedSession = command.sessionId
                Task {
                    do { let result = try await MediaInspector.inspect(url: location); self.queue.async { self.emit?("accepted", ["inspection": result], requestId, requestedSession, self.generation) } }
                    catch { self.queue.async { self.event("error", ["code": "FINALIZATION_FAILED", "recoverable": true], request: requestId) } }
                }
            case "shutdown": event("accepted", request: command.requestId); shutdown()
            default: throw CaptureFailure("INVALID_REQUEST")
            }
        } catch { if command.command == "prepare" { releaseInputs(); phase = "failed" }; event("error", ["code": (error as? CaptureFailure)?.code ?? "WRITER_FAILED", "recoverable": video != nil], request: command.requestId) }
    }
    private func prepare(_ command: ProtocolCommand) throws {
        guard !["starting", "recording", "finalising", "preparing"].contains(phase) else { throw CaptureFailure("RECORDING_BUSY") }
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else { throw CaptureFailure("PERMISSION_DENIED") }
        let settings = command.payload["options"] as! [String: Any]
        let withAudio = settings["deviceAudio"] as? Bool == true
        let micToken = settings["microphoneToken"] as? String
        if withAudio || micToken != nil { guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else { throw CaptureFailure("PERMISSION_DENIED") } }
        let selectedToken = command.payload["deviceToken"] as! String
        let selected = try discovery.device(token: selectedToken, generation: (command.payload["inventoryGeneration"] as! NSNumber).intValue)
        let destination = try SessionStorage(command.storage!)
        guard try destination.availableBytes() >= 1024 * 1024 * 1024 else { throw CaptureFailure("DISK_SPACE_LOW") }
        releaseInputs()
        sessionId = command.sessionId; generation = command.generation ?? (generation &+ 1); source = discovery.source(token: selectedToken); token = selectedToken; options = settings; storage = destination
        rawVideoNegotiation = RawVideoNegotiation(); format = nil; mode = nil; video = nil; deviceAudio = nil; microphone = nil; finalResult = nil; delivered = 0; dropped = 0
        let capture = AVCaptureSession(); capture.beginConfiguration()
        let input = try AVCaptureDeviceInput(device: selected)
        guard capture.canAddInput(input) else { throw CaptureFailure("DEVICE_BUSY") }; capture.addInput(input)
        let output = AVCaptureVideoDataOutput(); output.videoSettings = [:]; output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        guard capture.canAddOutput(output) else { throw CaptureFailure("UNSUPPORTED_FORMAT") }; capture.addOutput(output)
        if withAudio {
            let audio = AVCaptureAudioDataOutput(); audio.audioSettings = [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false]
            audio.setSampleBufferDelegate(self, queue: queue)
            guard capture.canAddOutput(audio) else { throw CaptureFailure("UNSUPPORTED_FORMAT") }; capture.addOutput(audio); deviceAudioOutput = audio
        }
        capture.commitConfiguration(); session = capture; videoOutput = output
        if let micToken {
            let device = try discovery.microphone(token: micToken)
            guard device.uniqueID != selected.uniqueID else { throw CaptureFailure("INVALID_REQUEST") }
            let mic = AVCaptureSession(); mic.beginConfiguration()
            let micInput = try AVCaptureDeviceInput(device: device)
            let audio = AVCaptureAudioDataOutput(); audio.audioSettings = [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false]; audio.setSampleBufferDelegate(self, queue: queue)
            guard mic.canAddInput(micInput), mic.canAddOutput(audio) else { throw CaptureFailure("DEVICE_BUSY") }
            mic.addInput(micInput); mic.addOutput(audio); mic.commitConfiguration(); micSession = mic; micOutput = audio
        }
        for active in [capture, micSession].compactMap({ $0 }) {
            observers.append(NotificationCenter.default.addObserver(forName: .AVCaptureSessionRuntimeError, object: active, queue: nil) { [weak self] _ in self?.queue.async { self?.interrupt("DEVICE_DISCONNECTED") } })
            observers.append(NotificationCenter.default.addObserver(forName: AVCaptureDevice.wasDisconnectedNotification, object: nil, queue: nil) { [weak self, weak active] notification in
                guard let lost = notification.object as? AVCaptureDevice, active?.inputs.compactMap({ $0 as? AVCaptureDeviceInput }).contains(where: { $0.device.uniqueID == lost.uniqueID }) == true else { return }
                self?.queue.async { self?.interrupt("DEVICE_DISCONNECTED") }
            })
        }
        phase = "preparing"; prepareRequest = command.requestId
        event("accepted", request: command.requestId)
        capture.startRunning(); micSession?.startRunning()
        clock = try CaptureClock(session: capture)
        if let micSession { micClock = try CaptureClock(session: micSession) }
        armDeadline()
    }
    private func armDeadline() {
        deadline?.cancel()
        let work = DispatchWorkItem { [weak self] in guard let self, ["preparing", "starting"].contains(self.phase) else { return }; self.interrupt("NO_VIDEO_SAMPLES") }
        deadline = work; queue.asyncAfter(deadline: .now() + 10, execute: work)
    }
    private func start(_ command: ProtocolCommand) throws {
        guard phase == "ready", let storage, let format, let mode, let descriptionHint, let session, session.isRunning else { throw CaptureFailure("INVALID_REQUEST") }
        guard try storage.availableBytes() >= 1024 * 1024 * 1024 else { throw CaptureFailure("DISK_SPACE_LOW") }
        let boundary = CaptureClock.now
        video = try VideoWriter(url: storage.file("source-video.mov", creating: true), format: format, mode: mode, description: descriptionHint, boundary: boundary, recommended: Self.recommendedVideoSettings(mode: mode, output: videoOutput))
        timing = try NativeTimingStore(storage: storage); armHostTime = boundary
        phase = "starting"; startRequest = command.requestId
        try checkpoint(reason: nil)
        event("accepted", request: command.requestId); armDeadline()
        let timer = DispatchSource.makeTimerSource(queue: queue); timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in self?.tick() }; timer.resume(); progressTimer = timer
        _ = IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleSystemSleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn), "Device recording" as CFString, &assertion)
    }
    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        autoreleasepool {
            do {
                guard CMSampleBufferGetNumSamples(sampleBuffer) > 0 else { return }
                guard output === videoOutput || output === deviceAudioOutput || output === micOutput, let clock = output === micOutput ? micClock : clock else { return }
                let sample = try VideoFormatPolicy.normalizeRawGeometry(clock.map(sampleBuffer))
                if output === videoOutput {
                    delivered += 1
                    if phase == "preparing" {
                        let rawPixelFormat = CMSampleBufferGetImageBuffer(sample).map(CVPixelBufferGetPixelFormatType)
                        let supportsPassthrough = CMSampleBufferGetFormatDescription(sample).map(VideoFormatPolicy.supportsPassthrough) ?? false
                        switch try rawVideoNegotiation.observe(rawPixelFormat: rawPixelFormat, supportsPassthrough: supportsPassthrough, availablePixelFormats: videoOutput?.availableVideoPixelFormatTypes ?? []) {
                        case .requestRaw(let pixelFormat):
                            guard let videoOutput else { throw CaptureFailure("UNSUPPORTED_FORMAT") }
                            videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: pixelFormat]
                            return
                        case .waitForRaw:
                            // Keep the original preparation deadline; queued packets cannot extend it.
                            return
                        case .inspectSample:
                            break
                        }

                        let (observed, selectedMode) = try VideoFormatPolicy.inspect(sample)
                        if selectedMode == "passthrough", !VideoFormatPolicy.isSync(sample) { return }
                        try MediaInspector.validateFirstSample(sample)
                        let preflightURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
                        _ = try VideoWriter(url: preflightURL, format: observed, mode: selectedMode, description: CMSampleBufferGetFormatDescription(sample)!, boundary: .zero, recommended: Self.recommendedVideoSettings(mode: selectedMode, output: videoOutput))
                        try? FileManager.default.removeItem(at: preflightURL)
                        format = observed; mode = selectedMode; descriptionHint = CMSampleBufferGetFormatDescription(sample)
                        deadline?.cancel(); phase = "ready"
                        event("prepared", ["source": source!, "options": options, "format": try jsonObject(observed), "mode": selectedMode], request: prepareRequest)
                    }
                    if let format, ["ready", "starting", "recording"].contains(phase) {
                        let (observed, _) = try VideoFormatPolicy.inspect(sample)
                        guard observed.fingerprint == format.fingerprint else { throw CaptureFailure("FORMAT_CHANGED") }
                        preview.submit(sampleBuffer, generation: generation)
                    }
                    if ["starting", "recording"].contains(phase), let video, try video.append(sample), phase == "starting" {
                        deadline?.cancel(); phase = "recording"; try checkpoint(reason: nil)
                        event("recordingStarted", ["firstHostTime": try jsonObject(NativeTime(video.firstHostTime!)), "acceptedVideoSamples": video.sampleCount], request: startRequest)
                    }
                } else if ["starting", "recording"].contains(phase), let storage, let armHostTime, CMSampleBufferGetPresentationTimeStamp(sample) >= armHostTime {
                    if output === deviceAudioOutput {
                        if deviceAudio == nil { deviceAudio = try AudioWriter(url: storage.file("device-audio.mov", creating: true), firstSample: sample) }
                        try deviceAudio?.append(sample)
                    } else if output === micOutput {
                        if microphone == nil { microphone = try AudioWriter(url: storage.file("microphone.mov", creating: true), firstSample: sample) }
                        try microphone?.append(sample)
                    }
                    if deviceAudio?.sampleCount == CMSampleBufferGetNumSamples(sample) || microphone?.sampleCount == CMSampleBufferGetNumSamples(sample) { try checkpoint(reason: nil) }
                }
            } catch { interrupt((error as? CaptureFailure)?.code ?? "WRITER_FAILED") }
        }
    }
    public func captureOutput(_ output: AVCaptureOutput, didDrop sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        dropped += 1
        if ["starting", "recording"].contains(phase) { interrupt("WRITER_FAILED") }
    }
    private func tick() {
        guard ["starting", "recording"].contains(phase) else { return }
        do {
            try checkpoint(reason: nil)
            let elapsed = video?.firstHostTime.map { max(0, CMTimeSubtract(CaptureClock.now, $0).seconds) } ?? 0
            if let storage {
                let bytes = try storage.writtenMediaBytes()
                let mixAudio = options["deviceAudio"] as? Bool == true || options["microphoneToken"] is String
                let reserve = StorageReservePolicy.requiredBytes(writtenBytes: bytes.total, videoBytes: bytes.video, elapsedSeconds: elapsed, mixAudio: mixAudio)
                guard try storage.availableBytes() > reserve else { throw CaptureFailure("DISK_SPACE_LOW") }
            }
            event("progress", ["elapsedMs": elapsed * 1000, "acceptedVideoSamples": video?.sampleCount ?? 0])
        } catch { interrupt((error as? CaptureFailure)?.code ?? "WRITER_FAILED") }
    }
    private func interrupt(_ code: String) {
        guard !["idle", "failed", "completed", "finalising"].contains(phase) else { return }
        event("warning", ["code": code])
        if video != nil { finish(reason: code) }
        else { event("error", ["code": code, "recoverable": false], request: prepareRequest); releaseInputs(); phase = "failed" }
    }
    private func artifact(name: String, kind: String, first: CMTime, end: CMTime, count: Int, metadata: [String: Any]) throws -> [String: Any] {
        ["relativeName": name, "mediaKind": kind, "firstHostTime": try jsonObject(NativeTime(first)), "duration": try jsonObject(NativeTime(CMTimeSubtract(end, first))), "sampleCount": count, "mediaFormat": metadata]
    }
    private func artifacts() throws -> [[String: Any]] {
        var items = [[String: Any]]()
        if let video, let first = video.firstHostTime, let format {
            items.append(try artifact(name: "source-video.mov", kind: "video", first: first, end: video.endHostTime ?? CaptureClock.now, count: video.sampleCount, metadata: ["codec": "h264", "width": format.codedWidth, "height": format.codedHeight]))
        }
        for (writer, name, kind) in [(deviceAudio, "device-audio.mov", "device-audio"), (microphone, "microphone.mov", "microphone")] {
            if let writer, writer.sampleCount > 0 { items.append(try artifact(name: name, kind: kind, first: writer.firstHostTime, end: writer.endHostTime, count: writer.sampleCount, metadata: ["codec": "pcm", "sampleRate": writer.sampleRate, "channels": writer.channels])) }
        }
        return items
    }
    private func timingObject() throws -> [String: Any] {
        let items = try artifacts()
        let streams = items.map { item -> [String: Any] in
            let kind = item["mediaKind"] as! String
            let writer = kind == "device-audio" ? deviceAudio : (kind == "microphone" ? microphone : nil)
            return ["mediaKind": kind, "firstHostTime": item["firstHostTime"]!, "duration": item["duration"]!, "rate": ["numerator": "1", "denominator": "1"], "clockAnchor": ["hostTime": item["firstHostTime"]!, "mediaTime": ["value": "0", "timescale": 1]], "gaps": writer?.gaps.map { ["start": $0["start"]!, "duration": $0["duration"]!] } ?? []]
        }
        return ["version": 1, "timeline": "host-mapped", "gapsRepresentedInMedia": true, "streams": streams]
    }
    private func checkpoint(reason: String?) throws {
        guard let timing, let sessionId else { return }
        var record: [String: Any] = ["version": 1, "sessionId": sessionId, "phase": phase, "timing": try timingObject(), "deliveredVideoSamples": delivered, "acceptedVideoSamples": video?.sampleCount ?? 0, "droppedVideoSamples": dropped]
        if let reason { record["stopReason"] = reason }; if let finalResult { record["result"] = finalResult }
        try timing.checkpoint(record)
    }
    private func finish(reason: String) {
        if let finalResult { event("nativeFinalized", ["result": finalResult], request: stopRequest); return }
        guard phase != "finalising" else { return }
        deadline?.cancel(); progressTimer?.cancel(); progressTimer = nil
        guard let video, video.sampleCount > 0 else {
            try? checkpoint(reason: reason); releaseInputs(); phase = "cancelled"
            event("error", ["code": "NO_VIDEO_SAMPLES", "recoverable": false], request: stopRequest ?? startRequest)
            if shutdownPending { didShutdown?() }; return
        }
        let stop = CaptureClock.now; phase = "finalising"
        session?.stopRunning(); micSession?.stopRunning(); preview.setEnabled(false)
        let group = DispatchGroup(); var failure: Error?
        group.enter(); video.finish(at: stop) { result in self.queue.async { if case .failure(let error) = result { failure = error }; group.leave() } }
        for audio in [deviceAudio, microphone].compactMap({ $0 }) { group.enter(); audio.finish { result in self.queue.async { if case .failure(let error) = result { failure = error }; group.leave() } } }
        group.notify(queue: queue) {
            if let failure { self.completeFailure(failure, reason: reason); return }
            guard let storage = self.storage else { self.completeFailure(CaptureFailure("FINALIZATION_FAILED"), reason: reason); return }
            Task {
                do {
                    let inspection = try await MediaInspector.inspect(url: storage.file("source-video.mov"))
                    guard inspection["decodable"] as? Bool == true else { throw CaptureFailure("FINALIZATION_FAILED") }
                    self.queue.async { self.completeSuccess(reason: reason) }
                } catch { self.queue.async { self.completeFailure(error, reason: reason) } }
            }
        }
    }
    private func completeSuccess(reason: String) {
        do {
            let items = try artifacts()
            guard let main = items.first(where: { $0["mediaKind"] as? String == "video" }), let format, let mode, let sessionId else { throw CaptureFailure("FINALIZATION_FAILED") }
            var result: [String: Any] = ["sessionId": sessionId, "stopReason": reason, "format": try jsonObject(format), "mode": mode, "video": main, "timingFile": "native-timing.json", "timing": try timingObject()]
            result["deviceAudio"] = items.first(where: { $0["mediaKind"] as? String == "device-audio" }); result["microphone"] = items.first(where: { $0["mediaKind"] as? String == "microphone" })
            if options["deviceAudio"] as? Bool == true && deviceAudio == nil { event("warning", ["code": "AUDIO_INTERRUPTED"]) }
            finalResult = result; phase = "completed"; try checkpoint(reason: reason)
            releaseInputs(); event("nativeFinalized", ["result": result], request: stopRequest)
            if shutdownPending { didShutdown?() }
        } catch { completeFailure(error, reason: reason) }
    }
    private func completeFailure(_ error: Error, reason: String) { phase = "failed"; try? checkpoint(reason: reason); releaseInputs(); event("error", ["code": (error as? CaptureFailure)?.code ?? "FINALIZATION_FAILED", "recoverable": true], request: stopRequest); if shutdownPending { didShutdown?() } }
    private func releaseInputs() {
        deadline?.cancel(); progressTimer?.cancel(); progressTimer = nil; preview.setEnabled(false)
        session?.stopRunning(); micSession?.stopRunning()
        videoOutput?.setSampleBufferDelegate(nil, queue: nil); deviceAudioOutput?.setSampleBufferDelegate(nil, queue: nil); micOutput?.setSampleBufferDelegate(nil, queue: nil)
        observers.forEach(NotificationCenter.default.removeObserver); observers.removeAll()
        session = nil; micSession = nil; videoOutput = nil; deviceAudioOutput = nil; micOutput = nil; clock = nil; micClock = nil
        if assertion != 0 { IOPMAssertionRelease(assertion); assertion = 0 }
    }
    public func shutdown() { shutdownPending = true; discovery.stop(); if ["starting", "recording", "finalising"].contains(phase) { finish(reason: "parent-exit") } else { releaseInputs(); didShutdown?() } }
}
