import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "darwin")(
	"reports audio delivery overload even when its stream has been replaced",
	() => {
		const directory = mkdtempSync(join(tmpdir(), "recordly-audio-delivery-"));
		try {
			const source = readFileSync(
				new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
				"utf8",
			);
			const budget = source.slice(
				source.indexOf("final class AudioDeliveryBudget"),
				source.indexOf("func matchMicrophoneCaptureDeviceID"),
			);
			const delivery = source.slice(
				source.indexOf("\tprivate func deliverAudioSampleBuffer("),
				source.indexOf("\tprivate func handleSampleBuffer("),
			);
			// Exercise the production queue budget and callback dispatch. Only media
			// values and the downstream recorder are fakes; no capture permission is used.
			writeFileSync(
				join(directory, "main.swift"),
				`
import Foundation
final class SCStream {}
enum SCStreamOutputType { case audio }
struct ASBD { var mSampleRate: Double = 48000 }
struct Format { var audioStreamBasicDescription: ASBD? = ASBD() }
struct Buffer { var dataLength: Int = 3840 }
struct CMSampleBuffer {
    var isValid = true
    var numSamples = 480
    var totalSampleSize = 3840
    var dataBuffer: Buffer? = Buffer()
    var formatDescription: Format? = Format()
}
${budget}
final class Harness {
    let queue = DispatchQueue(label: "audio-delivery-test")
    let audioDeliveryBudget = AudioDeliveryBudget()
    var isRecording = true
    var stream: SCStream? = SCStream()
    var failures = 0
    var delivered = 0
    func interruptCapture(_ error: Error) { failures += 1; isRecording = false }
    func handleSampleBuffer(_ buffer: CMSampleBuffer, of: SCStreamOutputType) { delivered += 1 }
${delivery}
    func send(from stream: SCStream) {
        deliverAudioSampleBuffer(CMSampleBuffer(), of: .audio, from: stream)
    }
}
func check(_ value: Bool, _ reason: String) {
    if !value { fputs("FAIL: \\(reason)\\n", stderr); exit(1) }
}
// Healthy recovery still ignores old callbacks and accepts new-stream audio.
let healthy = Harness()
let obsolete = healthy.stream!
let fresh = SCStream()
healthy.queue.sync { healthy.stream = fresh }
healthy.send(from: obsolete)
healthy.send(from: fresh)
healthy.queue.sync {}
check(healthy.delivered == 1 && healthy.failures == 0 && healthy.isRecording,
      "healthy replacement must retain audio and ignore stale callbacks")

// Hold the sample queue while the delivery queue crosses its two-second bound.
// The replacement is already queued ahead of the old stream's error callback.
for replaceStream in [false, true] {
    let recorder = Harness()
    let old = recorder.stream!
    let replacement = SCStream()
    let gate = DispatchSemaphore(value: 0)
    recorder.queue.async { gate.wait() }
    if replaceStream { recorder.queue.async { recorder.stream = replacement } }
    for _ in 0..<220 { recorder.send(from: old) }
    gate.signal()
    recorder.queue.sync {}
    check(recorder.failures == 1 && !recorder.isRecording,
          "audio overload must stop visibly even after stream replacement")
    let deliveredBeforeStop = recorder.delivered
    recorder.send(from: replaceStream ? replacement : old)
    recorder.queue.sync {}
    check(recorder.failures == 1 && recorder.delivered == deliveredBeforeStop,
          "terminal overload must report once and accept no more audio")
}
print("audio delivery recovery regression passed")
`,
			);
			const executable = join(directory, "test");
			const build = spawnSync(
				"swiftc",
				[
					"-module-cache-path",
					join(directory, "cache"),
					join(directory, "main.swift"),
					"-o",
					executable,
				],
				{ encoding: "utf8", timeout: 60_000 },
			);
			expect(build.status, build.stderr).toBe(0);
			const run = spawnSync(executable, [], { encoding: "utf8", timeout: 10_000 });
			expect(run.status, run.stderr).toBe(0);
			expect(run.stdout).toContain("audio delivery recovery regression passed");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
	90_000,
);
