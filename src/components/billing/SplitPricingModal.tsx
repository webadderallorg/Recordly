import { Button, Modal } from "@heroui/react";
import { Check } from "@phosphor-icons/react";
import { OnboardingHeader, OnboardingLayout } from "@/components/auth/OnboardingLayout";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { RecordlyMark } from "@/components/ui/RecordlyMark";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import type { CloudBillingPrice } from "@/types/cloudBilling";
import { useBilling } from "./BillingProvider";
import { formatPrice } from "./formatBillingValues";
import { PaymentMethods } from "./PaymentMethods";
import { getDiscountPercent, getPlusPrice, hasVerifiedCheckoutPrice } from "./pricingOffer";
import "./Billing.css";
import "./SplitPricingModal.css";

/** Stripe states where a started subscription is waiting on a working payment method. */
const PAYMENT_FAILED_STATUSES = new Set(["incomplete", "past_due", "unpaid"]);

function MonthlyPrice({ price }: { price: CloudBillingPrice }) {
	const t = useScopedT("billing");
	const { locale } = useI18n();
	const discount = getDiscountPercent(price);
	const { regularUnitAmount } = price;
	return (
		<div className="pricing-price-offer split-upgrade-price">
			<p className="split-upgrade-price-line">
				{discount !== null && regularUnitAmount !== undefined && (
					<>
						<span className="sr-only">
							{t("regularPrice", "Regular price {{price}} USD per month", {
								price: (regularUnitAmount / 100).toLocaleString(locale, {
									maximumFractionDigits: 2,
								}),
							})}
						</span>
						<s className="pricing-regular-price" aria-hidden="true">
							{formatPrice({ ...price, unitAmount: regularUnitAmount }, locale)}
						</s>{" "}
					</>
				)}
				<span className="pricing-price">{formatPrice(price, locale)}</span>{" "}
				<span className="split-upgrade-price-period">{t("perMonth", "per month")}</span>
			</p>
			{discount !== null && (
				<p className="split-upgrade-savings">
					{price.promotion === "early_bird"
						? t("earlyBirdSavings", "{{percent}}% off with early bird pricing", {
								percent: discount,
							})
						: t("discount", "{{percent}}% off", { percent: discount })}
				</p>
			)}
		</div>
	);
}

