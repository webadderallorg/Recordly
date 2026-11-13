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
		...(process.platform === "darwin"
			? { vibrancy: "fullscreen-ui", visualEffectState: "active", type: "panel" }
			: { backgroundMaterial: "acrylic" }),
		webPreferences: { preload, backgroundThrottling: false },
	});
	backdrop.setIgnoreMouseEvents(true);
	backdrop.setBounds(bounds);

	let popupReady = false;
	let introFinished = false;
	let startedHandoff = false;
	let deadline: NodeJS.Timeout;
	let fadeTimer: NodeJS.Timeout | undefined;
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
		if (!backdrop.isDestroyed() && backdrop.isVisible()) {
			popup.setOpacity(0);
			show();
			fade(popup);
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
		finish(false);
	});
	backdrop.webContents.once("render-process-gone", () => finish(false));
	const onTimeout = () => {
		if (!startedHandoff) {
			closeBackdrop();
			finish(false);
		}
	};
	backdrop.webContents.ipc.on("onboarding-intro", (event, stage: unknown) => {
		if (introFinished || backdrop.isDestroyed()) return;
		if (event.senderFrame !== backdrop.webContents.mainFrame) return;
		if (stage === "ready" && !backdrop.isVisible()) {
			clearTimeout(deadline);
			deadline = setTimeout(onTimeout, INTRO_PLAYBACK_TIMEOUT_MS);
			backdrop.showInactive();
			backdrop.moveTop();
			backdrop.webContents.send("onboarding-intro-shown");
		} else if (stage === "finished" || stage === "skipped") {
			finish(stage === "finished");
		}
	});

	deadline = setTimeout(onTimeout, INTRO_TIMEOUT_MS);
	load(backdrop);
	return backdrop;
}
