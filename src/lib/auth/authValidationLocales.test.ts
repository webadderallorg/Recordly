import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { requestAccountEmailChange, updateAccountName } from "./recordlyAuth";
import { marketingEmailMetadata, signupConsentMetadata } from "./signupConsent";

const catalogs = import.meta.glob<{ default: Record<string, string> }>(
	"../../i18n/locales/*/support.json",
	{ eager: true },
);
afterEach(() => vi.unstubAllGlobals());

describe.each(SUPPORTED_LOCALES)("account validation in %s", (locale) => {
	it("uses the selected language for local name, email and consent errors", async () => {
		vi.stubGlobal("window", { localStorage: { getItem: () => locale } });
		const catalog = catalogs[`../../i18n/locales/${locale}/support.json`].default;
		await expect(updateAccountName("")).rejects.toThrow(catalog.nameInvalid);
		await expect(updateAccountName("x".repeat(81))).rejects.toThrow(catalog.nameInvalid);
		await expect(requestAccountEmailChange("invalid")).rejects.toThrow(catalog.emailInvalid);
		expect(() => signupConsentMetadata({ legalAccepted: false })).toThrow(
			catalog.legalRequired,
		);
		expect(() => marketingEmailMetadata(undefined as unknown as boolean)).toThrow(
			catalog.emailPreferenceRequired,
		);
	});
});
