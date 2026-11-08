import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, type IpcMainInvokeEvent } from "electron";
import { getPackagedRendererBaseUrl } from "./rendererServer";

/** Privileged IPC belongs to the app document, never embedded or foreign frames. */
export function isTrustedRendererDocument(value: string): boolean {
	try {
		const candidate = new URL(value);
		if (candidate.username || candidate.password) return false;
		const trusted = [
			process.env.VITE_DEV_SERVER_URL,
			getPackagedRendererBaseUrl(),
			pathToFileURL(path.join(process.env.APP_ROOT || app.getAppPath(), "dist", "index.html"))
				.href,
		];
		return trusted.some((value) => {
			if (!value) return false;
			const base = new URL(value);
			return (
				candidate.protocol === base.protocol &&
				candidate.host === base.host &&
				candidate.pathname === base.pathname
			);
		});
	} catch {
		return false;
	}
}

export function isTrustedRenderer(event: IpcMainInvokeEvent): boolean {
	return Boolean(
		event.senderFrame &&
			event.senderFrame === event.sender.mainFrame &&
			isTrustedRendererDocument(event.senderFrame.url),
	);
}
