import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { formatCloudBytes, formatPrice } from "./formatBillingValues";

const active = vi.hoisted(() => ({ locale: "en", messages: {} as Record<string, string> }));
vi.mock("@/contexts/I18nContext", () => ({
	useI18n: () => ({ locale: active.locale }),
	useScopedT: () => (key: string, fallback?: string, vars?: Record<string, string | number>) => {
		const text = active.messages[key] ?? fallback ?? key;
		return vars ? text.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? "")) : text;
	},
}));
const billing = () => ({
	catalog: {
		prices: [
			{
				interval: "monthly",
				currency: "usd",
				unitAmount: 900,
				regularUnitAmount: 1500,
				promotion: "early_bird",
			},
		],
		limits: { plusMaxRecordingBytes: 10_000_000_000, plusWeeklyUploadLimit: 200 },
	},
	status: { billing: { plan: "free" } },
	openPricing: vi.fn(),
});
vi.mock("./BillingProvider", () => ({
	useBilling: () => billing(),
	useOptionalBilling: () => billing(),
}));
vi.mock("@/components/video-editor/cloud/endpoint", () => ({
	CLOUD_SHARE_ENDPOINT: "https://recordly.test",
}));
import { EarlyBirdTag } from "./EarlyBirdTag";
import { LegalLinks } from "./LegalLinks";
import { PlusFeatureDetails } from "./PlusFeatureDetails";
import { UpgradeButton } from "./UpgradeButton";
import { UpgradeTestimonials } from "./UpgradeTestimonials";

const normalizeSpaces = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

describe("billing locale formatting", () => {
	it("uses the selected language's decimal separator and unit label", () => {
		expect(normalizeSpaces(formatCloudBytes(1_500_000_000, "fr"))).toBe("1,5 Go");
		expect(normalizeSpaces(formatCloudBytes(1_500_000_000, "de"))).toBe("1,5 GB");
		expect(formatCloudBytes(1_500_000_000, "en")).toBe("1.5 GB");
		expect(normalizeSpaces(formatCloudBytes(1_500_000, "fr"))).toBe("1,5 Mo");
		expect(normalizeSpaces(formatCloudBytes(1500, "fr"))).toBe("1,5 ko");
	});
	it("preserves USD charges while displaying localized currency and decimal conventions", () => {
		const price = { interval: "monthly", currency: "usd", unitAmount: 950 } as const;
		expect(normalizeSpaces(formatPrice(price, "fr"))).toBe("9,50 $US");
		expect(normalizeSpaces(formatPrice(price, "en"))).toBe("$9.50");
		expect(formatPrice(price, "zh-TW")).toBe("US$9.50");
	});
});

describe.each(SUPPORTED_LOCALES)("billing UI in %s", (locale) => {
	it("renders translated legal consent with working links and no leaked placeholders", () => {
		active.locale = locale;
		active.messages = JSON.parse(
			readFileSync(
				new URL(`../../i18n/locales/${locale}/billing.json`, import.meta.url),
				"utf8",
			),
		);
		const markup = renderToStaticMarkup(<LegalLinks consent />);
		expect(markup).toContain('href="https://recordly.test/terms"');
		expect(markup).toContain('href="https://recordly.test/privacy"');
		expect(markup).not.toContain("{{");
		expect(markup).toContain(active.messages.terms);
		expect(markup).toContain(active.messages.privacyPolicy);
		if (locale !== "en") expect(markup).not.toContain("By continuing");
	});
	it("localizes benefit, promotion, upgrade and testimonial surrounding UI", () => {
		active.locale = locale;
		active.messages = JSON.parse(
			readFileSync(
				new URL(`../../i18n/locales/${locale}/billing.json`, import.meta.url),
				"utf8",
			),
		);
		const markup = renderToStaticMarkup(
			<>
				<EarlyBirdTag />
				<UpgradeButton />
				<PlusFeatureDetails />
				<UpgradeTestimonials />
			</>,
		);
		expect(markup).not.toContain("{{");
		expect(markup).toContain(active.messages.earlyBird.replace("{{percent}}", "40"));
		expect(markup).toContain(active.messages.upgradeShort);
		expect(markup).toContain(active.messages.featureCommercial);
		expect(markup).toContain(active.messages.featureCaptionFiles);
		expect(markup).not.toContain(active.messages.commercialRequirement);
		expect(markup).not.toContain("4K");
		expect(markup).toContain(active.messages.featureWeeklyUploads.replace("{{count}}", "200"));
		expect(markup).toContain(active.messages.benefitsPricing);
		expect(markup).toContain(active.messages.testimonials);
		if (locale !== "en") {
			expect(markup).not.toContain("Commercial use requires an active Recordly Cloud subscription.");
			expect(markup).not.toContain("Community testimonials");
		}
	});
});
