import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { UpdateToastWindow, type UpdateToastPayload } from "./UpdateToastWindow";

const catalogs = import.meta.glob<{ default: Record<string, string> }>(
	"../../i18n/locales/*/capture.json",
	{ eager: true },
);

afterEach(() => vi.unstubAllGlobals());

function render(locale: string, phase: UpdateToastPayload["phase"], isPreview = false) {
	vi.stubGlobal("window", { localStorage: { getItem: () => locale } });
	return renderToStaticMarkup(
		<I18nProvider>
			<UpdateToastWindow
				payload={{
					version: "1.2.3",
					detail: "RAW BACKEND ENGLISH",
					phase,
					delayMs: 1000,
					isPreview,
					progressPercent: 40,
					transferredBytes: 1572864,
					totalBytes: 4194304,
					bytesPerSecond: 524288,
				}}
			/>
		</I18nProvider>,
	);
}

describe.each(SUPPORTED_LOCALES)("update toast in %s", (locale) => {
	const catalog = catalogs[`../../i18n/locales/${locale}/capture.json`].default;
	it.each([
		["available", "updateAvailableDetail"],
		["downloading", "updateDownloadingDetail"],
		["ready", "updateReadyDetail"],
		["error", "updateErrorDetail"],
	] as const)("translates the %s state and accessible labels", (phase, key) => {
		const html = render(locale, phase);
		expect(html).toContain(catalog[key]);
		expect(html).toContain(`aria-label="${catalog.updateLabel}"`);
		expect(html).not.toContain("RAW BACKEND ENGLISH");
		if (phase === "downloading") {
			expect(html).toContain(`aria-label="${catalog.downloadingUpdate}"`);
			expect(html).toContain(new Intl.NumberFormat(locale, { style: "percent" }).format(0.4));
		}
	});
	it("keeps the preview notice localized", () => {
		expect(render(locale, "ready", true)).toContain(catalog.updatePreviewDetail);
	});
});
