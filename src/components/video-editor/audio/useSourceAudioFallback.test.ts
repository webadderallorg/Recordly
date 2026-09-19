import { describe, expect, it } from "vitest";
import { formatSourceAudioFallbackWarning } from "./useSourceAudioFallback";

const translate = (key: string, _fallback?: string, vars?: Record<string, string | number>) => {
	if (key === "editor.audio.fallbackUnavailableWithError") {
		return `无法加载备用音频源：${vars?.error ?? ""}`;
	}
	if (key === "editor.audio.fallbackUnavailableWithPlaybackHint") {
		return "无法加载备用音频源。播放和导出可能会缺失麦克风声音。";
	}
	return key;
};

describe("formatSourceAudioFallbackWarning", () => {
	it("uses one localized template with the summarized error", () => {
		expect(
			formatSourceAudioFallbackWarning(
				translate,
				(message) => `摘要：${message}`,
				"raw error",
			),
		).toBe("无法加载备用音频源：摘要：raw error");
	});

	it("uses one localized template when the fallback error has no details", () => {
		expect(formatSourceAudioFallbackWarning(translate, () => "", null)).toBe(
			"无法加载备用音频源。播放和导出可能会缺失麦克风声音。",
		);
	});
});
