import { describe, expect, it } from "vitest";
import {
	formatNativeDialogText,
	getNativeDialogCopy,
	setNativeDialogLocale,
} from "./nativeDialogLocale";

describe("native dialog localization", () => {
	it("returns simplified Chinese copy for native file dialogs", () => {
		setNativeDialogLocale("zh-CN");

		expect(getNativeDialogCopy().openProjectTitle).toBe("打开 Recordly 项目");
		expect(getNativeDialogCopy().saveVideoTitle).toBe("保存导出视频");
		expect(getNativeDialogCopy().videoFileFilter).toBe("视频文件");
		expect(getNativeDialogCopy().updateAvailableTitle).toBe("有可用更新");
		expect(getNativeDialogCopy().installAndRestart).toBe("安装并重启");
		expect(getNativeDialogCopy().previewOnlyTitle).toBe("仅供预览");
		expect(getNativeDialogCopy().unsavedChangesTitle).toBe("未保存的更改");
		expect(getNativeDialogCopy().unsavedChangesMessage).toBe("你有未保存的更改。");
		expect(getNativeDialogCopy().unsavedChangesDetail).toBe("关闭前是否保存项目？");
		expect(getNativeDialogCopy().saveAndClose).toBe("保存并关闭");
		expect(getNativeDialogCopy().discardAndClose).toBe("放弃并关闭");
		expect(getNativeDialogCopy().cancel).toBe("取消");
		expect(
			formatNativeDialogText(getNativeDialogCopy().updateAvailableMessage, {
				version: "9.9.9",
			}),
		).toBe("Recordly 9.9.9 可用。");
	});

	it("falls back to English copy for unsupported locales", () => {
		setNativeDialogLocale("en");

		expect(getNativeDialogCopy().openProjectTitle).toBe("Open Recordly Project");
		expect(getNativeDialogCopy().saveVideoTitle).toBe("Save Exported Video");
		expect(getNativeDialogCopy().updateAvailableTitle).toBe("Update Available");
		expect(getNativeDialogCopy().installAndRestart).toBe("Install & Restart");
		expect(getNativeDialogCopy().unsavedChangesTitle).toBe("Unsaved Changes");
		expect(getNativeDialogCopy().unsavedChangesMessage).toBe("You have unsaved changes.");
		expect(getNativeDialogCopy().unsavedChangesDetail).toBe(
			"Do you want to save your project before closing?",
		);
		expect(getNativeDialogCopy().saveAndClose).toBe("Save & Close");
		expect(getNativeDialogCopy().discardAndClose).toBe("Discard & Close");
		expect(getNativeDialogCopy().cancel).toBe("Cancel");
	});
});
