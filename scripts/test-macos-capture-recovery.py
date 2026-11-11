#!/usr/bin/env python3
"""Manual macOS integration test; captures only an animated test window.

Requires Screen Recording permission. Fault-injection commands are compiled into
an isolated test binary, never into the installed helper. Outputs stay in --out.
"""
import argparse
import hashlib
import json
import queue
import platform
import subprocess
import threading
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--duration", type=float, default=370)
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parent.parent

fixture = r'''
import AppKit
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let window = NSWindow(contentRect: NSRect(x: 60, y: 60, width: 640, height: 360), styleMask: [.titled], backing: .buffered, defer: false)
window.title = "Recordly recording recovery test"
window.isReleasedWhenClosed = false
window.level = .floating
let label = NSTextField(labelWithString: "")
label.frame = NSRect(x: 30, y: 140, width: 580, height: 90)
label.font = .monospacedDigitSystemFont(ofSize: 32, weight: .bold)
label.alignment = .center
window.contentView!.wantsLayer = true
window.contentView!.addSubview(label)
var animate = true
DispatchQueue.global().async {
    while let command = readLine() { DispatchQueue.main.async { animate = command != "freeze" } }
}
let start = Date()
let timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
    guard animate else { return }
    let elapsed = Date().timeIntervalSince(start)
    label.stringValue = String(format: "Recordly test  %.1f s", elapsed)
    window.contentView!.layer!.backgroundColor = NSColor(calibratedHue: (elapsed / 17).truncatingRemainder(dividingBy: 1), saturation: 0.3, brightness: 0.95, alpha: 1).cgColor
}
window.orderFrontRegardless()
print(window.windowNumber)
fflush(stdout)
app.run()
'''
# Extensions in the same Swift file can access private members. Only test
# transport faults are injected; recovery, timestamps, writers and finalization
# are the production implementations.
injection = r'''
extension ScreenCaptureRecorder {
    func interruptForTest(permanent: Bool, userStop: Bool = false) async {
        let active = await onCaptureQueue { self.stream }
        guard let active else { return }
        try? await active.stopCapture()
        if permanent { await onCaptureQueue { self.captureFilter = nil } }
        self.stream(active, didStopWithError: NSError(domain: userStop ? SCStreamErrorDomain : "RecordlyIntegrationTest", code: userStop ? SCStreamError.Code.userStopped.rawValue : 1, userInfo: [NSLocalizedDescriptionKey: "Injected stream interruption"]))
    }
}
extension RecorderService {
    func interruptForTest(permanent: Bool, userStop: Bool = false) {
        enqueue { await self.recorder.interruptForTest(permanent: permanent, userStop: userStop) }
    }
}
'''
commands = r'''
        if input == "test-interrupt" || input == "test-permanent" || input == "test-user-stop" {
            service.interruptForTest(permanent: input == "test-permanent", userStop: input == "test-user-stop")
            continue
        }
'''
source = (root / "electron/native/ScreenCaptureKitRecorder.swift").read_text()
source = source.replace("let service = RecorderService()", injection + "\nlet service = RecorderService()")
source = source.replace('if input == "pause" {', commands + '\n        if input == "pause" {')
(args.out / "RecorderTest.swift").write_text(source)
(args.out / "Fixture.swift").write_text(fixture)
for src, binary in [("RecorderTest.swift", "recorder-test"), ("Fixture.swift", "fixture")]:
    subprocess.run(["swiftc", "-O", "-module-cache-path", str(args.out / "swift-cache"), "-target", platform.machine() + "-apple-macos14.0", str(args.out / src), "-o", str(args.out / binary)], check=True)

