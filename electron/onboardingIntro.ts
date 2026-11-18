import { BrowserWindow, type Rectangle } from "electron";

const INTRO_TIMEOUT_MS = 6000;
const INTRO_PLAYBACK_TIMEOUT_MS = 10000;
const POPUP_FADE_MS = 280;
const BACKDROP_FADE_MS = 360;

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
	let logoReady = false;
	let soundtrackReady = !handoff;
	let soundtrackStarted = false;
	let introFinished = false;
	let startedHandoff = false;
	let deadline: NodeJS.Timeout;
	let fadeTimer: NodeJS.Timeout | undefined;
	let fadingPopup: BrowserWindow | undefined;
	const startSoundtrack = () => {
		if (soundtrackStarted || !handoff || handoff.popup.isDestroyed()) return;
		soundtrackStarted = true;
		if (soundtrackReady) handoff.popup.webContents.send("onboarding-soundtrack-start");
	};
	const closeBackdrop = () => {
		clearInterval(fadeTimer);
		if (!backdrop.isDestroyed()) backdrop.destroy();
	};
	const fade = (popup?: BrowserWindow) => {
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
		startSoundtrack();
		if (!backdrop.isDestroyed() && backdrop.isVisible()) {
			fadingPopup = popup;
			popup.setOpacity(0);
			if (onMac) {
				popup.setAlwaysOnTop(true, "screen-saver", 1);
			}
			show();
			if (!backdrop.isDestroyed()) fade(popup);
		} else {
			show();
		}
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
	const showLogo = () => {
		if (!logoReady || !soundtrackReady || introFinished || backdrop.isVisible()) return;
		clearTimeout(deadline);
		deadline = setTimeout(onTimeout, INTRO_PLAYBACK_TIMEOUT_MS);
		backdrop.showInactive();
		backdrop.moveTop();
		startSoundtrack();
		backdrop.webContents.send("onboarding-intro-shown");
	};
	// The popup owns the audio so destroying the logo cannot interrupt the soundtrack.
	handoff?.popup.webContents.ipc.on("onboarding-soundtrack-ready", (event) => {
		const { webContents } = handoff.popup;
		if (!event.senderFrame || event.senderFrame !== webContents.mainFrame) return;
		soundtrackReady = true;
		if (soundtrackStarted) webContents.send("onboarding-soundtrack-start");
		else showLogo();
	});
	backdrop.webContents.ipc.on("onboarding-intro", (event, stage: unknown) => {
		if (introFinished || backdrop.isDestroyed()) return;
		if (event.senderFrame !== backdrop.webContents.mainFrame) return;
		if (stage === "ready") {
			logoReady = true;
			showLogo();
		} else if (stage === "finished" || stage === "skipped") {
			finish(stage === "finished");
		}
	});

	deadline = setTimeout(onTimeout, INTRO_TIMEOUT_MS);
	load(backdrop);
	return backdrop;
}