/** Plus upgrade using Recordly styling and the verified billing catalog. */
export function SplitPricingModal({ onSignIn }: { onSignIn: () => void }) {
	const t = useScopedT("billing");
	const { locale, t: appT } = useI18n();
	const {
		status,
		catalog,
		catalogLoading,
		pricingOpen,
		setPricingOpen,
		user,
		loading,
		error,
		needsSignIn,
		refresh,
		busy,
		startBilling,
		awaitingCheckout,
	} = useBilling();
	// Preserve the existing monthly-only checkout policy.
	const interval = "monthly";
	const price = getPlusPrice(catalog, interval);
	const plus = status?.billing.plan === "pro";
	const checkoutReady = Boolean(
		!plus &&
			status?.billing.checkoutAvailable &&
			status.billing.checkoutIntervals.includes(interval) &&
			hasVerifiedCheckoutPrice(catalog, status.billing, interval),
	);
	const portalAvailable = Boolean(status?.billing.portalAvailable);
	const manageSubscription = portalAvailable && (plus || !checkoutReady);
	const paymentPending = !plus && awaitingCheckout && !manageSubscription;
	const pricingLoading =
		!manageSubscription && (!checkoutReady || paymentPending) && (loading || catalogLoading);
	const checkingPricing = Boolean(user && !needsSignIn && pricingLoading);
	const retryPricing = !(manageSubscription || checkoutReady) || paymentPending;
	const showSubscriptionPricing = !plus && !manageSubscription;
	const currentPeriodEnd = status?.billing.currentPeriodEnd;
	const startLabel = t("start", "Get Started");
	const showError = Boolean(user && !loading && !needsSignIn && error);
	const paymentFailed = PAYMENT_FAILED_STATUSES.has(status?.billing.subscriptionStatus ?? "");
	// One status line at most: stacked notices read as noise next to a single action.
	const notice = plus
		? [
				t("active", "Your Plus plan is active."),
				status.billing.cancelAtPeriodEnd && currentPeriodEnd
					? t("ends", "It ends on {{date}}.", {
							date: new Date(currentPeriodEnd * 1000).toLocaleDateString(locale),
						})
					: "",
				t(
					"noExpiry",
					"Cloud recordings have no expiry while Plus is active. They expire 7 days after Plus ends.",
				),
				portalAvailable
					? t(
							"portal",
							"Manage your payment details or cancel in the secure billing portal.",
						)
					: "",
			]
				.filter(Boolean)
				.join(" ")
		: manageSubscription
			? paymentFailed
				? t(
						"paymentFailed",
						"Your payment didn’t go through. Update your payment method to start Plus.",
					)
				: t(
						"attention",
						"Your subscription needs attention. Open Manage subscription to review your payment details, invoices or cancellation options.",
					)
			: paymentPending
				? t(
						"checkout",
						"Complete checkout in your browser, then return here. Your plan will update after payment is confirmed.",
					)
				: checkingPricing && !busy
					? t("loadingPricing", "Loading pricing…")
					: null;
	const actionLabel =
		!user || needsSignIn
			? startLabel
			: paymentPending
				? t("checkPayment", "Check payment status")
				: manageSubscription
					? t("manage", "Manage subscription")
					: plus
						? t("refreshPlan", "Refresh plan")
						: checkoutReady || checkingPricing
							? startLabel
							: t("retryPricing", "Retry loading pricing");
	const pending = Boolean(busy) || checkingPricing;
	const [headingBefore, headingAfter] = (
		showSubscriptionPricing ? t("upgradeHeading", "Upgrade to {{plus}}") : "{{plus}}"
	).split("{{plus}}");
	const benefits = [
		t("outcomeLicenseTitle", "Use Recordly for commercial projects"),
		t("outcomeLinksTitle", "Share freely with unlimited links"),
		t("outcomeStorageTitle", "Store everything on the cloud"),
		t("outcomePlaybackTitle", "Play cloud videos in clear FHD"),
	];

	return (
		<Modal isOpen={pricingOpen} onOpenChange={setPricingOpen}>
			<Modal.Backdrop variant="blur" className="split-upgrade-backdrop">
				<Modal.Container size="lg" scroll="inside">
					<Modal.Dialog aria-label="Recordly Plus" className="split-upgrade-modal">
						<Modal.CloseTrigger
							className="split-upgrade-close"
							aria-label={appT("common.actions.close", "Close")}
						/>
						<Modal.Body className="split-upgrade-body">
							<OnboardingLayout
								stage="account"
								canViewPermissions={false}
								showNavigation={false}
							>
								<div className="split-upgrade-copy">
									<div className="split-upgrade-header">
										<OnboardingHeader
											centered
											title={
												<span className="recordly-signin-hero">
													{headingBefore}
													<span className="split-upgrade-brand">
														<RecordlyMark className="split-upgrade-mark" />{" "}
														Plus
													</span>
													{headingAfter}
												</span>
											}
										/>
									</div>
									<div className="split-upgrade-details">
										{showSubscriptionPricing && price && (
											<MonthlyPrice price={price} />
										)}
										<ul
											className="split-upgrade-benefits"
											aria-label={t("yourBenefits", "Your Plus benefits")}
										>
											{benefits.map((benefit) => (
												<li key={benefit}>
													<span className="split-upgrade-check">
														<Check
															weight="bold"
															size={12}
															aria-hidden="true"
														/>
													</span>
													{benefit}
												</li>
											))}
										</ul>
										<div className="split-upgrade-purchase">
											{showError && error && (
												<p className="pricing-error" role="alert">
													{t(
														"connectionError",
														"We couldn’t connect to secure billing. Try again or refresh your plan, or contact support if the problem continues.",
													)}
													<ErrorReportButton
														error={error}
														context="billing"
													/>
												</p>
											)}
											{!showError && notice && (
												<p className="pricing-feedback" role="status">
													{notice}
												</p>
											)}
											<div className="split-upgrade-actions">
												{(showSubscriptionPricing ||
													currentPeriodEnd != null ||
													portalAvailable) && (
													<Button
														variant="primary"
														size="lg"
														className="split-upgrade-cta"
														aria-label={actionLabel}
														isPending={Boolean(busy)}
														isDisabled={pending}
														onPress={() => {
															if (!user || needsSignIn) {
																setPricingOpen(false);
																onSignIn();
															} else if (retryPricing) void refresh();
															else
																void startBilling(
																	manageSubscription
																		? "portal"
																		: "checkout",
																	interval,
																);
														}}
													>
														{actionLabel}
													</Button>
												)}
											</div>
											{showSubscriptionPricing && <PaymentMethods />}
											{paymentPending && checkoutReady && (
												<Button
													variant="ghost"
													isDisabled={pending}
													onPress={() =>
														void startBilling("checkout", interval)
													}
												>
													{t("returnToCheckout", "Return to checkout")}
												</Button>
											)}
										</div>
									</div>
								</div>
							</OnboardingLayout>
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
