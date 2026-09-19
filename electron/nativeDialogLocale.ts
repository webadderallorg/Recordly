export type NativeDialogCopy = {
	recordingsFolderTitle: string;
	importMediaOrProjectTitle: string;
	selectVideoTitle: string;
	mediaOrProjectFilter: string;
	videoFileFilter: string;
	projectFileFilter: string;
	jsonFileFilter: string;
	allFilesFilter: string;
	selectAudioTitle: string;
	audioFileFilter: string;
	selectWhisperExecutableTitle: string;
	executablesFilter: string;
	selectWhisperModelTitle: string;
	whisperModelsFilter: string;
	saveProjectTitle: string;
	openProjectTitle: string;
	saveGifTitle: string;
	saveVideoTitle: string;
	gifFileFilter: string;
	mp4FileFilter: string;
	updateAvailableTitle: string;
	experimentalUpdateAvailableTitle: string;
	updateAvailableMessage: string;
	experimentalUpdateAvailableMessage: string;
	updateAvailableDetail: string;
	updateAvailablePreviewDetail: string;
	experimentalUpdateDetail: string;
	experimentalUpdatePreviewDetail: string;
	installAndRestart: string;
	later: string;
	previewOnlyTitle: string;
	previewOnlyMessage: string;
	previewOnlyDetail: string;
	updateReadyTitle: string;
	updateReadyMessage: string;
	updateReadyPreviewMessage: string;
	updateReadyDetail: string;
	updateReadyPreviewDetail: string;
	updateFailedTitle: string;
	updateFailedMessage: string;
	updatesNotEnabledTitle: string;
	updatesNotEnabledMessage: string;
	updatesDisabledDetail: string;
	developmentBuildDetail: string;
	unsavedChangesTitle: string;
	unsavedChangesMessage: string;
	unsavedChangesDetail: string;
	saveAndClose: string;
	discardAndClose: string;
	cancel: string;
	okButton: string;
};

const ENGLISH_COPY: NativeDialogCopy = {
	recordingsFolderTitle: "Choose recordings folder",
	importMediaOrProjectTitle: "Import Media or Recordly Project",
	selectVideoTitle: "Select Video File",
	mediaOrProjectFilter: "Media or Recordly Projects",
	videoFileFilter: "Video Files",
	projectFileFilter: "Recordly Projects",
	jsonFileFilter: "JSON",
	allFilesFilter: "All Files",
	selectAudioTitle: "Select Audio File",
	audioFileFilter: "Audio Files",
	selectWhisperExecutableTitle: "Select Whisper Executable",
	executablesFilter: "Executables",
	selectWhisperModelTitle: "Select Whisper Model",
	whisperModelsFilter: "Whisper Models",
	saveProjectTitle: "Save Recordly Project",
	openProjectTitle: "Open Recordly Project",
	saveGifTitle: "Save Exported GIF",
	saveVideoTitle: "Save Exported Video",
	gifFileFilter: "GIF Image",
	mp4FileFilter: "MP4 Video",
	updateAvailableTitle: "Update Available",
	experimentalUpdateAvailableTitle: "Experimental Update Available",
	updateAvailableMessage: "Recordly {{version}} is available.",
	experimentalUpdateAvailableMessage:
		"Recordly {{version}} is available on the experimental channel.",
	updateAvailableDetail: "Install and restart now, or remind me later.",
	updateAvailablePreviewDetail:
		"This is a development preview of the standard update flow. No real update will be installed.",
	experimentalUpdateDetail:
		"You've opted into experimental updates so you can test the latest Recordly update before it is widely available.",
	experimentalUpdatePreviewDetail:
		"You've opted into experimental updates. This is a development preview, and no real update will be installed.",
	installAndRestart: "Install & Restart",
	later: "Later",
	previewOnlyTitle: "Preview Only",
	previewOnlyMessage: "No real update was installed.",
	previewOnlyDetail: "This was only a manual development preview of the update prompt.",
	updateReadyTitle: "Update Ready",
	updateReadyMessage: "Recordly {{version}} has been downloaded.",
	updateReadyPreviewMessage: "Recordly {{version}} is ready to install.",
	updateReadyDetail: "Install and restart now, or remind me later.",
	updateReadyPreviewDetail:
		"Development preview of the native update prompt. No real update will be installed.",
	updateFailedTitle: "Update Failed",
	updateFailedMessage: "Recordly {{version}} could not be downloaded.",
	updatesNotEnabledTitle: "Updates Not Enabled",
	updatesNotEnabledMessage: "Auto-updates are only available in packaged releases.",
	updatesDisabledDetail:
		"This build disabled auto-updates through RECORDLY_DISABLE_AUTO_UPDATES=1.",
	developmentBuildDetail:
		"Development builds do not ship the packaged update metadata required by electron-updater.",
	unsavedChangesTitle: "Unsaved Changes",
	unsavedChangesMessage: "You have unsaved changes.",
	unsavedChangesDetail: "Do you want to save your project before closing?",
	saveAndClose: "Save & Close",
	discardAndClose: "Discard & Close",
	cancel: "Cancel",
	okButton: "OK",
};

