import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

// Compile the production recovery methods against a deterministic fake transport.
// No screen permission, GUI, microphone or real SCStream is used in this test.
it.skipIf(process.platform !== "darwin")(
	"retries stream failures, ignores stale callbacks and respects cancellation",
	() => {
		const directory = mkdtempSync(join(tmpdir(), "recordly-stream-recovery-"));
		try {
			const source = readFileSync(
				new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
				"utf8",
			);
			const methods = source
				.slice(
					source.indexOf("\tfunc stream(_ stream: SCStream, didStopWithError"),
					source.indexOf("\tprivate func interruptCapture("),
				)
				.replace(
					/\tprivate func isCompleteVideoFrame[\s\S]*?(?=\tprivate func makeCaptureStream)/,
					"",
				);
			writeFileSync(
				join(directory, "main.swift"),
				`
import Foundation
let SCStreamErrorDomain = "SCStreamErrorDomain"
struct SCStreamError { enum Code: Int { case userStopped = -3817, userDeclined = -3801 } }
struct SCContentFilter {}
struct SCStreamConfiguration {}
enum SCStreamOutputType: Int { case screen, audio, microphone }
final class SCStream {
    let mode: String
    weak var delegate: Harness?
    var stopped = false
    init(filter: SCContentFilter, configuration: SCStreamConfiguration, delegate: Harness) {
        self.delegate = delegate
        mode = delegate.modes.isEmpty ? "healthy" : delegate.modes.removeFirst()
        delegate.created.append(self)
    }
    func addStreamOutput(_ output: Harness, type: SCStreamOutputType, sampleHandlerQueue: DispatchQueue) throws {}
    func startCapture() async throws {
        if mode == "fail" { throw NSError(domain: "transport", code: 1) }
        if mode == "slow" { try await Task.sleep(nanoseconds: 200_000_000) }
        if mode == "silent" { return }
        guard let delegate else { return }
        await withCheckedContinuation { continuation in
            delegate.queue.async {
                if delegate.isRecording, delegate.stream === self { delegate.streamHasVideo = true }
                continuation.resume()
            }
        }
    }
    func stopCapture() async throws { stopped = true }
}
final class Harness {
    let queue = DispatchQueue(label: "recovery-test")
    let audioDeliveryQueue = DispatchQueue(label: "audio-test")
    var captureFilter: SCContentFilter? = SCContentFilter()
    var captureConfiguration: SCStreamConfiguration? = SCStreamConfiguration()
    var capturesSystemAudio = true
    var capturesMicrophone = true
    let microphoneOutputTypeRawValue = 2
    var isRecording = true
    var isFinalizing = false
    var captureFailure: Error?
    var stream: SCStream?
    var recoveryTask: Task<Void, Never>?
    var streamFailure: Error?
    var streamHasVideo = false
    var modes: [String] = []
    var created: [SCStream] = []
    var failures = 0
    func interruptCapture(_ error: Error) { failures += 1; captureFailure = error; isRecording = false }
${methods}
    func begin(_ modes: [String]) async -> SCStream {
        await onCaptureQueue {
            let initial = try! self.makeCaptureStream()
            self.stream = initial
            self.modes = modes
            return initial
        }
    }
    func snapshot() async -> (Int, Int, Bool, Bool) {
        await onCaptureQueue { (self.created.count, self.failures, self.isRecording, self.recoveryTask != nil) }
    }
    func waitUntil(_ condition: @escaping (Int, Int, Bool, Bool) -> Bool) async {
        for _ in 0..<200 {
            let s = await snapshot()
            if condition(s.0, s.1, s.2, s.3) { return }
            try! await Task.sleep(nanoseconds: 20_000_000)
        }
        fatalError("recovery did not reach the expected state")
    }
    func cancel() async {
        let task = await onCaptureQueue {
            self.isRecording = false
            let task = self.recoveryTask
            self.recoveryTask = nil
            task?.cancel()
            return task
        }
        await task?.value
    }
}
func check(_ value: Bool, _ message: String) { if !value { fatalError(message) } }
Task {
    let failure = NSError(domain: "transport", code: 2)
    let retry = Harness()
    let initial = await retry.begin(["fail", "fail", "healthy"])
    retry.stream(initial, didStopWithError: failure)
    await retry.waitUntil { count, failures, active, recovering in count == 4 && failures == 0 && active && !recovering }
    // Old callbacks must not stop a replacement stream or start another retry.
    retry.stream(initial, didStopWithError: failure)
    try! await Task.sleep(nanoseconds: 50_000_000)
    check(await retry.snapshot().0 == 4, "stale callback restarted capture")
    // Another later interruption gets its own retry budget.
    let current = retry.stream!
    retry.stream(current, didStopWithError: failure)
    await retry.waitUntil { count, failures, active, recovering in count == 5 && failures == 0 && active && !recovering }
    print("retries and stale callbacks passed")

    let exhausted = Harness()
    let broken = await exhausted.begin(["fail", "fail", "fail"])
    exhausted.stream(broken, didStopWithError: failure)
    await exhausted.waitUntil { count, failures, active, recovering in count == 4 && failures == 1 && !active && !recovering }
    print("retry exhaustion passed")

    let stopped = Harness()
    let userStream = await stopped.begin([])
    stopped.stream(userStream, didStopWithError: NSError(domain: SCStreamErrorDomain, code: SCStreamError.Code.userStopped.rawValue))
    await stopped.waitUntil { count, failures, active, recovering in count == 1 && failures == 1 && !active && !recovering }
    print("user stop passed")

    let cancelled = Harness()
    let slow = await cancelled.begin(["slow"])
    cancelled.stream(slow, didStopWithError: failure)
    await cancelled.waitUntil { count, _, _, recovering in count == 2 && recovering }
    await cancelled.cancel()
    try! await Task.sleep(nanoseconds: 250_000_000)
    let end = await cancelled.snapshot()
    check(end.0 == 2 && end.1 == 0 && !end.2 && !end.3, "cancelled recovery resurrected capture")
    print("cancellation passed")
    exit(0)
}
dispatchMain()
`,
			);
			const executable = join(directory, "test");
			const build = spawnSync(
				"swiftc",
				[
					"-module-cache-path",
					join(directory, "cache"),
					"-target",
					`${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos14.0`,
					join(directory, "main.swift"),
					"-o",
					executable,
				],
				{ encoding: "utf8", timeout: 60_000 },
			);
			expect(build.status, build.stderr).toBe(0);
			const run = spawnSync(executable, [], { encoding: "utf8", timeout: 15_000 });
			expect(run.status, run.stderr).toBe(0);
			for (const marker of [
				"retries and stale callbacks passed",
				"retry exhaustion passed",
				"user stop passed",
				"cancellation passed",
			]) {
				expect(run.stdout).toContain(marker);
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
	90_000,
);
