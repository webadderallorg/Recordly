import Foundation
import CoreMedia

public struct CaptureFailure: Error, LocalizedError {
    public let code: String
    public init(_ code: String) { self.code = code }
    public var errorDescription: String? { code }
}

public struct NativeTime: Codable, Equatable, Sendable {
    public let value: String
    public let timescale: Int32
    public init(_ time: CMTime) throws {
        guard time.isNumeric, time.timescale > 0, time.epoch == 0 else { throw CaptureFailure("CLOCK_MAPPING_UNAVAILABLE") }
        value = String(time.value); timescale = time.timescale
    }
    public var cmTime: CMTime { CMTime(value: Int64(value) ?? 0, timescale: timescale) }
}

public struct ProtocolCommand {
    public let requestId: String
    public let command: String
    public let sessionId: String?
    public let generation: UInt32?
    public let payload: [String: Any]
    public let storage: [String: Any]?
    public static func parse(_ data: Data) throws -> ProtocolCommand {
        guard data.count <= 65536, String(data: data, encoding: .utf8) != nil,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys).isSubset(of: ["protocolVersion", "requestId", "command", "sessionId", "generation", "payload", "storage"]),
              (object["protocolVersion"] as? NSNumber)?.intValue == 1,
              let requestId = object["requestId"] as? String, validToken(requestId),
              let name = object["command"] as? String,
              ["hello", "discover", "prepare", "setPreviewEnabled", "start", "stop", "cancel", "release", "inspectMedia", "shutdown"].contains(name)
        else { throw CaptureFailure("INVALID_REQUEST") }
        if let version = object["protocolVersion"] as? NSNumber, version.doubleValue != 1 || CFGetTypeID(version) == CFBooleanGetTypeID() { throw CaptureFailure("PROTOCOL_MISMATCH") }
        let session = object["sessionId"] as? String
        if object["sessionId"] != nil && (session == nil || UUID(uuidString: session!) == nil) { throw CaptureFailure("INVALID_REQUEST") }
        var generation: UInt32?
        if let raw = object["generation"] {
            guard let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue >= 0, number.doubleValue <= Double(UInt32.max), number.doubleValue.rounded() == number.doubleValue else { throw CaptureFailure("INVALID_REQUEST") }
            generation = number.uint32Value
        }
        let payload = object["payload"] as? [String: Any] ?? [:]
        if object["payload"] != nil && !(object["payload"] is [String: Any]) { throw CaptureFailure("INVALID_REQUEST") }
        let allowed: Set<String>
        switch name {
        case "prepare": allowed = ["deviceToken", "inventoryGeneration", "options"]
        case "setPreviewEnabled": allowed = ["enabled"]
        case "cancel": allowed = ["discardAcceptedMedia"]
        case "inspectMedia": allowed = ["relativeName"]
        default: allowed = []
        }
        guard Set(payload.keys).isSubset(of: allowed) else { throw CaptureFailure("INVALID_REQUEST") }
        if ["setPreviewEnabled", "cancel"].contains(name) {
            let key = name == "cancel" ? "discardAcceptedMedia" : "enabled"
            guard let value = payload[key] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else { throw CaptureFailure("INVALID_REQUEST") }
        }
        let storage = object["storage"] as? [String: Any]
        if object["storage"] != nil {
            guard ["prepare", "inspectMedia"].contains(name), let storage,
                  Set(storage.keys) == ["sessionRoot", "allowedRelativeNames"], storage["sessionRoot"] is String, storage["allowedRelativeNames"] is [String] else { throw CaptureFailure("INVALID_REQUEST") }
        }
        if ["prepare", "start", "stop", "cancel", "release"].contains(name), session == nil { throw CaptureFailure("INVALID_REQUEST") }
        if name == "prepare" {
            guard let token = payload["deviceToken"] as? String, validToken(token),
                  let inventory = payload["inventoryGeneration"] as? NSNumber, inventory.doubleValue >= 0, inventory.doubleValue.rounded() == inventory.doubleValue,
                  let options = payload["options"] as? [String: Any], Set(options.keys) == ["deviceAudio", "microphoneToken"],
                  let audio = options["deviceAudio"] as? NSNumber, CFGetTypeID(audio) == CFBooleanGetTypeID(),
                  options["microphoneToken"] is NSNull || (options["microphoneToken"] as? String).map(validToken) == true,
                  storage != nil, generation != nil else { throw CaptureFailure("INVALID_REQUEST") }
        }
        return ProtocolCommand(requestId: requestId, command: name, sessionId: session, generation: generation, payload: payload, storage: storage)
    }
}
public func validToken(_ text: String) -> Bool {
    !text.isEmpty && text.utf8.count <= 128 && text.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 95 }
}
public struct BoundedLineReader {
    private var buffer = Data()
    public init() {}
    public mutating func push(_ chunk: Data) throws -> [Data] {
        var lines = [Data]()
        for byte in chunk {
            if byte == 10 { if !buffer.isEmpty { lines.append(buffer) }; buffer.removeAll(keepingCapacity: true) }
            else { guard buffer.count < 65536 else { throw CaptureFailure("INVALID_REQUEST") }; buffer.append(byte) }
        }
        return lines
    }
    public func finish() throws { if !buffer.isEmpty { throw CaptureFailure("INVALID_REQUEST") } }
}
public struct RequestCache {
    private var input: [String: Data] = [:]
    private var results: [String: [Data]] = [:]
    private var order: [String] = []
    public init() {}
    public mutating func begin(id: String, input bytes: Data) throws {
        if input[id] != nil { _ = try lookup(id: id, input: bytes); return }
        guard order.filter({ results[$0] == nil }).count < 8 else { throw CaptureFailure("RECORDING_BUSY") }
        if order.count >= 128, let index = order.firstIndex(where: { results[$0] != nil }) { let old = order.remove(at: index); input.removeValue(forKey: old); results.removeValue(forKey: old) }
        input[id] = bytes; order.append(id)
    }
    public func lookup(id: String, input bytes: Data) throws -> [Data]? {
        if let old = input[id], old != bytes { throw CaptureFailure("INVALID_REQUEST") }
        return input[id] == nil ? nil : (results[id] ?? [])
    }
    public mutating func complete(id: String, events: [Data]) { results[id] = events }
}
public func jsonObject<T: Encodable>(_ value: T) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as! [String: Any]
}