class Capture:
    def __init__(self, name, window_id):
        self.path = args.out / (name + ".mp4")
        config = {"windowId": window_id, "fps": 30, "outputPath": str(self.path)}
        self.proc = subprocess.Popen([str(args.out / "recorder-test"), json.dumps(config)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.events = queue.Queue()
        self.lines = []
        def read():
            with (args.out / (name + ".log")).open("w") as log:
                for line in self.proc.stdout:
                    self.lines.append(line)
                    log.write(line)
                    log.flush()
                    self.events.put(line)
                    print(name + ": " + line.rstrip(), flush=True)
        threading.Thread(target=read, daemon=True).start()
        try:
            self.wait("Recording started", 20)
        except Exception:
            self.proc.terminate()
            self.proc.wait(timeout=10)
            raise
        self.started = time.monotonic()
    def command(self, line):
        self.proc.stdin.write(line + "\n")
        self.proc.stdin.flush()
    def wait(self, marker, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                line = self.events.get(timeout=min(0.25, deadline - time.monotonic()))
                if marker in line: return
            except queue.Empty:
                if self.proc.poll() is not None: break
        raise AssertionError("Missing " + marker + ": " + "".join(self.lines))
    def stop(self):
        elapsed = time.monotonic() - self.started
        self.command("stop")
        self.proc.wait(timeout=30)
        assert self.proc.returncode == 0, self.lines
        return elapsed
    def probe(self):
        raw = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,nb_frames,avg_frame_rate", "-of", "json", str(self.path)], text=True)
        return json.loads(raw)

fixture_process = subprocess.Popen([str(args.out / "fixture")], stdout=subprocess.PIPE, stdin=subprocess.PIPE, text=True)
captures = []
results = {}
try:
    window_id = int(fixture_process.stdout.readline().strip())
    capture = Capture("long-recovery", window_id)
    captures.append(capture)
    time.sleep(3)
    capture.command("test-interrupt")
    capture.wait("STREAM_RECOVERED")
    time.sleep(2)
    capture.command("pause")
    capture.wait("Recording paused")
    pause_start = time.monotonic()
    capture.command("test-interrupt")
    capture.wait("STREAM_RECOVERED")
    time.sleep(2)
    capture.command("resume")
    capture.wait("Recording resumed")
    paused = time.monotonic() - pause_start
    interruption_time = min(310, max(10, args.duration - 5))
    while time.monotonic() - capture.started < interruption_time:
        time.sleep(min(10, max(0.01, interruption_time - (time.monotonic() - capture.started))))
    capture.command("test-interrupt")
    capture.wait("STREAM_RECOVERED")
    while time.monotonic() - capture.started < args.duration:
        time.sleep(min(10, max(0.01, args.duration - (time.monotonic() - capture.started))))
    elapsed = capture.stop()
    data = capture.probe()
    actual = float(data["format"]["duration"])
    assert abs(actual - (elapsed - paused)) < 1.5, (actual, elapsed, paused)
    packets = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "json", str(capture.path)], text=True))["packets"]
    pts = sorted(float(p["pts_time"]) for p in packets)
    max_gap = max(b - a for a, b in zip(pts, pts[1:]))
    assert max_gap < 3, max_gap
    sample_times = [1, actual / 2, actual - 1]
    hashes = []
    for t in sample_times:
        frame = subprocess.check_output(["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(capture.path), "-frames:v", "1", "-vf", "scale=160:90", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
        assert frame
        hashes.append(hashlib.sha256(frame).hexdigest())
    assert len(set(hashes)) == len(hashes), "Frames did not change across the recording"
    results["long"] = {"wallSeconds": elapsed, "pausedSeconds": paused, "videoSeconds": actual, "maxFrameGapSeconds": max_gap, "frames": len(pts), "recoveries": sum("STREAM_RECOVERED" in line for line in capture.lines)}
    for name, manual_stop in [("permanent-failure", False), ("stop-during-recovery", True)]:
        capture = Capture(name, window_id)
        captures.append(capture)
        time.sleep(2)
        capture.command("test-permanent")
        capture.wait("STREAM_RECOVERING")
        if manual_stop:
            capture.stop()
        else:
            capture.wait("STREAM_RECOVERY_FAILED")
            capture.proc.wait(timeout=30)
        assert capture.proc.returncode == (0 if manual_stop else 1), capture.lines
        probe = capture.probe()
        assert float(probe["format"]["duration"]) > 1
        results[name] = probe
    capture = Capture("static-tail", window_id)
    captures.append(capture)
    time.sleep(2)
    fixture_process.stdin.write("freeze\n")
    fixture_process.stdin.flush()
    time.sleep(5)
    elapsed = capture.stop()
    actual = float(capture.probe()["format"]["duration"])
    assert abs(actual - elapsed) < 1, (actual, elapsed)
    results["static-tail"] = {"wallSeconds": elapsed, "videoSeconds": actual}
    fixture_process.stdin.write("animate\n")
    fixture_process.stdin.flush()
    capture = Capture("macos-user-stop", window_id)
    captures.append(capture)
    time.sleep(2)
    capture.command("test-user-stop")
    capture.wait("CAPTURE_INTERRUPTED")
    capture.proc.wait(timeout=30)
    assert not any("STREAM_RECOVERING" in line for line in capture.lines)
    results["macos-user-stop"] = capture.probe()
    (args.out / "results.json").write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2), flush=True)
finally:
    for capture in captures:
        if capture.proc.poll() is None:
            try:
                capture.stop()
            except Exception:
                capture.proc.terminate()
                capture.proc.wait(timeout=10)
    fixture_process.terminate()
    fixture_process.wait(timeout=10)
