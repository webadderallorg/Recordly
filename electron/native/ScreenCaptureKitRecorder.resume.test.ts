import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "darwin")(
	"preserves audio over static screens and keeps pause/resume timestamps aligned with host clock",
	() => {
		const directory = mkdtempSync(join(tmpdir(), "recordly-resume-timing-"));
		try {
			const source = readFileSync(
				new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
				"utf8",
			);
			const pauseAndResume = source.slice(
				source.indexOf("\tfunc pauseCapture() async -> Bool"),
				source.indexOf("\tfunc stream(_ stream: SCStream, didOutputSampleBuffer"),
			);
			const adjustedTime = source.slice(
				source.indexOf("\tprivate func adjustedPresentationTime("),
				source.indexOf(
					"\t/// ScreenCaptureKit sends no frames while the screen does not change",
				),
			);
			const timelineHelpers = source.slice(
				source.indexOf("\tprivate func timelineTimeOfStop("),
				source.indexOf("\tprivate func frameDuration("),
			);

			writeFileSync(
				join(directory, "main.swift"),
				`
import Foundation
import CoreMedia
import ScreenCaptureKit

struct StubSampleBuffer {
    let presentationTimeStamp: CMTime
}

final class Harness: @unchecked Sendable {
    let queue = DispatchQueue(label: "resume-timing-test")
    var isRecording = true
    var isPaused = false
    var pauseStartedHostTime: CMTime?
    var lastResumeHostTime: CMTime?
    var accumulatedPausedDuration: CMTime = .zero
    var firstSampleTime: CMTime = .zero
${pauseAndResume.replace(/CMSampleBuffer/g, "StubSampleBuffer")}
${adjustedTime.replace(/CMSampleBuffer/g, "StubSampleBuffer").replace(/\tprivate func /g, "\tfunc ")}
${timelineHelpers.replace(/\tprivate func /g, "\tfunc ")}
}

func check(_ condition: Bool, _ message: String) {
    if !condition {
        fputs("FAIL: \\(message)\\n", stderr)
        exit(1)
    }
}

Task {
    // 1. Pausing and resuming after video has started preserves audio on a static screen
    //    and keeps accumulatedPausedDuration equal to the actual pause window.
    let harness = Harness()
    let startHost = CMClockGetTime(CMClockGetHostTimeClock())
    let firstVideoPts = harness.queue.sync {
        harness.adjustedPresentationTime(for: StubSampleBuffer(presentationTimeStamp: startHost), outputType: .screen)
    }
    check(firstVideoPts == .zero, "first video frame must start at time zero")

    try? await Task.sleep(nanoseconds: 40_000_000)
    let paused = await harness.pauseCapture()
    check(paused && harness.isPaused, "pauseCapture should succeed")
    let pauseStartHost = harness.queue.sync { harness.pauseStartedHostTime! }
    let measuredActiveInterval = CMTimeSubtract(pauseStartHost, startHost).seconds
    check(measuredActiveInterval >= 0.03, "expected positive pre-pause active interval, got \\(measuredActiveInterval)")

    try? await Task.sleep(nanoseconds: 150_000_000)
    let resumed = await harness.resumeCapture()
    check(resumed && !harness.isPaused, "resumeCapture should succeed")

    let pausedDuration = harness.queue.sync { harness.accumulatedPausedDuration.seconds }
    let resumeHost = harness.queue.sync { harness.lastResumeHostTime! }
    let measuredPauseInterval = CMTimeSubtract(resumeHost, pauseStartHost).seconds
    check(measuredPauseInterval >= 0.13, "expected positive pause interval, got \\(measuredPauseInterval)")
    check(
        abs(pausedDuration - measuredPauseInterval) < 0.001,
        "accumulatedPausedDuration (\\(pausedDuration)) must match lastResumeHostTime - pauseStartedHostTime (\\(measuredPauseInterval))"
    )

    // Samples captured during the pause window must be dropped.
    let preResumeAudio = CMTimeAdd(resumeHost, CMTime(seconds: -0.02, preferredTimescale: 1_000_000_000))
    let droppedAudio = harness.queue.sync {
        harness.adjustedPresentationTime(for: StubSampleBuffer(presentationTimeStamp: preResumeAudio), outputType: .audio)
    }
    check(droppedAudio == nil, "pre-resume audio sample must be rejected")

    // Audio arriving after resume with no intervening .screen frame must NOT be dropped.
    let postResumeAudioHost = CMTimeAdd(resumeHost, CMTime(seconds: 0.02, preferredTimescale: 1_000_000_000))
    let postResumeAudioPts = harness.queue.sync {
        harness.adjustedPresentationTime(for: StubSampleBuffer(presentationTimeStamp: postResumeAudioHost), outputType: .audio)
    }
    check(postResumeAudioPts != nil, "audio during static screen after resume must be accepted")
    let audioTimeline = postResumeAudioPts!.seconds
    let expectedAudioTimeline = measuredActiveInterval + 0.02
    check(
        abs(audioTimeline - expectedAudioTimeline) < 0.001,
        "audio timeline (\\(audioTimeline)) must match measured active interval plus 0.02s (\\(expectedAudioTimeline))"
    )

    // A screen frame arriving much later must NOT treat the static post-resume interval as paused time.
    let delayedScreenHost = CMTimeAdd(resumeHost, CMTime(seconds: 0.50, preferredTimescale: 1_000_000_000))
    let delayedScreenPts = harness.queue.sync {
        harness.adjustedPresentationTime(for: StubSampleBuffer(presentationTimeStamp: delayedScreenHost), outputType: .screen)
    }
    check(delayedScreenPts != nil, "delayed post-resume video frame must be accepted")
    let screenTimeline = delayedScreenPts!.seconds
    let expectedScreenTimeline = measuredActiveInterval + 0.50
    check(
        abs(screenTimeline - expectedScreenTimeline) < 0.001,
        "video timeline (\\(screenTimeline)) must preserve static post-resume duration (\\(expectedScreenTimeline))"
    )
    let pausedDurationAfterVideo = harness.queue.sync { harness.accumulatedPausedDuration.seconds }
    check(abs(pausedDurationAfterVideo - pausedDuration) < 0.001, "video arrival must not inflate accumulatedPausedDuration")

    // timelineTimeOfStop remains valid immediately after resume even without a new video frame.
    let stopWhileActive = harness.queue.sync { harness.timelineTimeOfStop() }
    check(stopWhileActive != nil, "timelineTimeOfStop must be available right after resume")

    // 2. Warm-start pause/resume before the first video frame still anchors audio to .screen.
    let warm = Harness()
    let warmPause = await warm.pauseCapture()
    check(warmPause, "warm pauseCapture should succeed")
    try? await Task.sleep(nanoseconds: 80_000_000)
    let warmResume = await warm.resumeCapture()
    check(warmResume, "warm resumeCapture should succeed")
    let warmPauseAcc = warm.queue.sync { warm.accumulatedPausedDuration.seconds }
    check(warmPauseAcc == 0, "pause before first frame must not offset future timeline, got \\(warmPauseAcc)")

    let warmHost = warm.queue.sync { warm.lastResumeHostTime! }
    let earlyAudio = warm.queue.sync {
        warm.adjustedPresentationTime(
            for: StubSampleBuffer(presentationTimeStamp: CMTimeAdd(warmHost, CMTime(seconds: 0.01, preferredTimescale: 1_000_000_000))),
            outputType: .audio
        )
    }
    check(earlyAudio == nil, "audio before first video frame must wait for screen anchor")

    let warmScreen = warm.queue.sync {
        warm.adjustedPresentationTime(
            for: StubSampleBuffer(presentationTimeStamp: CMTimeAdd(warmHost, CMTime(seconds: 0.02, preferredTimescale: 1_000_000_000))),
            outputType: .screen
        )
    }
    check(warmScreen == .zero, "first post-resume frame on warm start must anchor time zero")
    exit(0)
}

dispatchMain()
`,
			);

			const binary = join(directory, "resume-test");
			const build = spawnSync("swiftc", ["-O", join(directory, "main.swift"), "-o", binary], {
				encoding: "utf8",
			});
			expect(build.status, build.stderr).toBe(0);
			const run = spawnSync(binary, [], { encoding: "utf8", timeout: 10000 });
			expect(run.status, run.stderr).toBe(0);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
);