const SIMPLIFIED_CHINESE_COPY: NativeDialogCopy = {
	recordingsFolderTitle: "选择录制文件夹",
	importMediaOrProjectTitle: "导入媒体或 Recordly 项目",
	selectVideoTitle: "选择视频文件",
	mediaOrProjectFilter: "媒体或 Recordly 项目",
	videoFileFilter: "视频文件",
	projectFileFilter: "Recordly 项目",
	jsonFileFilter: "JSON 文件",
	allFilesFilter: "所有文件",
	selectAudioTitle: "选择音频文件",
	audioFileFilter: "音频文件",
	selectWhisperExecutableTitle: "选择 Whisper 可执行文件",
	executablesFilter: "可执行文件",
	selectWhisperModelTitle: "选择 Whisper 模型",
	whisperModelsFilter: "Whisper 模型",
	saveProjectTitle: "保存 Recordly 项目",
	openProjectTitle: "打开 Recordly 项目",
	saveGifTitle: "保存导出 GIF",
	saveVideoTitle: "保存导出视频",
	gifFileFilter: "GIF 图片",
	mp4FileFilter: "MP4 视频",
	updateAvailableTitle: "有可用更新",
	experimentalUpdateAvailableTitle: "有测试版更新可用",
	updateAvailableMessage: "Recordly {{version}} 可用。",
	experimentalUpdateAvailableMessage: "Recordly {{version}} 测试版可用。",
	updateAvailableDetail: "现在安装并重启，或稍后提醒。",
	updateAvailablePreviewDetail: "这是标准更新流程的开发预览，不会安装真实更新。",
	experimentalUpdateDetail: "你已启用测试版更新，可在正式发布前体验 Recordly 的最新版本。",
	experimentalUpdatePreviewDetail: "这是测试版更新流程的开发预览，不会安装真实更新。",
	installAndRestart: "安装并重启",
	later: "稍后",
	previewOnlyTitle: "仅供预览",
	previewOnlyMessage: "未安装真实更新。",
	previewOnlyDetail: "这只是更新提示的开发预览。",
	updateReadyTitle: "更新已准备就绪",
	updateReadyMessage: "Recordly {{version}} 已下载完成。",
	updateReadyPreviewMessage: "Recordly {{version}} 已准备安装。",
	updateReadyDetail: "现在安装并重启，或稍后提醒。",
	updateReadyPreviewDetail: "这是原生更新提示的开发预览，不会安装真实更新。",
	updateFailedTitle: "更新失败",
	updateFailedMessage: "无法下载 Recordly {{version}}。",
	updatesNotEnabledTitle: "未启用更新",
	updatesNotEnabledMessage: "自动更新仅适用于正式打包版本。",
	updatesDisabledDetail: "此版本通过 RECORDLY_DISABLE_AUTO_UPDATES=1 禁用了自动更新。",
	developmentBuildDetail: "开发版没有 electron-updater 所需的正式更新元数据。",
	unsavedChangesTitle: "未保存的更改",
	unsavedChangesMessage: "你有未保存的更改。",
	unsavedChangesDetail: "关闭前是否保存项目？",
	saveAndClose: "保存并关闭",
	discardAndClose: "放弃并关闭",
	cancel: "取消",
	okButton: "确定",
};

let currentLocale = "en";

export function setNativeDialogLocale(locale: string): void {
	currentLocale = locale.toLowerCase().startsWith("zh-cn") ? "zh-CN" : "en";
}

export function getNativeDialogCopy(): NativeDialogCopy {
	return currentLocale === "zh-CN" ? SIMPLIFIED_CHINESE_COPY : ENGLISH_COPY;
}

export function formatNativeDialogText(
	text: string,
	vars: Record<string, string | number>,
): string {
	return text.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) => {
		const value = vars[key];
		return value === undefined ? placeholder : String(value);
	});
}
