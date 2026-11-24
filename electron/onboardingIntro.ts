import { statSync } from "node:fs";
import { BrowserWindow, type Rectangle } from "electron";

const INTRO_TIMEOUT_MS = 6000;
const INTRO_PLAYBACK_TIMEOUT_MS = 10000;
const POPUP_FADE_MS = 280;
const BACKDROP_FADE_MS = 2000;

export function getOnboardingInstallStamp(executable: string, version: string): string {
	const { dev, ino, birthtimeMs, mtimeMs } = statSync(executable, { bigint: true });
	return `${version}:${dev}:${ino}:${birthtimeMs}:${mtimeMs}`;
}

export function startOnboardingIntro(
	bounds: Rectangle,
	preload: string,
	load: (window: BrowserWindow) => void,
	handoff?: { popup: BrowserWindow; show: () => void },
): BrowserWindow {
	const onMac = process.platform === "darwin";
	const backdrop = new BrowserWindow({
		...bounds,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		focusable: false,
		skipTaskbar: true,
		hasShadow: false,
		enableLargerThanScreen: true,
		show: false,
		...(onMac
			? { vibrancy: "fullscreen-ui", visualEffectState: "active", type: "panel" }
			: { backgroundMaterial: "acrylic" }),
		webPreferences: { preload, backgroundThrottling: false },
	});
	// Cover the menu bar without changing system-wide visibility preferences.
	if (onMac) backdrop.setAlwaysOnTop(true, "screen-saver");
	backdrop.setIgnoreMouseEvents(true);
	backdrop.setBounds(bounds);

	let popupReady = false;
	let soundtrackPending = false;
	let soundtrackCanStart = false;
	let popupNavigating = false;
	let introFinished = false;
	let startedHandoff = false;
	let deadline: NodeJS.Timeout;
	let fadeTimer: NodeJS.Timeout | undefined;
	let fadingPopup: BrowserWindow | undefined;
	let releaseBanner: (() => void) | undefined;
	if (handoff) {
		const { webContents } = handoff.popup;
		const bannerStart = new Promise<void>((resolve) => {
			releaseBanner = resolve;
		});
		webContents.ipc.handle("wait-for-onboarding-banner", (event) => {
			if (event.senderFrame && event.senderFrame === webContents.mainFrame)
				return bannerStart;
		});
	}
	const sendSoundtrackCue = () => {
		if (
			!soundtrackCanStart ||
			!soundtrackPending ||
			popupNavigating ||
			!handoff ||
			handoff.popup.isDestroyed()
		)
			return;
		soundtrackPending = false;
		handoff.popup.webContents.send("onboarding-soundtrack-start");
	};
	const allowSoundtrack = () => {
		soundtrackCanStart = true;
		sendSoundtrackCue();
	};
	const closeBackdrop = () => {
		clearInterval(fadeTimer);
		if (!backdrop.isDestroyed()) backdrop.destroy();
	};
	const fade = (popup?: BrowserWindow) => {
		clearTimeout(deadline);
		const start = performance.now();
		const popupFade = popup ? POPUP_FADE_MS : 0;
		fadeTimer = setInterval(() => {
			const elapsed = performance.now() - start;
			if (popup) {
				const progress = Math.min(1, elapsed / popupFade);
				popup.setOpacity(1 - (1 - progress) ** 3);
				if (progress < 1) return;
			}
			const progress = Math.min(1, (elapsed - popupFade) / BACKDROP_FADE_MS);
			backdrop.setOpacity((1 - progress) ** 2);
			if (progress === 1) closeBackdrop();
		}, 16);
	};
	const handOff = () => {
		if (!handoff) return;
		const { popup, show } = handoff;
		if (startedHandoff || !popupReady || !introFinished || popup.isDestroyed()) return;
		startedHandoff = true;
		allowSoundtrack();
		const animateHandoff = !backdrop.isDestroyed() && backdrop.isVisible();
		if (animateHandoff) {
			fadingPopup = popup;
			popup.setOpacity(0);
			if (onMac) {
				popup.setAlwaysOnTop(true, "screen-saver", 1);
			}
		}
		show();
		releaseBanner?.();
		if (animateHandoff && !backdrop.isDestroyed()) fade(popup);
	};
	const finish = (animate: boolean) => {
		if (introFinished) return;
		introFinished = true;
		if (!animate) closeBackdrop();
		else if (!handoff) {
			if (backdrop.isVisible()) fade();
			else closeBackdrop();
		}
		handOff();
	};

	handoff?.popup.once("ready-to-show", () => {
		popupReady = true;
		handOff();
	});
	handoff?.popup.once("closed", closeBackdrop);
	handoff?.popup.webContents.once("render-process-gone", closeBackdrop);
	backdrop.once("closed", () => {
		clearTimeout(deadline);
		clearInterval(fadeTimer);
		if (fadingPopup && !fadingPopup.isDestroyed()) {
			fadingPopup.setOpacity(1);
			// Restore normal stacking only after the full-display blur is gone.
			if (onMac) fadingPopup.setAlwaysOnTop(false);
		}
		fadingPopup = undefined;
		finish(false);
	});
	backdrop.webContents.once("render-process-gone", () => finish(false));
	const onTimeout = () => {
		if (!startedHandoff) {
			closeBackdrop();
			finish(false);
		}
	};
	// The popup owns the audio so destroying the logo cannot interrupt the soundtrack.
	handoff?.popup.webContents.on("did-start-navigation", ({ isMainFrame, isSameDocument }) => {
		if (!isMainFrame || isSameDocument) return;
		popupNavigating = true;
	});
	handoff?.popup.webContents.on("did-navigate", () => {
		popupNavigating = false;
		soundtrackPending = false;
	});
	handoff?.popup.webContents.on("did-stop-loading", () => {
		if (!popupNavigating) return;
		// A canceled navigation keeps the current document and its pending cue.
		popupNavigating = false;
		sendSoundtrackCue();
	});
	handoff?.popup.webContents.ipc.on("onboarding-soundtrack-ready", (event) => {
		const { webContents } = handoff.popup;
		if (!event.senderFrame || event.senderFrame !== webContents.mainFrame) return;
		soundtrackPending = true;
		sendSoundtrackCue();
	});
	backdrop.webContents.ipc.on("onboarding-intro", (event, stage: unknown) => {
		if (introFinished || backdrop.isDestroyed()) return;
		if (event.senderFrame !== backdrop.webContents.mainFrame) return;
		if (stage === "ready" && !backdrop.isVisible()) {
			clearTimeout(deadline);
			deadline = setTimeout(onTimeout, INTRO_PLAYBACK_TIMEOUT_MS);
			backdrop.showInactive();
			backdrop.moveTop();
			allowSoundtrack();
			backdrop.webContents.send("onboarding-intro-shown");
		} else if (stage === "finished" || stage === "skipped") {
			finish(stage === "finished");
		}
	});

	deadline = setTimeout(onTimeout, INTRO_TIMEOUT_MS);
	load(backdrop);
	return backdrop;
}
