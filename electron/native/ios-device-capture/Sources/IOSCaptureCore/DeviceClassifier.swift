import Foundation
public struct DeviceFacts {
    public let modelID: String
    public let hasMuxed: Bool
    public let hasVideo: Bool
    public init(modelID: String, hasMuxed: Bool, hasVideo: Bool) { self.modelID = modelID; self.hasMuxed = hasMuxed; self.hasVideo = hasVideo }
}
public enum DeviceClassifier {
    // Candidate signature from the specification. Hardware validation remains a release gate.
    public static func isEligible(_ facts: DeviceFacts) -> Bool { facts.modelID == "iOS Device" && facts.hasMuxed && facts.hasVideo }
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
