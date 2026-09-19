import { describe, expect, it } from "vitest";
import launch from "./launch.json";
import timeline from "./timeline.json";

describe("zh-CN localization feedback fixes", () => {
	it("uses a clear microphone permission message", () => {
		expect(launch.permissions.microphoneDenied).toBe(
			"麦克风访问被拒绝。将继续录制，但不包含麦克风音频。",
		);
	});

	it("uses the correct cursor telemetry wording", () => {
		expect(timeline.zoom.noTelemetry).toBe("无有效光标轨迹数据");
	});
});
