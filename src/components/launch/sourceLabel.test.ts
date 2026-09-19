import { describe, expect, it } from "vitest";
import {
	getLocalizedSourceLabel,
	getSelectedSourceDisplayLabel,
	getSourceDisplayLabel,
} from "./sourceLabel";

const translate = (key: string, _fallback?: string, vars?: Record<string, string | number>) => {
	if (key === "recording.screen") return "屏幕";
	if (key === "recording.folder") return "文件夹";
	if (key === "recording.display") return `显示器 ${vars?.index}`;
	if (key === "recording.primaryDisplay") {
		return `显示器 ${vars?.index}（主显示器）`;
	}
	return key;
};

describe("getLocalizedSourceLabel", () => {
	it("localizes generated screen names while preserving the source index", () => {
		expect(getLocalizedSourceLabel("Screen 1", translate)).toBe("显示器 1");
		expect(getLocalizedSourceLabel("Screen 2 (Primary)", translate)).toBe(
			"显示器 2（主显示器）",
		);
	});

	it("localizes the default screen label", () => {
		expect(getLocalizedSourceLabel("Screen", translate)).toBe("屏幕");
	});

	it("does not alter dynamic window titles", () => {
		expect(getLocalizedSourceLabel("FolderBrowser", translate)).toBe("文件夹");
		expect(getLocalizedSourceLabel("文件夹", translate)).toBe("文件夹");
		expect(getLocalizedSourceLabel("ChatGPT — Recordly", translate)).toBe("ChatGPT — Recordly");
	});

	it("does not localize a window title that happens to look like a screen name", () => {
		expect(
			getSourceDisplayLabel(
				{
					id: "window:screen-like-title",
					name: "Screen 1",
					windowTitle: "Screen 1",
					sourceType: "window",
				},
				translate,
			),
		).toBe("Screen 1");
	});

	it("localizes generated labels for actual screen sources", () => {
		expect(
			getSourceDisplayLabel(
				{ id: "screen:1", name: "Screen 1", sourceType: "screen" },
				translate,
			),
		).toBe("显示器 1");
	});

	it("keeps a window title that looks like a screen name in the launch trigger", () => {
		expect(
			getSelectedSourceDisplayLabel(
				{
					id: "window:screen-like-title",
					name: "Screen 1",
					windowTitle: "Screen 1",
					sourceType: "window",
				},
				translate,
			),
		).toBe("Screen 1");
	});
});
