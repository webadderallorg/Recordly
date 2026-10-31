import type { BrowserWindow } from "electron";

type Result = { success: boolean; cancelled?: boolean; error?: string };
/** Every countdown exit settles the IPC request, including cancellation during window load. */
export function createCountdownController(
	createWindow: () => BrowserWindow,
	onRemaining: (seconds: number | null) => void,
) {
	let finishActive: ((result: Result) => void) | null = null;
	return {
		start(seconds: number): Promise<Result> {
			if (finishActive)
				return Promise.resolve({ success: false, error: "Countdown already in progress" });
			if (!Number.isFinite(seconds) || seconds < 0)
				return Promise.resolve({ success: false, error: "Invalid countdown delay" });
			return new Promise((resolve) => {
				let win: BrowserWindow | undefined;
				let timer: ReturnType<typeof setInterval> | undefined;
				let settled = false;
				let started = false;
				let remaining = Math.ceil(seconds);
				const finish = (result: Result) => {
					if (settled) return;
					settled = true;
					if (timer) clearInterval(timer);
					finishActive = null;
					onRemaining(null);
					if (win) {
						win.removeListener("closed", cancel);
						win.webContents.removeListener("did-finish-load", begin);
						win.webContents.removeListener("did-fail-load", fail);
						win.webContents.removeListener("render-process-gone", cancel);
					}
					resolve(result);
					if (win && !win.isDestroyed()) win.close();
				};
				const cancel = () => finish({ success: false, cancelled: true });
				const fail = () =>
					finish({ success: false, error: "Countdown window failed to load" });
				const tick = () => {
					if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
						cancel();
						return;
					}
					onRemaining(remaining);
					win.webContents.send("countdown-tick", remaining);
				};
				const begin = () => {
					if (settled || started) return;
					started = true;
					if (remaining === 0) {
						finish({ success: true });
						return;
					}
					tick();
					if (settled) return;
					timer = setInterval(() => {
						remaining--;
						if (remaining <= 0) finish({ success: true });
						else tick();
					}, 1000);
				};
				finishActive = finish;
				onRemaining(remaining);
				try {
					win = createWindow();
					win.once("closed", cancel);
					win.webContents.once("did-fail-load", fail);
					win.webContents.once("render-process-gone", cancel);
					if (win.webContents.isLoadingMainFrame())
						win.webContents.once("did-finish-load", begin);
					else begin();
				} catch (error) {
					finish({ success: false, error: String(error) });
				}
			});
		},
		cancel() {
			finishActive?.({ success: false, cancelled: true });
			return { success: true };
		},
	};
}
