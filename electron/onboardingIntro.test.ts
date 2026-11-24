import { EventEmitter } from "node:events";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";

class TestWindow extends EventEmitter {
	webContents = Object.assign(new EventEmitter(), {
		ipc: Object.assign(new EventEmitter(), {
			handle: vi.fn<
				(
					channel: string,
					handler: (event: { senderFrame: object }) => Promise<void> | undefined,
				) => void
			>(),
		}),
		mainFrame: {},
		send: vi.fn(),
	});
	private destroyed = false;
	private visible = false;
	setIgnoreMouseEvents = vi.fn();
	setBounds = vi.fn();
	setAlwaysOnTop = vi.fn();
	setOpacity = vi.fn();
	moveTop = vi.fn();
	showInactive() {
		this.visible = true;
	}
	isVisible() {
		return this.visible;
	}
	isDestroyed() {
		return this.destroyed;
	}
	destroy() {
		this.destroyed = true;
		this.emit("closed");
	}
}

vi.mock("electron", () => ({ BrowserWindow: TestWindow }));

const { getOnboardingInstallStamp, startOnboardingIntro } = await import("./onboardingIntro");

beforeEach(() =>
	vi.useFakeTimers({
		toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
	}),
);
afterEach(() => vi.useRealTimers());

it("identifies a replacement executable even when its version stays the same", () => {
	const directory = mkdtempSync(join(tmpdir(), "recordly-onboarding-install-"));
	onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
	const executable = join(directory, "Recordly");
	const replacement = join(directory, "replacement");
	const version = "2.0.0-beta.1";
	writeFileSync(executable, "same version");
	const original = getOnboardingInstallStamp(executable, version);
	expect(getOnboardingInstallStamp(executable, version)).toBe(original);
	writeFileSync(replacement, "same version");
	renameSync(replacement, executable);
	expect(getOnboardingInstallStamp(executable, version)).not.toBe(original);
});

function start(withSoundtrack = true) {
	const popup = new TestWindow();
	const show = vi.fn();
	const backdrop = startOnboardingIntro(
		{ x: 0, y: 0, width: 1440, height: 900 },
		"/test/preload.js",
		vi.fn(),
		{ popup: popup as unknown as BrowserWindow, show },
	) as unknown as TestWindow;
	const stage = (name: string) =>
		backdrop.webContents.ipc.emit(
			"onboarding-intro",
			{ senderFrame: backdrop.webContents.mainFrame },
			name,
		);
	const soundtrackReady = (senderFrame = popup.webContents.mainFrame) =>
		popup.webContents.ipc.emit("onboarding-soundtrack-ready", { senderFrame });
	if (withSoundtrack) soundtrackReady();
	return { popup, show, backdrop, stage, soundtrackReady };
}

it("starts the soundtrack at logo reveal and keeps the same playback through handoff", () => {
	const { backdrop, popup, show, stage, soundtrackReady } = start(false);
	popup.emit("ready-to-show");
	soundtrackReady({});
	expect(backdrop.isVisible()).toBe(false);
	expect(popup.webContents.send).not.toHaveBeenCalled();

	soundtrackReady();
	expect(popup.webContents.send).not.toHaveBeenCalled();
	stage("ready");
	expect(backdrop.isVisible()).toBe(true);
	expect(popup.webContents.send).toHaveBeenCalledExactlyOnceWith("onboarding-soundtrack-start");
	expect(popup.webContents.send).toHaveBeenCalledBefore(backdrop.webContents.send);
	expect(show).not.toHaveBeenCalled();

	stage("finished");
	expect(show).toHaveBeenCalledOnce();
	expect(popup.webContents.send).toHaveBeenCalledTimes(1);
});

