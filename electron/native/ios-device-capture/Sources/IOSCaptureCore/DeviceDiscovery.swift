import Foundation
import AVFoundation
import CoreMediaIO

/// Owns discovery observation and scheduling separately from the hardware inventory.
/// Every state transition and reconciliation runs on the engine queue.
final class DiscoveryLifecycle {
    private let queue: DispatchQueue
    private let pollInterval: TimeInterval
    private let coalescingInterval: TimeInterval
    private let observe: (@escaping () -> Void) throws -> (() -> Void)
    private let reconcile: () -> Void
    private var cancelObservation: (() -> Void)?
    private var poll: DispatchSourceTimer?
    private var coalesced: DispatchWorkItem?
    private var generation = 0

    init(queue: DispatchQueue, pollInterval: TimeInterval = 2, coalescingInterval: TimeInterval = 0.25,
         observe: @escaping (@escaping () -> Void) throws -> (() -> Void), reconcile: @escaping () -> Void) {
        self.queue = queue
        self.pollInterval = pollInterval
        self.coalescingInterval = coalescingInterval
        self.observe = observe
        self.reconcile = reconcile
    }

    func start(refresh: Bool) throws {
        dispatchPrecondition(condition: .onQueue(queue))
        if cancelObservation != nil && !refresh { reconcile(); return }
        let nextGeneration = generation + 1
        // Create the replacement first: failed initialization leaves the existing
        // observation and its fallback poll usable.
        let cancel = try observe { [weak self] in
            guard let self else { return }
            self.queue.async {
                guard self.generation == nextGeneration else { return }
                self.coalesced?.cancel()
                let work = DispatchWorkItem { [weak self] in
                    guard let self, self.generation == nextGeneration else { return }
                    self.reconcile()
                }
                self.coalesced = work
                self.queue.asyncAfter(deadline: .now() + self.coalescingInterval, execute: work)
            }
        }
        stop()
        generation = nextGeneration
        cancelObservation = cancel
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + pollInterval, repeating: pollInterval)
        timer.setEventHandler { [weak self] in
            guard let self, self.generation == nextGeneration else { return }
            self.reconcile()
        }
        timer.resume()
        poll = timer
        reconcile()
    }

    func stop() {
        dispatchPrecondition(condition: .onQueue(queue))
        generation += 1
        poll?.cancel(); poll = nil
        coalesced?.cancel(); coalesced = nil
        cancelObservation?(); cancelObservation = nil
    }
}

/// Access is confined to the engine's serial queue. No discovery is performed by init.
public final class DeviceDiscovery {
    private let queue: DispatchQueue
    private var identities = TokenInventory()
    private var microphones = TokenInventory()
    private var videoDevices: [String: AVCaptureDevice] = [:]
    private var audioDevices: [String: AVCaptureDevice] = [:]
    private var screenDiscovery: AVCaptureDevice.DiscoverySession?
    private lazy var lifecycle = DiscoveryLifecycle(queue: queue, observe: { [weak self] changed in
        guard let self else { throw CaptureFailure("HELPER_UNAVAILABLE") }
        return try self.observe(changed: changed)
    }, reconcile: { [weak self] in self?.reconcile() })
    private var revision = 0
    private var signature = ""
    public var changed: (([String: Any]) -> Void)?
    public init(queue: DispatchQueue) { self.queue = queue }
    /// Rebuild the CMIO discovery observation only when capture inputs are idle.
    /// Prepared/active sources keep their observation, identities, and device handles.
    public func start(refresh: Bool = false) throws {
        try lifecycle.start(refresh: refresh)
    }
    private func observe(changed: @escaping () -> Void) throws -> (() -> Void) {
        // CMIO installs run-loop sources on its initialization thread. The helper keeps
        // the main run loop alive while this queue owns inventory and capture state.
        let (discovery, observation) = try DispatchQueue.main.sync {
            var address = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices), mScope: UInt32(kCMIOObjectPropertyScopeGlobal), mElement: UInt32(kCMIOObjectPropertyElementMain))
            var enabled: UInt32 = 1
            guard CMIOObjectSetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &enabled) == noErr else { throw CaptureFailure("HELPER_UNAVAILABLE") }
            var categories: [AVCaptureDevice.DeviceType] = [.external]
            if #available(macOS 14, *) { categories.append(.continuityCamera) }
            // Device arrival is asynchronous. Observe the session itself so a newly
            // vended screen source need not wait for the fallback poll.
            let discovery = AVCaptureDevice.DiscoverySession(deviceTypes: categories, mediaType: .muxed, position: .unspecified)
            let observation = discovery.observe(\.devices, options: []) { _, _ in changed() }
            return (discovery, observation)
        }
        screenDiscovery = discovery
        var observers: [NSObjectProtocol] = []
        for name in [AVCaptureDevice.wasConnectedNotification, AVCaptureDevice.wasDisconnectedNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { _ in
                changed()
            })
        }
        return {
            observation.invalidate()
            observers.forEach(NotificationCenter.default.removeObserver)
        }
    }
    private func reconcile() {
        guard let screenDiscovery else { return }
        let candidates = screenDiscovery.devices
            .filter { DeviceClassifier.isEligible(.init(modelID: $0.modelID, hasMuxed: $0.hasMediaType(.muxed), hasVideo: $0.hasMediaType(.video))) }.prefix(32)
        let mapping = identities.reconcile(Set(candidates.map(\.uniqueID)))
        videoDevices = Dictionary(uniqueKeysWithValues: candidates.compactMap { device in mapping[device.uniqueID].map { ($0, device) } })
        let audio = AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified).devices.filter { device in !candidates.contains(where: { $0.uniqueID == device.uniqueID }) && !device.hasMediaType(.muxed) }.prefix(32)
        let audioMapping = microphones.reconcile(Set(audio.map(\.uniqueID)))
        audioDevices = Dictionary(uniqueKeysWithValues: audio.compactMap { device in audioMapping[device.uniqueID].map { ($0, device) } })
        let next = (videoDevices.keys.sorted() + audioDevices.keys.sorted()).joined(separator: ":")
        if next != signature || revision == 0 { signature = next; revision += 1; changed?(snapshot()) }
    }
    public func snapshot() -> [String: Any] {
        ["inventoryGeneration": revision, "devices": videoDevices.keys.sorted().map { source(token: $0)! }, "microphones": audioDevices.keys.sorted().map { ["token": $0, "label": String(decoding: audioDevices[$0]!.localizedName.utf16.prefix(256), as: UTF16.self)] }]
    }
    public func source(token: String) -> [String: Any]? {
        guard let device = videoDevices[token] else { return nil }
        return ["sourceType": "ios-device", "id": "ios-device:\(token)", "deviceToken": token, "displayName": String(decoding: device.localizedName.utf16.prefix(256), as: UTF16.self), "generation": revision, "deviceAudio": device.hasMediaType(.audio) ? "available" : "unknown"]
    }
    public func device(token: String, generation: Int) throws -> AVCaptureDevice { guard generation == revision, let device = videoDevices[token] else { throw CaptureFailure("DEVICE_NOT_FOUND") }; return device }
    public func microphone(token: String) throws -> AVCaptureDevice { guard let device = audioDevices[token] else { throw CaptureFailure("DEVICE_NOT_FOUND") }; return device }
    public func contains(token: String) -> Bool { videoDevices[token] != nil }
    public func stop() { lifecycle.stop(); screenDiscovery = nil; videoDevices.removeAll(); audioDevices.removeAll(); _ = identities.reconcile([]); _ = microphones.reconcile([]) }
}
