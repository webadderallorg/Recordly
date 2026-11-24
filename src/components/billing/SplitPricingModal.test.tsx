import { isValidElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ billing: {} as Record<string, unknown>, refresh: vi.fn(), startBilling: vi.fn(), setPricingOpen: vi.fn() }));
vi.mock("./BillingProvider", () => ({ useBilling: () => state.billing }));
vi.mock("@/contexts/I18nContext", () => ({
	useI18n: () => ({ locale: "en", t: (_key: string, fallback: string) => fallback }),
	useScopedT: () => (_key: string, fallback: string) => fallback,
}));
import { SplitPricingModal } from "./SplitPricingModal";

const price = { interval: "monthly", currency: "usd", unitAmount: 900 };
type PrimaryAction = { children: string; isDisabled: boolean; onPress: () => void };
function primary(node: ReactNode): PrimaryAction | undefined {
	if (Array.isArray(node)) return node.map(primary).find(Boolean);
	if (!isValidElement<{ children?: ReactNode; className?: string; onPress?: () => void }>(node)) return undefined;
	if (node.props.className === "split-upgrade-cta") return node.props as PrimaryAction;
	return primary(node.props.children);
}
beforeEach(() => {
	vi.clearAllMocks();
	state.billing = {
		status: { billing: { plan: "free", checkoutAvailable: false, checkoutIntervals: [], portalAvailable: false, prices: [] } },
		catalog: null, catalogLoading: false, pricingOpen: true, setPricingOpen: state.setPricingOpen,
		user: { id: "fixture-user" }, loading: false, busy: undefined, needsSignIn: false,
		refresh: state.refresh, startBilling: state.startBilling, awaitingCheckout: false,
	};
});
function billing(fields: Record<string, unknown>) { state.billing.status = { billing: { plan: "free", checkoutAvailable: false, checkoutIntervals: [], portalAvailable: false, prices: [], ...fields } }; }
function button(onSignIn = vi.fn()) { const result = primary(SplitPricingModal({ onSignIn })); expect(result).toBeDefined(); return result!; }
it("labels unavailable pricing as a retry and refreshes instead of starting billing", () => {
	const action = button(); expect(action.children).toBe("Retry loading pricing"); action.onPress(); expect(state.refresh).toHaveBeenCalledOnce(); expect(state.startBilling).not.toHaveBeenCalled();
});
it("refreshes an active plan when subscription management is unavailable", () => {
	billing({ plan: "pro", currentPeriodEnd: 123 }); const action = button(); expect(action.children).toBe("Refresh plan"); action.onPress(); expect(state.refresh).toHaveBeenCalledOnce(); expect(state.startBilling).not.toHaveBeenCalled();
});
it("keeps the pending-payment refresh label", () => {
	state.billing.awaitingCheckout = true; const action = button(); expect(action.children).toBe("Check payment status"); action.onPress(); expect(state.refresh).toHaveBeenCalledOnce();
});
it("keeps verified checkout on Get Started", () => {
	billing({ checkoutAvailable: true, checkoutIntervals: ["monthly"], prices: [price] }); state.billing.catalog = { prices: [price] }; const action = button(); expect(action.children).toBe("Get Started"); action.onPress(); expect(state.startBilling).toHaveBeenCalledWith("checkout", "monthly"); expect(state.refresh).not.toHaveBeenCalled();
});
it.each(["loading", "catalogLoading"])("keeps verified checkout usable during %s", (pending) => {
	billing({ checkoutAvailable: true, checkoutIntervals: ["monthly"], prices: [price] });
	state.billing.catalog = { prices: [price] };
	state.billing[pending] = true;
	const tree = SplitPricingModal({ onSignIn: vi.fn() });
	const action = primary(tree);
	expect(action).toMatchObject({ children: "Get Started", isDisabled: false });
	expect(notices(tree)).toEqual([]);
	action?.onPress();
	expect(state.startBilling).toHaveBeenCalledWith("checkout", "monthly");
});
it("keeps available subscription management on the portal action", () => {
	billing({ plan: "pro", portalAvailable: true }); const action = button(); expect(action.children).toBe("Manage subscription"); action.onPress(); expect(state.startBilling).toHaveBeenCalledWith("portal", "monthly");
});
it("keeps sign-in ahead of retry for signed-out users", () => {
	state.billing.user = null; const signIn = vi.fn(), action = button(signIn); expect(action.children).toBe("Get Started"); action.onPress(); expect(signIn).toHaveBeenCalledOnce(); expect(state.refresh).not.toHaveBeenCalled();
});
function notices(node: ReactNode): string[] {
	if (Array.isArray(node)) return node.flatMap(notices);
	if (!isValidElement<{ children?: ReactNode; className?: string }>(node)) return [];
	const { className, children } = node.props;
	if (className === "pricing-feedback" || className === "pricing-error") return [String(Array.isArray(children) ? children[0] : children)];
	return notices(children);
}
it("shows one payment notice, not a stale checkout prompt, after an unfinished checkout", () => {
	billing({ subscriptionStatus: "incomplete", portalAvailable: true });
	state.billing.awaitingCheckout = true;
	const tree = SplitPricingModal({ onSignIn: vi.fn() });
	expect(notices(tree)).toEqual(["Your payment didn’t go through. Update your payment method to start Plus."]);
	expect(primary(tree)?.children).toBe("Manage subscription");
});
it("shows the billing error instead of a status notice", () => {
	billing({ subscriptionStatus: "incomplete", portalAvailable: true });
	state.billing.error = "Could not reach cloud billing.";
	expect(notices(SplitPricingModal({ onSignIn: vi.fn() }))).toHaveLength(1);
	expect(notices(SplitPricingModal({ onSignIn: vi.fn() }))[0]).toContain("couldn’t connect");
});
