import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	settings: new Map<string, unknown>(),
	canInstall: vi.fn(() => true),
	download: vi.fn(async () => []),
	check: vi.fn(async () => null),
	install: vi.fn(),
	dialog: vi.fn(async () => ({ response: 1 })),
	openExternal: vi.fn(async () => undefined),
}));
vi.mock("electron", () => ({
	app: { getVersion: () => "1.4.0", isPackaged: true, on: vi.fn() },
	BrowserWindow: {},
	dialog: { showMessageBox: mocks.dialog },
	shell: { openExternal: mocks.openExternal },
}));
vi.mock("electron-updater", () => ({
	autoUpdater: Object.assign(new EventEmitter(), {
		downloadUpdate: mocks.download,
		checkForUpdates: mocks.check,
		quitAndInstall: mocks.install,
	}),
}));
vi.mock("node:fs", () => ({ default: { mkdirSync: vi.fn(), appendFileSync: vi.fn() } }));
vi.mock("./nativeI18n", () => ({
	nativeT: (key: string) => key,
	nativeNumber: (value: number) => new Intl.NumberFormat("en").format(value),
}));
vi.mock("./appPaths", () => ({ USER_DATA_PATH: "/tmp/recordly-updater-test" }));
vi.mock("./appSettingsStore", () => ({
	readAppSetting: (key: string) => mocks.settings.get(key) ?? null,
	writeAppSetting: vi.fn((key: string, value: unknown) => mocks.settings.set(key, value)),
}));

