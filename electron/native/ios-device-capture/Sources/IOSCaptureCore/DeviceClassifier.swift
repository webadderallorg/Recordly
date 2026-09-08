import Foundation
public struct DeviceFacts {
    public let modelID: String
    public let hasMuxed: Bool
    public let hasVideo: Bool
    public init(modelID: String, hasMuxed: Bool, hasVideo: Bool) { self.modelID = modelID; self.hasMuxed = hasMuxed; self.hasVideo = hasVideo }
}
public enum DeviceClassifier {
    // USB screen sources advertise muxed media without necessarily advertising standalone video.
    // Preparation validates actual video samples before the device can become ready.
    public static func isEligible(_ facts: DeviceFacts) -> Bool { facts.modelID == "iOS Device" && facts.hasMuxed }
}
public struct TokenInventory {
    private var tokens: [String: String] = [:]
    public init() {}
    public mutating func reconcile(_ identities: Set<String>) -> [String: String] {
        tokens = tokens.filter { identities.contains($0.key) }
        for identity in identities where tokens[identity] == nil { tokens[identity] = UUID().uuidString.lowercased() }
        return tokens
    }
}
