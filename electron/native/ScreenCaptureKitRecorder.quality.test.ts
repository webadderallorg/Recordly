import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "darwin")(
	"native capture budgets retain Retina detail at 60 FPS",
	() => {
		const directory = mkdtempSync(join(tmpdir(), "recordly-capture-quality-"));
		try {
			const source = readFileSync(
				new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
				"utf8",
			);
			const settings = source.slice(
				source.indexOf("\tstatic func videoCompressionSettings"),
				source.indexOf("\n\tprivate static func audioOutputSettings"),
			);
			const file = join(directory, "quality.swift");
			writeFileSync(
				file,
				`import AVFoundation
  enum CaptureQuality { ${settings} }
  let hd = CaptureQuality.videoCompressionSettings(width: 1920, height: 1080, fps: 30)
  let retina = CaptureQuality.videoCompressionSettings(width: 2940, height: 1912, fps: 60)
  let uhd30 = CaptureQuality.videoCompressionSettings(width: 3840, height: 2160, fps: 30)
  let uhd60 = CaptureQuality.videoCompressionSettings(width: 3840, height: 2160, fps: 60)
  precondition(hd[AVVideoAverageBitRateKey] as! Int >= 8_000_000)
  precondition(retina[AVVideoAverageBitRateKey] as! Int > 45_000_000)
  precondition(uhd60[AVVideoAverageBitRateKey] as! Int == 2 * (uhd30[AVVideoAverageBitRateKey] as! Int))
  precondition(uhd60[AVVideoExpectedSourceFrameRateKey] as! Int == 60)
  precondition(uhd60[AVVideoMaxKeyFrameIntervalDurationKey] as! Int == 2)
  print("capture quality passed")
  `,
			);
			const result = spawnSync(
				"swift",
				["-module-cache-path", join(directory, "cache"), file],
				{ encoding: "utf8", timeout: 60_000 },
			);
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout).toContain("capture quality passed");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
	65_000,
);
