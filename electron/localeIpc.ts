import type { IpcMainInvokeEvent } from "electron";
import { type AppLocale, SUPPORTED_LOCALES } from "../src/i18n/config";

/** Only a supported locale from one of the app's own top-level documents may change native UI. */
export function validateAppLocaleRequest(
	event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">,
	value: unknown,
	trustedBaseUrls: readonly string[],
): value is AppLocale {
	if (typeof value !== "string" || !SUPPORTED_LOCALES.some((locale) => locale === value))
		return false;
	if (
		!event.senderFrame ||
		event.senderFrame !== event.sender.mainFrame ||
		event.sender.isDestroyed()
	)
		return false;
	try {
		const candidate = new URL(event.senderFrame.url);
		if (candidate.username || candidate.password) return false;
		return trustedBaseUrls.some((base) => {
			const trusted = new URL(base);
			return (
				["http:", "https:", "file:"].includes(trusted.protocol) &&
				candidate.protocol === trusted.protocol &&
				candidate.host === trusted.host &&
				candidate.pathname === trusted.pathname
			);
		});
	} catch {
		return false;
	}
}
