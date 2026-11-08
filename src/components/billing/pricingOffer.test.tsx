import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCloudBillingCatalog, type CloudBillingPrice } from "@/types/cloudBilling";
import { getDiscountPercent, getPlusPrice, hasVerifiedCheckoutPrice } from "./pricingOffer";

const state = vi.hoisted(() => ({ prices: [] as CloudBillingPrice[] }));
vi.mock("./BillingProvider", () => ({
	useBilling: () => ({ catalog: { prices: state.prices }, openPricing: vi.fn() }),
	useOptionalBilling: () => ({ catalog: { prices: state.prices } }),
}));
vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: () => (_key: string, fallback: string, vars?: Record<string, number>) =>
		fallback.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars?.[key] ?? "")),
}));
import { EarlyBirdTag } from "./EarlyBirdTag";
import { UpgradeButton } from "./UpgradeButton";

const price: CloudBillingPrice = {
	interval: "monthly",
	currency: "usd",
	unitAmount: 1200,
	regularUnitAmount: 2000,
	promotion: "early_bird",
};
const parse = (prices: unknown[], plusWeeklyUploadLimit?: unknown) =>
	parseCloudBillingCatalog({
		success: true,
		prices,
		limits: {
			freeRecordingLimit: 5,
			freeMaxRecordingBytes: 1e9,
			plusMaxRecordingBytes: 1e10,
			plusWeeklyUploadLimit,
			storageLimitBytes: null,
		},
	});

beforeEach(() => {
	state.prices = [];
});

describe("catalog-driven pricing and promotions", () => {
	it("preserves verified promotional fields across IPC and renderer parsing", () => {
		const catalog = parse([price]);
		expect(getPlusPrice(catalog)).toEqual(price);
		expect(getPlusPrice(parse(catalog.prices))).toEqual(price);
	});
	it("uses changed catalog amounts and calculates conservative discounts", () => {
		expect(getPlusPrice({ prices: [price] })?.unitAmount).toBe(1200);
		expect(getDiscountPercent(price)).toBe(40);
		expect(getDiscountPercent({ ...price, unitAmount: 1400 })).toBe(30);
		expect(getDiscountPercent({ ...price, unitAmount: 1333 })).toBe(33);
		expect(getPlusPrice(null)).toBeNull();
	});
	it.each([
		0,
		1200,
		1100,
		1500.5,
		"2000",
		null,
	])("rejects invalid regular amount %s", (regularUnitAmount) => {
		expect(() => parse([{ ...price, regularUnitAmount }])).toThrow(/promotion/);
	});
	it("rejects an early bird claim without a valid reference price", () => {
		expect(() => parse([{ ...price, regularUnitAmount: undefined }])).toThrow(/promotion/);
	});
	it("does not invent prices or offers when catalog data is missing", () => {
		expect(renderToStaticMarkup(<EarlyBirdTag />)).toBe("");
		const markup = renderToStaticMarkup(<UpgradeButton />);
		expect(markup).toContain("Upgrade to Cloud");
		expect(markup).not.toContain("% off");
	});
	it("updates both badges with the calculated discount", () => {
		state.prices = [{ ...price, unitAmount: 1400 }];
		expect(renderToStaticMarkup(<EarlyBirdTag />)).toContain("EARLY BIRD 30% OFF");
		expect(renderToStaticMarkup(<UpgradeButton />)).toContain("30% off");
	});
	it("distinguishes a generic discount from an early bird offer", () => {
		state.prices = [{ ...price, promotion: undefined }];
		expect(renderToStaticMarkup(<EarlyBirdTag />)).toBe("");
		expect(renderToStaticMarkup(<UpgradeButton />)).toContain("40% off");
		state.prices = [{ interval: "monthly", currency: "usd", unitAmount: 2000 }];
		expect(renderToStaticMarkup(<EarlyBirdTag />)).toBe("");
		expect(renderToStaticMarkup(<UpgradeButton />)).not.toContain("% off");
	});
});

describe("checkout price verification", () => {
	it("requires matching public and account pricing", () => {
		expect(hasVerifiedCheckoutPrice({ prices: [price] }, { prices: [price] })).toBe(true);
		expect(
			hasVerifiedCheckoutPrice(
				{ prices: [price] },
				{ prices: [{ ...price, unitAmount: 1500 }] },
			),
		).toBe(false);
		expect(hasVerifiedCheckoutPrice(null, { prices: [price] })).toBe(false);
		expect(hasVerifiedCheckoutPrice({ prices: [price] }, undefined)).toBe(false);
		expect(hasVerifiedCheckoutPrice({ prices: [price] }, { prices: [] })).toBe(false);
	});
});

describe("weekly upload allowance", () => {
	it("preserves the server limit and supports older catalogs", () => {
		expect(parse([], 200).limits.plusWeeklyUploadLimit).toBe(200);
		expect(parse([]).limits).not.toHaveProperty("plusWeeklyUploadLimit");
	});
	it.each([
		0,
		-1,
		1.5,
		"200",
		null,
		Number.MAX_SAFE_INTEGER + 1,
	])("rejects invalid allowance %s", (value) => {
		expect(() => parse([], value)).toThrow(/plan limits/);
	});
});
