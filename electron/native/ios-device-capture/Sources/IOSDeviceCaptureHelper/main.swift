import Foundation
import IOSCaptureCore
import CoreMedia
import Darwin

signal(SIGPIPE, SIG_IGN)
if CommandLine.arguments.contains("--self-test") {
    do {
        _ = try ProtocolCommand.parse(Data(#"{"protocolVersion":1,"requestId":"self-test","command":"hello"}"#.utf8))
        let time = try NativeTime(CMTime(value: 9007199254740993, timescale: 1000000000))
        guard time.value == "9007199254740993", DeviceClassifier.isEligible(.init(modelID: "iOS Device", hasMuxed: true, hasVideo: true)), try PreviewFraming.record(jpeg: Data([0xff, 0xd8]), generation: 1, sequence: 1).count == 26 else { exit(1) }
        print(#"{"protocolVersion":1,"selfTest":"passed","hardwareTested":false}"#); exit(0)
    } catch { fputs("self-test failed\n", stderr); exit(1) }
}
guard CommandLine.arguments.count == 1 else { fputs("unsupported argument\n", stderr); exit(2) }

final class ControlOutput {
    private let queue = DispatchQueue(label: "recordly.ios.control-output")
    private var pending = Data()
    private var offset = 0
    private var closed = false
    private let timer: DispatchSourceTimer
    init() {
        _ = fcntl(STDOUT_FILENO, F_SETFL, fcntl(STDOUT_FILENO, F_GETFL) | O_NONBLOCK)
        timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(25))
        timer.setEventHandler { [weak self] in self?.drain() }; timer.resume()
    }
    func send(_ data: Data) { queue.async { [self] in
        guard !closed else { return }
        guard pending.count - offset + data.count < 512 * 1024 else { closed = true; pending.removeAll(); return }
        if offset > 0 { pending.removeFirst(offset); offset = 0 }
        pending.append(data); drain()
    } }
    private func drain() {
        guard !closed else { return }
        while offset < pending.count {
            let count = pending.withUnsafeBytes { write(STDOUT_FILENO, $0.baseAddress!.advanced(by: offset), pending.count - offset) }
            if count < 0 { if errno == EINTR { continue }; if errno == EAGAIN { return }; closed = true; pending.removeAll(); return }
            if count == 0 { return }; offset += count
        }
        pending.removeAll(keepingCapacity: true); offset = 0
    }
    func finish() { queue.sync { drain() } }
}
let engine = CaptureEngine()
let output = ControlOutput()
var cache = RequestCache()
var sequence: UInt64 = 0
engine.emit = { event, payload, requestId, sessionId, generation in
    sequence += 1
    var object: [String: Any] = ["protocolVersion": 1, "event": event, "sequence": sequence, "generation": generation, "payload": payload]
    if let requestId, ["accepted", "error"].contains(event) { object["requestId"] = requestId }; if let sessionId, event != "inventoryChanged" { object["sessionId"] = sessionId }
    guard var data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), data.count < 65536 else { return }
    data.append(10)
    if let requestId { cache.complete(id: requestId, events: [data]) }
    output.send(data)
}
engine.didShutdown = { output.finish(); exit(0) }
DispatchQueue.global(qos: .userInitiated).async {
    var parser = BoundedLineReader()
    var bytes = [UInt8](repeating: 0, count: 8192)
    while true {
        let count = read(STDIN_FILENO, &bytes, bytes.count)
        if count <= 0 { if count < 0 && errno == EINTR { continue }; break }
        do {
            let lines = try parser.push(Data(bytes.prefix(count)))
            for line in lines {
                engine.queue.sync {
                    do {
                        let command = try ProtocolCommand.parse(line)
                        if let events = try cache.lookup(id: command.requestId, input: line) {
                            for saved in events {
                                if var object = try JSONSerialization.jsonObject(with: saved) as? [String: Any] {
                                    sequence += 1; object["sequence"] = sequence
                                    var reply = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]); reply.append(10); output.send(reply)
                                }
                            }
                            return
                        }
                        try cache.begin(id: command.requestId, input: line)
                        engine.handle(command)
                    } catch { engine.emit?("error", ["code": (error as? CaptureFailure)?.code ?? "INVALID_REQUEST", "recoverable": false], nil, nil, 0) }
                }
            }
        } catch { engine.queue.async { engine.emit?("error", ["code": "INVALID_REQUEST", "recoverable": false], nil, nil, 0); engine.shutdown() }; return }
    }
    let incomplete = (try? parser.finish()) == nil
    engine.queue.async { if incomplete { engine.emit?("error", ["code": "INVALID_REQUEST", "recoverable": false], nil, nil, 0) }; engine.shutdown() }
}
// USB discovery needs CMIO's main-thread run-loop sources as well as dispatch work.
CFRunLoopRun()
