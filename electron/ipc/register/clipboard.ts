import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, clipboard, ipcMain } from "electron";
import { getPackagedRendererBaseUrl } from "../../rendererServer";

export function registerClipboardHandlers() {
	ipcMain.handle("clipboard:writeText", (event, text: unknown) => {
		const frame = event.senderFrame;
		if (!frame || frame !== event.sender.mainFrame) return { success: false };
		try {
			const candidate = new URL(frame.url);
			const trusted = [
				process.env.VITE_DEV_SERVER_URL,
				getPackagedRendererBaseUrl(),
				pathToFileURL(
					path.join(process.env.APP_ROOT || app.getAppPath(), "dist", "index.html"),
				).href,
			].filter((value): value is string => Boolean(value));
			if (
				candidate.username ||
				candidate.password ||
				!trusted.some((value) => {
					const base = new URL(value);
					return candidate.origin === base.origin && candidate.pathname === base.pathname;
				}) ||
				typeof text !== "string" ||
				text.length > 1024 * 1024
			)
				return { success: false };
			clipboard.writeText(text);
			return { success: true };
		} catch {
			return { success: false };
		}
	});
}