it.each([
	"finished",
	"skipped",
])("starts the banner when onboarding appears after an intro that %s", async (outcome) => {
	const { backdrop, popup, show, stage } = start();
	const [channel, waitForBanner] = popup.webContents.ipc.handle.mock.calls[0];
	expect(channel).toBe("wait-for-onboarding-banner");
	expect(waitForBanner({ senderFrame: {} })).toBeUndefined();
	const frame = { senderFrame: popup.webContents.mainFrame };
	const started = vi.fn();
	void waitForBanner(frame)?.then(started);

	stage("ready");
	await vi.advanceTimersByTimeAsync(1200);
	expect(started).not.toHaveBeenCalled();
	stage(outcome);
	await Promise.resolve();
	expect(show).not.toHaveBeenCalled();
	expect(started).not.toHaveBeenCalled();
	popup.emit("ready-to-show");
	await Promise.resolve();
	expect(show).toHaveBeenCalledBefore(started);
	expect(started).toHaveBeenCalledOnce();
	expect(backdrop.setOpacity).not.toHaveBeenCalled();
	await expect(waitForBanner(frame)).resolves.toBeUndefined();
});

it("shows the logo during a popup reload and starts audio from the replacement document", () => {
	const { backdrop, popup, stage, soundtrackReady } = start();
	popup.emit("ready-to-show");
	const oldFrame = popup.webContents.mainFrame;
	popup.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
	stage("ready");
	soundtrackReady(oldFrame);
	expect(backdrop.isVisible()).toBe(true);
	expect(popup.webContents.send).not.toHaveBeenCalled();

	popup.webContents.mainFrame = {};
	popup.webContents.emit("did-navigate");
	soundtrackReady(oldFrame);
	expect(popup.webContents.send).not.toHaveBeenCalled();
	soundtrackReady();
	expect(popup.webContents.send).toHaveBeenCalledExactlyOnceWith("onboarding-soundtrack-start");
});

it("delivers the pending audio cue when the popup reload is canceled", () => {
	const { backdrop, popup, stage } = start();
	popup.emit("ready-to-show");
	popup.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
	stage("ready");
	expect(backdrop.isVisible()).toBe(true);
	expect(popup.webContents.send).not.toHaveBeenCalled();

	popup.webContents.emit("did-stop-loading");
	popup.webContents.emit("did-stop-loading");
	expect(popup.webContents.send).toHaveBeenCalledExactlyOnceWith("onboarding-soundtrack-start");
});

it.each([
	"during reveal",
	"after the backdrop closes",
])("starts late audio as soon as it is ready %s", (when) => {
	const { backdrop, popup, show, stage, soundtrackReady } = start(false);
	popup.emit("ready-to-show");
	stage("ready");
	expect(backdrop.isVisible()).toBe(true);
	expect(popup.webContents.send).not.toHaveBeenCalled();
	if (when === "during reveal") {
		soundtrackReady();
		expect(popup.webContents.send).toHaveBeenCalledExactlyOnceWith(
			"onboarding-soundtrack-start",
		);
	}
	stage("finished");
	expect(show).toHaveBeenCalledOnce();
	if (when === "after the backdrop closes") {
		vi.advanceTimersByTime(2300);
		expect(backdrop.isDestroyed()).toBe(true);
		expect(popup.webContents.send).not.toHaveBeenCalled();
		soundtrackReady();
	}
	expect(popup.webContents.send).toHaveBeenCalledExactlyOnceWith("onboarding-soundtrack-start");
});

it("waits for both the intro and popup, then fades the backdrop out", () => {
	const { popup, show, backdrop, stage } = start();
	stage("ready");
	stage("finished");
	expect(show).not.toHaveBeenCalled();
	popup.emit("ready-to-show");
	expect(show).toHaveBeenCalledOnce();
	expect(popup.setOpacity).toHaveBeenCalledWith(0);
	vi.advanceTimersByTime(1280);
	expect(popup.setOpacity).toHaveBeenLastCalledWith(1);
	expect(backdrop.setOpacity).toHaveBeenLastCalledWith(0.25);
	expect(backdrop.isDestroyed()).toBe(false);
	vi.advanceTimersByTime(999);
	expect(backdrop.isDestroyed()).toBe(false);
	vi.advanceTimersByTime(16);
	expect(backdrop.isDestroyed()).toBe(true);
});

