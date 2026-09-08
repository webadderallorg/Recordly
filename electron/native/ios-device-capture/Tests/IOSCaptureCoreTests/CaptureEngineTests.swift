import XCTest
@testable import IOSCaptureCore
final class CaptureEngineTests: XCTestCase {
    func testHelloHasNoDiscoveryAndRejectsStartBeforePreparation() throws {
        let engine = CaptureEngine()
        var events = [(String, [String: Any])]()
        engine.emit = { name, payload, _, _, _ in events.append((name, payload)) }
        let hello = try ProtocolCommand.parse(Data(#"{"protocolVersion":1,"requestId":"hello","command":"hello"}"#.utf8))
        engine.queue.sync { engine.handle(hello) }
        XCTAssertEqual(events.map(\.0), ["accepted"])
        XCTAssertEqual(events.first?.1["protocolVersion"] as? Int, 1)
        let start = try ProtocolCommand.parse(Data("{\"protocolVersion\":1,\"requestId\":\"start\",\"command\":\"start\",\"sessionId\":\"\(UUID().uuidString)\"}".utf8))
        engine.queue.sync { engine.handle(start) }
        XCTAssertEqual(events.last?.0, "error")
        XCTAssertEqual(events.last?.1["code"] as? String, "INVALID_REQUEST")
    }
    func testTimingCheckpointAndPathBoundaries() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory()).resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try SessionStorage(["sessionRoot": root.path, "allowedRelativeNames": ["native-timing.json", "source-video.mov"]])
        XCTAssertThrowsError(try storage.file("../other.mov"))
        let store = try NativeTimingStore(storage: storage)
        try store.checkpoint(["version": 1, "phase": "recording"])
        try store.checkpoint(["version": 1, "phase": "completed"])
        let bytes = try Data(contentsOf: storage.file("native-timing.json"))
        XCTAssertEqual((try JSONSerialization.jsonObject(with: bytes) as? [String: Any])?["phase"] as? String, "completed")
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("source-video.mov"), withDestinationURL: URL(fileURLWithPath: "/private/tmp/outside.mov"))
        XCTAssertThrowsError(try storage.file("source-video.mov"))
    }
}

final class StorageReserveTests: XCTestCase {
    func testReserveUsesWrittenMediaAndOnlyRequestedFinalCopy() {
        let megabyte: Int64 = 1024 * 1024
        let videoBytes = 10 * megabyte
        let audioBytes = megabyte
        let noMix = StorageReservePolicy.requiredBytes(writtenBytes: videoBytes, videoBytes: videoBytes, elapsedSeconds: 10, mixAudio: false)
        XCTAssertEqual(noMix, 316 * megabyte)
        let mixed = StorageReservePolicy.requiredBytes(writtenBytes: videoBytes + audioBytes, videoBytes: videoBytes, elapsedSeconds: 10, mixAudio: true)
        XCTAssertEqual(mixed, 332 * megabyte)
        XCTAssertLessThan(mixed, 5 * 1024 * megabyte)
    }
}
extension StorageReserveTests {
    func testMeasuredBytesComeFromMediaFilesNotTimingOrPixelGeometry() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory()).resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try SessionStorage(["sessionRoot": root.path, "allowedRelativeNames": ["source-video.mov", "device-audio.mov", "microphone.mov", "native-timing.json"]])
        try Data(repeating: 0, count: 1024).write(to: storage.file("source-video.mov"))
        try Data(repeating: 0, count: 512).write(to: storage.file("device-audio.mov"))
        try Data(repeating: 0, count: 4096).write(to: storage.file("native-timing.json"))
        let measured = try storage.writtenMediaBytes()
        XCTAssertEqual(measured.video, 1024)
        XCTAssertEqual(measured.total, 1536)
    }
}
