import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

class TestWindow extends EventEmitter {
	webContents = Object.assign(new EventEmitter(), {
		ipc: new EventEmitter(),
		mainFrame: {},
	});
	private destroyed = false;
	private visible = false;
	setIgnoreMouseEvents = vi.fn();
	setBounds = vi.fn();
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

const { startOnboardingIntro } = await import("./onboardingIntro");

beforeEach(() =>
	vi.useFakeTimers({
		toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
	}),
);
afterEach(() => vi.useRealTimers());

function start() {
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
	return { popup, show, backdrop, stage };
}

it("waits for both the intro and popup, then fades the backdrop out", () => {
	const { popup, show, backdrop, stage } = start();
	stage("ready");
	stage("finished");
	expect(show).not.toHaveBeenCalled();
	popup.emit("ready-to-show");
	expect(show).toHaveBeenCalledOnce();
	expect(popup.setOpacity).toHaveBeenCalledWith(0);
	vi.advanceTimersByTime(660);
	expect(popup.setOpacity).toHaveBeenLastCalledWith(1);
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
