import { isValidElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	billing: {} as Record<string, unknown>,
	refresh: vi.fn(),
	startBilling: vi.fn(),
	setPricingOpen: vi.fn(),
}));
vi.mock("./BillingProvider", () => ({ useBilling: () => state.billing }));
vi.mock("@/contexts/I18nContext", () => ({
	useI18n: () => ({ locale: "en", t: (_key: string, fallback: string) => fallback }),
	useScopedT: () => (_key: string, fallback: string) => fallback,
}));
import { SplitPricingModal } from "./SplitPricingModal";

const price = { interval: "monthly", currency: "usd", unitAmount: 900 };
function primary(node: ReactNode): { children: string; onPress: () => void } | undefined {
	if (Array.isArray(node)) return node.map(primary).find(Boolean);
	if (!isValidElement<{ children?: ReactNode; className?: string; onPress?: () => void }>(node))
		return undefined;
	if (node.props.className === "split-upgrade-cta")
		return node.props as { children: string; onPress: () => void };
	return primary(node.props.children);
}
beforeEach(() => {
	vi.clearAllMocks();
	state.billing = {
		status: {
			billing: {
				plan: "free",
				checkoutAvailable: false,
				checkoutIntervals: [],
				portalAvailable: false,
				prices: [],
			},
		},
		catalog: null,
		catalogLoading: false,
		pricingOpen: true,
		setPricingOpen: state.setPricingOpen,
		user: { id: "fixture-user" },
		loading: false,
		busy: undefined,
		needsSignIn: false,
		refresh: state.refresh,
		startBilling: state.startBilling,
		awaitingCheckout: false,
	};
});
function billing(fields: Record<string, unknown>) {
	state.billing.status = {
		billing: {
			plan: "free",
			checkoutAvailable: false,
			checkoutIntervals: [],
			portalAvailable: false,
			prices: [],
			...fields,
		},
	};
}
function button(onSignIn = vi.fn()) {
	const result = primary(SplitPricingModal({ onSignIn }));
	expect(result).toBeDefined();
	return result!;
}
it("labels unavailable pricing as a retry and refreshes instead of starting billing", () => {
	const action = button();
	expect(action.children).toBe("Retry loading pricing");
	action.onPress();
	expect(state.refresh).toHaveBeenCalledOnce();
	expect(state.startBilling).not.toHaveBeenCalled();
});
it("offers retry when an active plan has no usable portal", () => {
	billing({ plan: "pro", currentPeriodEnd: 123 });
	const action = button();
	expect(action.children).toBe("Retry loading pricing");
	action.onPress();
	expect(state.refresh).toHaveBeenCalledOnce();
});
it("keeps the pending-payment refresh label", () => {
	state.billing.awaitingCheckout = true;
	const action = button();
	expect(action.children).toBe("Check payment status");
	action.onPress();
	expect(state.refresh).toHaveBeenCalledOnce();
});
it("keeps verified checkout on Get started", () => {
	billing({ checkoutAvailable: true, checkoutIntervals: ["monthly"], prices: [price] });
	state.billing.catalog = { prices: [price] };
	const action = button();
	expect(action.children).toBe("Get started");
	action.onPress();
	expect(state.startBilling).toHaveBeenCalledWith("checkout", "monthly");
	expect(state.refresh).not.toHaveBeenCalled();
});
it("keeps available subscription management on the portal action", () => {
	billing({ plan: "pro", portalAvailable: true });
	const action = button();
	expect(action.children).toBe("Manage subscription");
	action.onPress();
	expect(state.startBilling).toHaveBeenCalledWith("portal", "monthly");
});
it("keeps sign-in ahead of retry for signed-out users", () => {
	state.billing.user = null;
	const signIn = vi.fn(),
		action = button(signIn);
	expect(action.children).toBe("Sign in to continue");
	action.onPress();
	expect(signIn).toHaveBeenCalledOnce();
	expect(state.refresh).not.toHaveBeenCalled();
});
