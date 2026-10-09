import type { Page } from "@playwright/test";
export async function installDesktopBridge(page: Page, videoFixture = "preview.mp4") {
	await page.addInitScript((videoFixture) => {
		const success = async () => ({ success: true });
		const subscribe = () => () => undefined;
		const source = {
			id: "screen:1:0",
			name: "Built-in Display",
			thumbnail: "",
			display_id: "1",
		};
		Object.assign(window, {
			electronAPI: {
				getAppSetting: (key: string) =>
					key === "recordly.onboarding.v1.seen" ? true : null,
				getMcpServerState: async () => ({
					enabled: false,
					running: false,
					url: "http://127.0.0.1:43832/mcp",
					error: null,
					controlEnabled: false,
					controlSupported: true,
				}),
				setMcpServerEnabled: async (enabled: boolean) => ({
					enabled,
					running: enabled,
					url: "http://127.0.0.1:43832/mcp",
					error: null,
					controlEnabled: false,
					controlSupported: true,
				}),
				regenerateMcpServerToken: async () => ({
					enabled: true,
					running: true,
					url: "http://127.0.0.1:43832/mcp",
					error: null,
					controlEnabled: false,
					controlSupported: true,
				}),
				copyMcpSetupCommand: async () => undefined,
				setMcpControlEnabled: async (enabled: boolean) => ({
					enabled: true,
					running: true,
					url: "http://127.0.0.1:43832/mcp",
					error: null,
					controlEnabled: enabled,
					controlSupported: true,
				}),
				onRemoteRecordingCommand: subscribe,
				sendRemoteRecordingResult: () => undefined,
				notifyRemoteRecordingReady: () => undefined,
				onRemoteExportRequest: subscribe,
				sendRemoteExportResult: () => undefined,
				sendRemoteExportProgress: () => undefined,
				sendRemoteEditorReady: () => undefined,
				onRemoteReviewRequest: subscribe,
				sendRemoteReviewResult: () => undefined,
				finishRecordingStartup: async () => undefined,
				showProjectDashboard: async () => {
					document.documentElement.dataset.dashboardOpened = "true";
				},
				chooseRecordingsDirectory: async () => ({
					success: true,
					path: "/new-recordings",
					canceled: false,
				}),
				setHudOverlayCaptureProtection: async (enabled: boolean) => {
					document.documentElement.dataset.hideHud = String(enabled);
					return { success: true, enabled };
				},
				previewUpdateToast: async () => ({ success: true }),
				setRecordingsRemoved: async () => ({ success: true, value: null }),
				getRecordingThumbnail: async () => ({ success: false, error: "Unavailable" }),
				setAppSetting: () => true,
				getExperimentalUpdatesEnabled: async () => false,
				getScreenRecordingPermissionStatus: async () => ({
					success: true,
					status: "granted",
				}),
				getAccessibilityPermissionStatus: async () => ({ success: true, trusted: true }),
				getPlatform: async () => "darwin",
				getWindowChrome: async () => ({ trafficLightsVisible: true }),
				onWindowChromeChanged: (
					callback: (chrome: { trafficLightsVisible: boolean }) => void,
				) => {
					const listener = (event: Event) => callback((event as CustomEvent).detail);
					window.addEventListener("test-window-chrome", listener);
					return () => window.removeEventListener("test-window-chrome", listener);
				},
				getAppVersion: async () => "1.4.0",
				getProjectPreview: async () => ({ success: false, error: "Preview unavailable" }),
				getAnnouncements: async () => ({ success: true, announcements: [] }),
				loadCurrentProjectFile: async () => ({ success: false }),
				createProjectFile: async () => {
					document.documentElement.dataset.projectCreates = String(
						Number(document.documentElement.dataset.projectCreates || 0) + 1,
					);
					return {
						success: true,
						path: "/projects/Untitled Project.recordly",
						projectId: "test-project",
					};
				},
				saveProjectFile: async (
					_data: unknown,
					_name: string,
					projectPath: string,
					thumbnail?: string,
				) => {
					document.documentElement.dataset.projectSaves = String(
						Number(document.documentElement.dataset.projectSaves || 0) + 1,
					);
					if (thumbnail)
						document.documentElement.dataset.savedThumbnail = thumbnail.slice(0, 22);
					return { success: true, path: projectPath, projectId: "test-project" };
				},
				showRecordingHud: async () => {
					document.documentElement.dataset.hudOpened = "true";
				},
				trashProjectFiles: async (paths: string[]) => ({
					success: true,
					deleted: paths,
					errors: [],
				}),
				getCurrentRecordingSession: async () => ({ success: true, session: null }),
				getCurrentVideoPath: async () => ({
					success: true,
					path: `${location.origin}/tests/ui/fixtures/${videoFixture}`,
				}),
				getCursorTelemetry: async () => ({ success: true, samples: [] }),
				getAgentActivity: async () => ({ success: true, log: null }),
				getVideoAudioFallbackPaths: async () => ({ success: true, paths: [] }),
				getWhisperSmallModelStatus: async () => ({ success: true, exists: false }),
				listProjectFiles: async () => ({ success: true, projects: [], entries: [] }),
				setCurrentVideoPath: success,
				finishRecordingImport: success,
				setCurrentRecordingSession: success,
				setHasUnsavedChanges: success,
				onAuthCallbackUrl: subscribe,
				onProjectThumbnailReady: subscribe,
				getPendingAuthCallbackUrl: async () => null,
				ackAuthCallbackUrl: success,
				onMenuSaveProject: subscribe,
				onMenuSaveProjectAs: subscribe,
				onMenuLoadProject: subscribe,
				onRequestSaveBeforeClose: subscribe,
				onRecordingSessionChanged: subscribe,
				onWhisperSmallModelDownloadProgress: subscribe,
				getSelectedSource: async () => source,
				getSources: async () => [source],
				selectSource: success,
				onSelectedSourceChanged: subscribe,
				getRecordingsDirectory: async () => ({ success: true, path: "/recordings" }),
				getHudOverlayMousePassthroughSupported: async () => ({
					success: true,
					supported: true,
				}),
				getHudOverlayCaptureProtection: async () => ({
					success: true,
					enabled: false,
					supported: true,
				}),
				getRecordingAudioLabConfig: async () => ({ success: true, enabled: false }),
				getCountdownDelay: async () => ({ success: true, delay: 3 }),
				setCountdownDelay: success,
				getRecordingPreferences: async () => ({
					success: true,
					microphoneEnabled: false,
					webcamEnabled: false,
					systemAudioEnabled: true,
				}),
				setRecordingPreferences: success,
				onStopRecordingFromTray: subscribe,
				onRecordingStateChanged: subscribe,
				onRecordingInterrupted: subscribe,
				hudOverlayRendererReady: success,
				hudOverlaySetIgnoreMouse: success,
				hudOverlaySetWebcamPreviewVisible: success,
				getEditorMode: async () => false,
				onEditorModeChanged: subscribe,
				getActiveCountdown: async () => ({ success: true, seconds: 3 }),
				onCountdownTick: subscribe,
				cancelCountdown: async () => {
					document.documentElement.dataset.countdownCancelled = "true";
					return { success: true };
				},
				getCurrentUpdateToastPayload: async () => ({
					version: "1.4.1",
					detail: "A new version of Recordly is available.",
					phase: "available",
					delayMs: 60000,
					isPreview: true,
				}),
				onUpdateToastStateChanged: subscribe,
				dismissUpdateToast: async () => {
					document.documentElement.dataset.updateDismissed = "true";
					return { success: true };
				},
				...window.electronAPI,
			},
		});
	}, videoFixture);
}

/** Overrides can run before or after bridge defaults; Playwright does not order init scripts. */
export async function installDesktopBridgeOverrides<T = undefined>(
	page: Page,
	setup: (arg: T) => void,
	arg?: T,
) {
	await page.addInitScript({
		content: `window.electronAPI ??= {}; (${setup.toString()})(${JSON.stringify(arg) ?? "undefined"});`,
	});
}
