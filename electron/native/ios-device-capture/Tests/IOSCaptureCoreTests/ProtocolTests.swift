import XCTest
@testable import IOSCaptureCore
final class ProtocolTests: XCTestCase {
    func testHello() throws {
        let command = try ProtocolCommand.parse(Data(#"{"protocolVersion":1,"requestId":"r1","command":"hello"}"#.utf8))
        XCTAssertEqual(command.command, "hello")
    }
    func testSplitLines() throws {
        var parser = BoundedLineReader()
        XCTAssertEqual(try parser.push(Data("hel".utf8)).count, 0)
        XCTAssertEqual(try parser.push(Data("lo\n".utf8)), [Data("hello".utf8)])
    }
    func testOversizedLineAndInvalidUTF8() {
        var parser = BoundedLineReader()
        XCTAssertThrowsError(try parser.push(Data(repeating: 65, count: 65 * 1024)))
        XCTAssertThrowsError(try ProtocolCommand.parse(Data([0xff])))
    }
    func testRejectUnknownVersionCommandAndFields() {
        for line in [#"{"protocolVersion":2,"requestId":"r1","command":"hello"}"#,
                     #"{"protocolVersion":1,"requestId":"r1","command":"pause"}"#,
                     #"{"protocolVersion":1,"requestId":"r1","command":"hello","outputPath":"/tmp/a"}"#] {
            XCTAssertThrowsError(try ProtocolCommand.parse(Data(line.utf8)))
        }
    }
    func testIdempotencyAndCollision() throws {
        var cache = RequestCache()
        let input = Data("a".utf8)
        try cache.begin(id: "r", input: input)
        cache.complete(id: "r", events: [Data("reply".utf8)])
        XCTAssertEqual(try cache.lookup(id: "r", input: input), [Data("reply".utf8)])
        XCTAssertThrowsError(try cache.lookup(id: "r", input: Data("b".utf8)))
    }
    func testEOFRejectsUnterminatedCommand() throws {
        var parser = BoundedLineReader()
        _ = try parser.push(Data("x".utf8))
        XCTAssertThrowsError(try parser.finish())
    }
}