it("lets a standalone logo replay finish its two-second fade past the playback deadline", () => {
	const backdrop = startOnboardingIntro(
		{ x: 0, y: 0, width: 1440, height: 900 },
		"/test/preload.js",
		vi.fn(),
	) as unknown as TestWindow;
	const stage = (name: string) =>
		backdrop.webContents.ipc.emit(
			"onboarding-intro",
			{ senderFrame: backdrop.webContents.mainFrame },
			name,
		);
	stage("ready");
	vi.advanceTimersByTime(9000);
	stage("finished");
	vi.advanceTimersByTime(1000);
	expect(backdrop.isDestroyed()).toBe(false);
	vi.advanceTimersByTime(1000);
	expect(backdrop.isDestroyed()).toBe(true);
});

it.each(["skip", "timeout"])("shows a ready popup after intro %s", (mode) => {
	const { popup, show, backdrop, stage } = start();
	popup.emit("ready-to-show");
	expect(show).not.toHaveBeenCalled();
	if (mode === "skip") stage("skipped");
	else vi.advanceTimersByTime(6000);
	expect(show).toHaveBeenCalledOnce();
	expect(backdrop.isDestroyed()).toBe(true);
	expect(popup.setOpacity).not.toHaveBeenCalled();
});

it("allows a late renderer to play past the original startup deadline", () => {
	const { popup, show, backdrop, stage } = start();
	popup.emit("ready-to-show");
	vi.advanceTimersByTime(5900);
	stage("ready");
	expect(backdrop.isVisible()).toBe(true);
	expect(backdrop.webContents.send).toHaveBeenCalledExactlyOnceWith("onboarding-intro-shown");
	vi.advanceTimersByTime(4500);
	expect(backdrop.isDestroyed()).toBe(false);
	expect(show).not.toHaveBeenCalled();
	stage("finished");
	expect(show).toHaveBeenCalledOnce();
	vi.advanceTimersByTime(2300);
	expect(backdrop.isDestroyed()).toBe(true);
});

function setPlatform(value: NodeJS.Platform) {
	const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
	Object.defineProperty(process, "platform", { ...platform, value });
	onTestFinished(() => Object.defineProperty(process, "platform", platform));
}

it("covers the menu bar throughout the macOS fade and restores normal stacking", () => {
	setPlatform("darwin");
	const { popup, backdrop, show, stage } = start();
	popup.emit("ready-to-show");
	stage("ready");
	expect(backdrop.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(true, "screen-saver");
	stage("finished");
	expect(popup.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(true, "screen-saver", 1);
	expect(popup.setAlwaysOnTop).toHaveBeenCalledBefore(show);
	vi.advanceTimersByTime(2279);
	expect(backdrop.isDestroyed()).toBe(false);
	expect(backdrop.setBounds).toHaveBeenCalledExactlyOnceWith({
		x: 0,
		y: 0,
		width: 1440,
		height: 900,
	});
	expect(backdrop.setAlwaysOnTop).not.toHaveBeenCalledWith(false);
	expect(popup.setAlwaysOnTop).not.toHaveBeenCalledWith(false);
	vi.advanceTimersByTime(16);
	expect(backdrop.isDestroyed()).toBe(true);
	expect(popup.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
	expect(popup.setOpacity).toHaveBeenLastCalledWith(1);
});

it.each([
	"backdrop-close",
	"popup-crash",
])("restores popup stacking and opacity on %s during the fade", (failure) => {
	setPlatform("darwin");
	const { popup, backdrop, stage } = start();
	popup.emit("ready-to-show");
	stage("ready");
	stage("finished");
	vi.advanceTimersByTime(80);
	if (failure === "backdrop-close") backdrop.destroy();
	else popup.webContents.emit("render-process-gone");
	expect(backdrop.isDestroyed()).toBe(true);
	expect(popup.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
	expect(popup.setOpacity).toHaveBeenLastCalledWith(1);
	popup.setOpacity.mockClear();
	vi.advanceTimersByTime(1000);
	expect(popup.setOpacity).not.toHaveBeenCalled();
});

it("leaves Windows stacking unchanged", () => {
	setPlatform("win32");
	const { popup, backdrop, stage } = start();
	popup.emit("ready-to-show");
	stage("ready");
	stage("finished");
	vi.advanceTimersByTime(2300);
	expect(backdrop.isDestroyed()).toBe(true);
	expect(backdrop.setAlwaysOnTop).not.toHaveBeenCalled();
	expect(popup.setAlwaysOnTop).not.toHaveBeenCalled();
});