describe("background updates", () => {
	const storeDescriptor = Object.getOwnPropertyDescriptor(process, "windowsStore");
	beforeEach(() => {
		Object.defineProperty(process, "windowsStore", { configurable: true, value: false });
		mocks.settings.clear();
		vi.resetModules();
		vi.clearAllMocks();
		mocks.canInstall.mockReturnValue(true);
		vi.useFakeTimers();
	});
	afterEach(() => {
		if (storeDescriptor) Object.defineProperty(process, "windowsStore", storeDescriptor);
		else delete process.windowsStore;
		vi.clearAllTimers();
		vi.useRealTimers();
	});
	async function setup(automaticDownloads: boolean | null = true) {
		if (automaticDownloads !== null)
			mocks.settings.set("automaticUpdateDownloadsEnabled", automaticDownloads);
		const updater = await import("./updater");
		const { autoUpdater } = await import("electron-updater");
		autoUpdater.removeAllListeners();
		const send = vi.fn(() => true);
		updater.setupAutoUpdates(() => null, send, mocks.canInstall);
		return { updater, autoUpdater, send };
	}
	it("downloads silently on discovery and waits for an explicit restart to install", async () => {
		const { updater, autoUpdater, send } = await setup();
		autoUpdater.emit("update-available", { version: "1.5.0" });
		expect(
			send.mock.calls.some(
				(call) =>
					(call as unknown[])[1] &&
					((call as unknown[])[1] as { phase: string }).phase === "available",
			),
		).toBe(false);
		expect(mocks.dialog).not.toHaveBeenCalled();
		expect(mocks.download).toHaveBeenCalledTimes(1);
		expect(updater.getUpdateStatusSummary().status).toBe("downloading");
		autoUpdater.emit("download-progress", {
			percent: 50,
			transferred: 50,
			total: 100,
			bytesPerSecond: 10,
		});
		expect(updater.getCurrentUpdateToastPayload()).toMatchObject({
			phase: "downloading",
			progressPercent: 50,
		});
		autoUpdater.emit("update-downloaded", { version: "1.5.0" });
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.install).not.toHaveBeenCalled();
		expect(updater.getCurrentUpdateToastPayload()?.phase).toBe("ready");
		updater.installDownloadedUpdateNow(send);
		expect(mocks.install).toHaveBeenCalledTimes(1);
	});
	it("keeps the downloaded update across subsequent checks and dismissal", async () => {
		const { updater, autoUpdater, send } = await setup();
		autoUpdater.emit("update-available", { version: "1.5.0" });
		await updater.checkForAppUpdates(() => null, { manual: true });
		expect(mocks.check).not.toHaveBeenCalled();
		updater.dismissUpdateToast(() => null, send);
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();
		autoUpdater.emit("update-downloaded", { version: "1.5.0" });
		updater.dismissUpdateToast(() => null, send);
		await updater.checkForAppUpdates(() => null, { manual: true });
		expect(mocks.check).not.toHaveBeenCalled();
		expect(updater.getUpdateStatusSummary().status).toBe("ready");
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();
		await vi.advanceTimersByTimeAsync(updater.UPDATE_REMINDER_DELAY_MS - 5 * 60 * 1000);
		expect(updater.getCurrentUpdateToastPayload()?.phase).toBe("ready");
		expect(mocks.install).not.toHaveBeenCalled();
	});
	it("allows retry after a failed background download without requesting restart", async () => {
		const { updater, autoUpdater, send } = await setup();
		mocks.download.mockRejectedValueOnce(new Error("Network offline"));
		autoUpdater.emit("update-available", { version: "1.5.0" });
		await vi.advanceTimersByTimeAsync(0);
		expect(updater.getCurrentUpdateToastPayload()?.phase).toBe("error");
		await updater.downloadAvailableUpdate(send, { installAfterDownload: true });
		autoUpdater.emit("update-downloaded", { version: "1.5.0" });
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.install).not.toHaveBeenCalled();
		expect(updater.getCurrentUpdateToastPayload()?.phase).toBe("ready");
	});

	it.each([
		true,
		false,
	])("only auto-restarts a requested update when restart is safe (%s)", async (safe) => {
		const { updater, autoUpdater, send } = await setup();
		mocks.download.mockRejectedValueOnce(new Error("Network offline"));
		autoUpdater.emit("update-available", { version: "1.5.0" });
		await vi.advanceTimersByTimeAsync(0);
		let finish!: () => void;
		mocks.download.mockImplementationOnce(
			() =>
				new Promise<string[]>((resolve) => {
					finish = () => {
						autoUpdater.emit("update-downloaded", { version: "1.5.0" });
						resolve([]);
					};
				}),
		);
		const request = updater.downloadAvailableUpdate(send, {
			installAfterDownload: true,
			canInstall: () => safe,
		});
		expect(mocks.install).not.toHaveBeenCalled();
		finish();
		await request;
		expect(mocks.install).toHaveBeenCalledTimes(safe ? 1 : 0);
		if (!safe) expect(updater.getCurrentUpdateToastPayload()?.phase).toBe("ready");
	});
	it("simulates an automatic restart without installing a real update", async () => {
		const { updater, send } = await setup();
		updater.previewUpdateToast(send);
		await updater.downloadAvailableUpdate(send, {
			installAfterDownload: true,
			canInstall: () => true,
		});
		await vi.advanceTimersByTimeAsync(1600);
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();
		expect(mocks.install).not.toHaveBeenCalled();
	});

	it("checks for updates shortly after launching", async () => {
		await setup();
		await vi.advanceTimersByTimeAsync(1499);
		expect(mocks.check).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.check).toHaveBeenCalledOnce();
	});
	it("honors a ready update snooze when opening the app again", async () => {
		const { updater, autoUpdater, send } = await setup();
		autoUpdater.emit("update-available", { version: "1.5.0" });
		autoUpdater.emit("update-downloaded", { version: "1.5.0" });
		updater.deferUpdateReminder(() => null, send);
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();
		expect(updater.showUpdateNotificationOnOpen(() => null, send)).toBe(false);
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();
		await vi.advanceTimersByTimeAsync(updater.UPDATE_REMINDER_DELAY_MS);
		expect(updater.getCurrentUpdateToastPayload()?.phase).toBe("ready");
		expect(mocks.download).toHaveBeenCalledOnce();
	});
	it("uses the native notification fallback when opening outside macOS", async () => {
		const { updater, autoUpdater } = await setup();
		autoUpdater.emit("update-available", { version: "1.5.0" });
		autoUpdater.emit("update-downloaded", { version: "1.5.0" });
		mocks.dialog.mockClear();
		expect(
			updater.showUpdateNotificationOnOpen(
				() => null,
				() => false,
			),
		).toBe(true);
		expect(mocks.dialog).toHaveBeenCalledOnce();
	});

	it("does not download a repeated available version twice", async () => {
		const { updater, autoUpdater } = await setup();
		autoUpdater.emit("update-available", { version: "1.5.0" });
		autoUpdater.emit("update-available", { version: "1.5.0" });
		expect(mocks.download).toHaveBeenCalledOnce();
		expect(updater.getCurrentUpdateToastPayload()?.phase).toBe("downloading");
	});
	it("previews a quiet download before presenting a restart notification", async () => {
		const { updater, send } = await setup();
		updater.previewUpdateToast(send);
		expect(updater.getCurrentUpdateToastPayload()?.phase).toBe("downloading");
		await vi.advanceTimersByTimeAsync(1600);
		expect(updater.getCurrentUpdateToastPayload()?.phase).toBe("ready");
		expect(mocks.install).not.toHaveBeenCalled();
	});

	it("honors the snooze before retrying a deferred failed download", async () => {
		const { updater, autoUpdater, send } = await setup();
		mocks.download.mockRejectedValueOnce(new Error("Network offline"));
		autoUpdater.emit("update-available", { version: "1.5.0" });
		await vi.advanceTimersByTimeAsync(0);
		updater.dismissUpdateToast(() => null, send);
		send.mockClear();
		expect(updater.showUpdateNotificationOnOpen(() => null, send)).toBe(false);
		expect(mocks.download).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(updater.UPDATE_REMINDER_DELAY_MS);
		expect(mocks.download).toHaveBeenCalledTimes(2);
		expect(updater.getCurrentUpdateToastPayload()?.phase).toBe("downloading");
		expect(mocks.dialog).not.toHaveBeenCalled();
	});

	it("defaults automatic downloads off without a saved preference", async () => {
		const { updater, autoUpdater } = await setup(null);
		expect(updater.getAutomaticUpdateDownloadsEnabled()).toBe(false);
		autoUpdater.emit("update-available", { version: "1.5.0" });
		expect(mocks.download).not.toHaveBeenCalled();
		expect(updater.getCurrentUpdateToastPayload()?.phase).toBe("available");
	});
	it("saves the choice across module reloads and starts an available download when enabled", async () => {
		const { updater, autoUpdater, send } = await setup(false);
		autoUpdater.emit("update-available", { version: "1.5.0" });
		expect(updater.setAutomaticUpdateDownloadsEnabled(true, send)).toBe(true);
		expect(mocks.download).toHaveBeenCalledOnce();
		vi.resetModules();
		const reloaded = await import("./updater");
		expect(reloaded.getAutomaticUpdateDownloadsEnabled()).toBe(true);
		reloaded.setAutomaticUpdateDownloadsEnabled(false);
		expect(reloaded.getAutomaticUpdateDownloadsEnabled()).toBe(false);
	});
	it("does not automatically download after the preference is disabled", async () => {
		const { updater, autoUpdater } = await setup();
		updater.setAutomaticUpdateDownloadsEnabled(false);
		autoUpdater.emit("update-available", { version: "1.5.0" });
		expect(mocks.download).not.toHaveBeenCalled();
		await updater.downloadAvailableUpdate();
		expect(mocks.download).toHaveBeenCalledOnce();
	});
	it("ignores restart before an update has downloaded", async () => {
		const { updater, send } = await setup();
		updater.installDownloadedUpdateNow(send);
		expect(mocks.install).not.toHaveBeenCalled();
	});
	it("leaves Store packages entirely under Store update control", async () => {
		Object.defineProperty(process, "windowsStore", { configurable: true, value: true });
		const { updater, autoUpdater, send } = await setup();
		expect(updater.isAutoUpdateFeatureEnabled()).toBe(false);
		expect(updater.setExperimentalUpdatesEnabled(true)).toBe(false);
		expect(updater.setAutomaticUpdateDownloadsEnabled(true)).toBe(false);
		expect(updater.getAutomaticUpdateDownloadsEnabled()).toBe(false);
		expect(updater.getExperimentalUpdatesEnabled()).toBe(false);
		const { writeAppSetting } = await import("./appSettingsStore");
		expect(writeAppSetting).not.toHaveBeenCalled();
		expect(autoUpdater.listenerCount("update-available")).toBe(0);
		autoUpdater.emit("update-available", { version: "9.0.0" });
		await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000);
		await updater.checkForAppUpdates(() => null);
		expect(await updater.downloadAvailableUpdate(send)).toMatchObject({ success: false });
		updater.installDownloadedUpdateNow(send);
		expect(mocks.download).not.toHaveBeenCalled();
		expect(mocks.check).not.toHaveBeenCalled();
		expect(mocks.install).not.toHaveBeenCalled();
		expect(mocks.openExternal).not.toHaveBeenCalled();
		await updater.checkForAppUpdates(() => null, { manual: true });
		expect(mocks.openExternal).toHaveBeenCalledWith("ms-windows-store://downloadsandupdates");
		expect(mocks.dialog).not.toHaveBeenCalled();
	});

	it("keeps a ready update available when the shared restart guard blocks installation", async () => {
		const { updater, autoUpdater, send } = await setup(false);
		autoUpdater.emit("update-available", { version: "1.5.0" });
		autoUpdater.emit("update-downloaded", { version: "1.5.0" });
		mocks.canInstall.mockReturnValue(false);
		expect(updater.installDownloadedUpdateNow(send)).toMatchObject({
			success: false,
			message: "restartBlocked",
		});
		expect(mocks.install).not.toHaveBeenCalled();
		expect(updater.getCurrentUpdateToastPayload()?.phase).toBe("ready");
		mocks.canInstall.mockReturnValue(true);
		expect(updater.installDownloadedUpdateNow(send)).toEqual({ success: true });
		expect(mocks.install).toHaveBeenCalledOnce();
	});

	it("rechecks restart safety when a native dialog is accepted", async () => {
		const { updater, autoUpdater } = await setup(false);
		autoUpdater.emit("update-available", { version: "1.5.0" });
		autoUpdater.emit("update-downloaded", { version: "1.5.0" });
		mocks.dialog.mockResolvedValueOnce({ response: 0 });
		updater.showUpdateNotificationOnOpen(
			() => null,
			() => false,
		);
		mocks.canInstall.mockReturnValue(false);
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.install).not.toHaveBeenCalled();
		expect(mocks.dialog).toHaveBeenLastCalledWith(
			expect.objectContaining({ message: "restartBlocked" }),
		);
		expect(updater.getUpdateStatusSummary().status).toBe("ready");
	});

	it("removes a pending beta after opting out and permits a stable check", async () => {
		const { updater, autoUpdater, send } = await setup(false);
		updater.setExperimentalUpdatesEnabled(true);
		autoUpdater.emit("update-available", { version: "2.0.0-beta.2" });
		autoUpdater.emit("update-downloaded", { version: "2.0.0-beta.2" });
		updater.setExperimentalUpdatesEnabled(false);
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();
		expect(updater.installDownloadedUpdateNow(send).success).toBe(false);
		expect(mocks.install).not.toHaveBeenCalled();
		await updater.checkForAppUpdates(() => null);
		expect(mocks.check).toHaveBeenCalledOnce();
	});

	it.each([
		false,
		true,
	])("quarantines an in-flight beta after opting out (failure=%s)", async (failure) => {
		const { updater, autoUpdater, send } = await setup(false);
		updater.setExperimentalUpdatesEnabled(true);
		autoUpdater.emit("update-available", { version: "2.0.0-beta.2" });
		let finish!: () => void;
		mocks.download.mockImplementationOnce(
			() =>
				new Promise<string[]>((resolve, reject) => {
					finish = () => {
						if (failure) {
							const error = new Error("Old beta download failed");
							autoUpdater.emit("error", error);
							reject(error);
						} else {
							autoUpdater.emit("update-downloaded", { version: "2.0.0-beta.2" });
							resolve([]);
						}
					};
				}),
		);
		const request = updater.downloadAvailableUpdate(send);
		updater.setExperimentalUpdatesEnabled(false);
		await updater.checkForAppUpdates(() => null);
		expect(mocks.check).not.toHaveBeenCalled();
		autoUpdater.emit("download-progress", {
			percent: 80,
			transferred: 80,
			total: 100,
			bytesPerSecond: 10,
		});
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();
		finish();
		await request;
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.check).toHaveBeenCalledOnce();
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();
		expect(updater.installDownloadedUpdateNow(send).success).toBe(false);
		expect(mocks.install).not.toHaveBeenCalled();
	});

	it("ignores a beta discovered by an old channel check and checks stable afterward", async () => {
		const { updater, autoUpdater } = await setup(false);
		updater.setExperimentalUpdatesEnabled(true);
		let finish!: () => void;
		mocks.check.mockImplementationOnce(
			() =>
				new Promise<null>((resolve) => {
					finish = () => {
						autoUpdater.emit("update-available", { version: "2.0.0-beta.2" });
						resolve(null);
					};
				}),
		);
		const check = updater.checkForAppUpdates(() => null);
		updater.setExperimentalUpdatesEnabled(false);
		finish();
		await check;
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.check).toHaveBeenCalledTimes(2);
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();
		expect(mocks.download).not.toHaveBeenCalled();
	});

	it("preserves a stable downloaded update when opting out of experimental updates", async () => {
		const { updater, autoUpdater } = await setup(false);
		updater.setExperimentalUpdatesEnabled(true);
		autoUpdater.emit("update-available", { version: "2.0.0" });
		autoUpdater.emit("update-downloaded", { version: "2.0.0" });
		updater.setExperimentalUpdatesEnabled(false);
		expect(updater.getUpdateStatusSummary()).toMatchObject({
			status: "ready",
			availableVersion: "2.0.0",
		});
	});
});
