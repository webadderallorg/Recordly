import type { Page } from "@playwright/test";
import { installSupabaseAuth } from "./auth";

type NativeAuthRequest =
	| { action: "migrate"; items: Record<string, string> }
	| { action: "get" | "remove"; key: string }
	| { action: "set"; key: string; value: string };
declare global {
	interface Window {
		__recordlyTestAuthStorage: (
			request: NativeAuthRequest,
		) => Promise<string | null | undefined>;
		__recordlyTestBridgeReady?: boolean;
		__recordlyTestBridgeOverrides?: (() => void)[];
	}
}
export async function installDesktopBridge(
	page: Page,
	videoFixture = "preview.mp4",
	auth: { signedIn: boolean; onboarded?: boolean } = { signedIn: true },
) {
	await installSupabaseAuth(page, auth);
	// Model main-process session storage outside the renderer so reloads retain
	// auth, logout stays logged out, and legacy seeded fixtures migrate once.
	const nativeAuth = new Map<string, string>();
	let migrated = false;
	await page.exposeBinding("__recordlyTestAuthStorage", (_source, request: NativeAuthRequest) => {
		if (request.action === "migrate") {
			if (!migrated) {
				for (const [key, value] of Object.entries(request.items))
					nativeAuth.set(key, value);
				migrated = true;
			}
		} else if (request.action === "get") return nativeAuth.get(request.key) ?? null;
		else if (request.action === "set") nativeAuth.set(request.key, request.value);
		else nativeAuth.delete(request.key);
		return undefined;
	});
	await page.addInitScript(
		({ videoFixture, onboarded }) => {
			let applicationPreferences = {
				success: true,
				showInDock: true,
				hideWhileRecording: false,
				launchAtLogin: false,
				launchAtLoginSupported: true,
				platform: "darwin",
			};
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
					authStorageAvailable: async () => true,
					authStorageMigrate: async (items: Record<string, string>) => {
						await window.__recordlyTestAuthStorage({
							action: "migrate",
							items,
						});
					},
					authStorageGetItem: async (key: string) =>
						(await window.__recordlyTestAuthStorage({ action: "get", key })) as
							| string
							| null,
					authStorageSetItem: async (key: string, value: string) => {
						await window.__recordlyTestAuthStorage({
							action: "set",
							key,
							value,
						});
					},
					authStorageRemoveItem: async (key: string) => {
						await window.__recordlyTestAuthStorage({ action: "remove", key });
					},
					getAppSetting: (key: string) =>
						key === "recordly.editor.preferences"
							? { autoApplyFreshRecordingAutoZooms: false }
							: key === "recordly.onboarding.v1.seen"
								? onboarded
								: null,
					getAppSettingWithStatus: (key: string) => ({
						success: true,
						found:
							key === "recordly.editor.preferences" ||
							key === "recordly.onboarding.v1.seen",
						value:
							key === "recordly.editor.preferences"
								? { autoApplyFreshRecordingAutoZooms: false }
								: key === "recordly.onboarding.v1.seen"
									? onboarded
									: null,
					}),
					reserveRecordingSession: async () => ({
						success: true,
						message: "",
						token: "ui-recording-reservation",
					}),
					releaseRecordingStartup: (_token: string) => undefined,
					setRecordingState: async (_recording: boolean) => undefined,
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
					getRecordingThumbnail: async () => ({
						success: false,
						error: "Unavailable",
					}),
					setAppSetting: () => true,
					getApplicationPreferences: async () => applicationPreferences,
					setApplicationPreferences: async (
						patch: Partial<typeof applicationPreferences>,
					) => {
						applicationPreferences = { ...applicationPreferences, ...patch };
						return applicationPreferences;
					},
					getExperimentalUpdatesEnabled: async () => false,
					getAutomaticUpdateDownloadsEnabled: async () =>
						localStorage.getItem("test-automatic-updates") === "true",
					setAutomaticUpdateDownloadsEnabled: async (enabled: boolean) => {
						localStorage.setItem("test-automatic-updates", String(enabled));
						return { success: true, enabled };
					},
					showRecordingPermissions: async () => {
						document.documentElement.dataset.permissionsOpened = "true";
					},
					onRecordingPermissionsRequested: subscribe,
					showOnboardingWindow: async () => false,
					closeOnboardingWindow: async () => {
						document.documentElement.dataset.onboardingClosed = "true";
						return true;
					},
					openScreenRecordingPreferences: success,
					openAccessibilityPreferences: success,
					requestAccessibilityPermission: async () => ({
						success: true,
						trusted: false,
						prompted: true,
					}),
					getScreenRecordingPermissionStatus: async () => ({
						success: true,
						status: "granted",
					}),
					getAccessibilityPermissionStatus: async () => ({
						success: true,
						trusted: true,
					}),
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
					getProjectsDirectory: async () => ({
						success: true,
						path: "/projects",
					}),
					openProjectsDirectory: success,
					openRecordingsFolder: success,
					openExternalUrl: success,
					getMediaPermissionStatus: async () => ({
						success: true,
						microphone: "not-determined",
						camera: "denied",
					}),
					openMediaPermissionPreferences: success,
					getUpdateStatusSummary: async () => ({
						status: "idle",
						currentVersion: "1.4.0",
						availableVersion: null,
					}),
					checkForAppUpdates: success,
					setExperimentalUpdatesEnabled: async (enabled: boolean) => ({
						success: true,
						enabled,
					}),
					getProjectPreview: async () => ({
						success: false,
						error: "Preview unavailable",
					}),
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
							document.documentElement.dataset.savedThumbnail = thumbnail.slice(
								0,
								22,
							);
						return {
							success: true,
							path: projectPath,
							projectId: "test-project",
						};
					},
					showRecordingHud: async () => {
						document.documentElement.dataset.hudOpened = "true";
					},
					trashProjectFiles: async (paths: string[]) => ({
						success: true,
						deleted: paths,
						errors: [],
					}),
					getCurrentRecordingSession: async () => ({
						success: true,
						session: null,
					}),
					getCurrentVideoPath: async () => ({
						success: true,
						path: `${location.origin}/tests/ui/fixtures/${videoFixture}`,
					}),
					getCursorTelemetry: async () => ({ success: true, samples: [] }),
					getVideoAudioFallbackPaths: async () => ({
						success: true,
						paths: [],
					}),
					getWhisperSmallModelStatus: async () => ({
						success: true,
						exists: false,
					}),
					getCaptionModelStatus: async () => ({
						success: true,
						exists: false,
						path: null,
					}),
					onCaptionModelDownloadProgress: subscribe,
					getParakeetModelStatus: async () => ({
						success: true,
						exists: false,
					}),
					listProjectFiles: async () => ({
						success: true,
						projects: [],
						entries: [],
					}),
					setCurrentVideoPath: success,
					finishRecordingImport: success,
					setCurrentRecordingSession: success,
					setHasUnsavedChanges: success,
					onAuthCallbackUrl: (callback: (url: string) => void) => {
						const listener = (event: Event) =>
							callback((event as CustomEvent<string>).detail);
						window.addEventListener("recordly-test-auth-callback", listener);
						return () =>
							window.removeEventListener("recordly-test-auth-callback", listener);
					},
					onProjectThumbnailReady: subscribe,
					getPendingAuthCallbackUrl: async () => null,
					ackAuthCallbackUrl: success,
					onMenuSaveProject: subscribe,
					onMenuSaveProjectAs: subscribe,
					onMenuLoadProject: subscribe,
					onRequestSaveBeforeClose: subscribe,
					onRecordingSessionChanged: subscribe,
					onWhisperSmallModelDownloadProgress: subscribe,
					onParakeetModelDownloadProgress: subscribe,
					getSelectedSource: async () => source,
					getSources: async () => [source],
					selectSource: success,
					onSelectedSourceChanged: subscribe,
					getRecordingsDirectory: async () => ({
						success: true,
						path: "/recordings",
					}),
					getHudOverlayMousePassthroughSupported: async () => ({
						success: true,
						supported: true,
					}),
					getHudOverlayCaptureProtection: async () => ({
						success: true,
						enabled: false,
						supported: true,
					}),
					getRecordingAudioLabConfig: async () => ({
						success: true,
						enabled: false,
					}),
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
					onCloudShareProgress: subscribe,
					dismissUpdateToast: async () => {
						document.documentElement.dataset.updateDismissed = "true";
						return { success: true };
					},
					// Earlier init scripts may have installed only partial overrides.
					...(window.electronAPI as Partial<Window["electronAPI"]> | undefined),
				},
			});
			const overrides = window.__recordlyTestBridgeOverrides ?? [];
			window.__recordlyTestBridgeOverrides = [];
			window.__recordlyTestBridgeReady = true;
			for (const applyOverride of overrides) applyOverride();
		},
		{ videoFixture, onboarded: auth.onboarded ?? true },
	);
}

/** Overrides can run before or after bridge defaults; Playwright does not order init scripts. */
export async function installDesktopBridgeOverrides<T = undefined>(
	page: Page,
	setup: (arg: T) => void,
	arg?: T,
) {
	await page.addInitScript({
		content: `(() => {
			const applyOverride = () => (${setup.toString()})(${JSON.stringify(arg) ?? "undefined"});
			if (window.__recordlyTestBridgeReady) applyOverride();
			else (window.__recordlyTestBridgeOverrides ??= []).push(applyOverride);
		})();`,
	});
}
