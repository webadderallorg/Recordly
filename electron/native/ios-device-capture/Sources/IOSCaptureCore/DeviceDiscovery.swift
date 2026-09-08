import Foundation
import AVFoundation
import CoreMediaIO

/// Access is confined to the engine's serial queue. No discovery is performed by init.
public final class DeviceDiscovery {
    private let queue: DispatchQueue
    private var identities = TokenInventory()
    private var microphones = TokenInventory()
    private var videoDevices: [String: AVCaptureDevice] = [:]
    private var audioDevices: [String: AVCaptureDevice] = [:]
    private var observers: [NSObjectProtocol] = []
    private var poll: DispatchSourceTimer?
    private var coalesced: DispatchWorkItem?
    private var revision = 0
    private var signature = ""
    public var changed: (([String: Any]) -> Void)?
    public init(queue: DispatchQueue) { self.queue = queue }
    public func start() throws {
        if poll != nil { reconcile(); return }
        var address = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices), mScope: UInt32(kCMIOObjectPropertyScopeGlobal), mElement: UInt32(kCMIOObjectPropertyElementMain))
        var enabled: UInt32 = 1
        guard CMIOObjectSetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &enabled) == noErr else { throw CaptureFailure("HELPER_UNAVAILABLE") }
        for name in [AVCaptureDevice.wasConnectedNotification, AVCaptureDevice.wasDisconnectedNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { [weak self] _ in
                guard let self else { return }
                self.queue.async { self.coalesced?.cancel(); let work = DispatchWorkItem { [weak self] in self?.reconcile() }; self.coalesced = work; self.queue.asyncAfter(deadline: .now() + 0.25, execute: work) }
            })
        }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: 2)
        timer.setEventHandler { [weak self] in self?.reconcile() }
        timer.resume(); poll = timer
        reconcile()
    }
    private func reconcile() {
        var categories: [AVCaptureDevice.DeviceType] = [.external]
        if #available(macOS 14, *) { categories.append(.continuityCamera) }
        let candidates = AVCaptureDevice.DiscoverySession(deviceTypes: categories, mediaType: .muxed, position: .unspecified).devices
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
    public func stop() { poll?.cancel(); poll = nil; coalesced?.cancel(); observers.forEach(NotificationCenter.default.removeObserver); observers.removeAll(); videoDevices.removeAll(); audioDevices.removeAll(); _ = identities.reconcile([]); _ = microphones.reconcile([]) }
}
