import { describe, expect, it } from "vitest";
import zhCommon from "@/i18n/locales/zh-CN/common.json";
import zhDialogs from "@/i18n/locales/zh-CN/dialogs.json";
import zhEditor from "@/i18n/locales/zh-CN/editor.json";
import zhLaunch from "@/i18n/locales/zh-CN/launch.json";
import zhSettings from "@/i18n/locales/zh-CN/settings.json";
import zhShortcuts from "@/i18n/locales/zh-CN/shortcuts.json";
import zhTimeline from "@/i18n/locales/zh-CN/timeline.json";

const messages = {
	common: zhCommon,
	dialogs: zhDialogs,
	editor: zhEditor,
	launch: zhLaunch,
	settings: zhSettings,
	shortcuts: zhShortcuts,
	timeline: zhTimeline,
} as const;

function readMessage(namespace: keyof typeof messages, path: string): string | undefined {
	let current: unknown = messages[namespace];
	for (const part of path.split(".")) {
		if (!current || typeof current !== "object" || !(part in current)) return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return typeof current === "string" ? current : undefined;
}

describe("简体中文界面资源", () => {
	it("contains Chinese text for the visible localization gaps", () => {
		const requiredMessages: Array<[keyof typeof messages, string, string]> = [
			["common", "loading", "正在刷新..."],
			["common", "light", "浅色"],
			["common", "dark", "深色"],
			["common", "system", "跟随系统"],
			["common", "close", "关闭"],
			["common", "announcements.dismiss", "关闭"],
			["dialogs", "addFont.alreadyAdded", "此字体已添加。"],
			["editor", "playback.play", "播放"],
			["editor", "playback.pause", "暂停"],
			["editor", "annotations.arrowDirectionOption", "箭头方向：{{direction}}"],
			["editor", "annotations.textPlaceholder", "输入文本"],
			["editor", "annotations.settings", "标注设置"],
			["editor", "annotations.tipCycleForward", "按 Tab 选择下一个重叠标注。"],
			["editor", "annotations.tipCycleBackward", "按 Shift+Tab 选择上一个重叠标注。"],
			["editor", "keyboardShortcuts.cycleAnnotations", "切换重叠标注"],
			["editor", "toolbar.splitClip", "分割片段 (C)"],
			[
				"editor",
				"timeline.speedClipOverlap",
				"变速区域会与下一个片段重叠。在减速前，请先移动或分割片段。",
			],
			["editor", "exportStatus.renderingAudio", "正在渲染音频 {{percent}}%"],
			["editor", "exportStatus.noVideoLoaded", "未加载视频"],
			[
				"editor",
				"exportStatus.saveDialogCanceled",
				"保存已取消。点击“再次保存”即可直接保存，无需重新渲染。",
			],
			["editor", "exportStatus.successToPath", "已成功导出到 {{path}}"],
			["editor", "presets.savedList", "已保存的预设"],
			["editor", "project.saveTitle", "保存项目"],
			["editor", "project.noVideoLoaded", "未加载视频"],
			["editor", "project.savedTo", "项目已保存到 {{path}}"],
			["editor", "theme.appearance", "外观"],
			["editor", "extensions.unavailableTitle", "扩展功能已不可用"],
			["editor", "projectBrowser.noPreview", "暂无预览"],
			["launch", "recording.preparing", "正在准备录制"],
			["launch", "permissions.selectSource", "请选择要录制的源"],
			["launch", "updateToast.experimentalAvailableTitle", "有测试版更新可用"],
			[
				"launch",
				"updateToast.experimentalDescription",
				"已开启测试版更新，可在 Recordly 正式版公开发布前优先试用最新版本",
			],
			["launch", "updateToast.experimentalBadge", "测试版"],
			["launch", "updateToast.previewBadge", "预览版"],
			["settings", "effects.auto", "自动"],
			["settings", "background.unsupportedFormat", "不支持的格式"],
			["settings", "effects.cursorClickEffects.ripple.label", "波纹"],
			["settings", "effects.cursorStyleOptions.dot", "圆点"],
			["settings", "effects.cursorStyleOptions.figma", "极简"],
			["settings", "sections.settings", "设置"],
			["settings", "sections.extensions", "扩展"],
			["settings", "trim.deleteRegion", "删除分割区域"],
			["settings", "annotation.delete", "删除标注"],
			["settings", "effects.webcamMirror", "摄像头镜像"],
			["settings", "captions.timelineQuickAdd", "悬停即可在时间轴添加字幕"],
			["settings", "export.exportVideo", "导出视频"],
			["settings", "captions.animationOff", "关闭"],
			["settings", "captions.animationFade", "淡入淡出"],
			["settings", "captions.animationRise", "上移"],
			["settings", "captions.animationPop", "弹出"],
			["settings", "captions.editor.text", "文本"],
			["settings", "captions.languages.auto", "自动检测"],
			[
				"settings",
				"updates.experimentalDescription",
				"你已选择接收测试版更新，因此可以在 Recordly 最新更新广泛发布之前选择先行测试。",
			],
			["settings", "updates.experimental", "测试版更新"],
			["editor", "exportTips.experimentalBuilds", "提示：可在设置中开启测试版访问权限"],
			["shortcuts", "actions.splitClip", "分割片段"],
			["shortcuts", "actions.addTrim", "添加分割"],
			["shortcuts", "actions.addAnnotation", "添加标注"],
			["shortcuts", "actions.cycleForward", "下一个重叠标注"],
			["shortcuts", "actions.cycleBackward", "上一个重叠标注"],
			["shortcuts", "actions.deleteSelectedAlt", "删除选中（替代）"],
			["timeline", "empty.noVideo", "未加载视频"],
			["timeline", "toolbar.custom", "自定义"],
			["timeline", "toolbar.aspectRatioNative", "原始比例"],
			["timeline", "annotation.label", "标注"],
			["timeline", "item.manual", "手动"],
			["timeline", "audio.cannotRead", "无法读取音频文件"],
			["timeline", "caption.cannotPlace", "无法在此处放置字幕"],
			["editor", "audio.fallbackUnavailable", "无法加载备用音频源"],
			["editor", "audio.fallbackPlaybackHint", "播放和导出可能会缺失麦克风声音。"],
		];

		for (const [namespace, path, expected] of requiredMessages) {
			expect(readMessage(namespace, path), `${namespace}.${path}`).toBe(expected);
		}
	});
});
