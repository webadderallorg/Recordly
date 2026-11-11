import { Button, Label, Modal, Radio, RadioGroup } from "@heroui/react";
import { Check } from "@phosphor-icons/react";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import {
	OnboardingHeader,
	OnboardingHeroTitle,
	OnboardingLayout,
} from "@/components/auth/OnboardingLayout";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import type { CloudBillingPrice } from "@/types/cloudBilling";
import { useBilling } from "./BillingProvider";
import { formatPrice } from "./formatBillingValues";
import { PaymentMethods } from "./PaymentMethods";
import { getDiscountPercent, getPlusPrice, hasVerifiedCheckoutPrice } from "./pricingOffer";
import "./Billing.css";
import "./SplitPricingModal.css";

function MonthlyPlanOption({ price, disabled }: { price: CloudBillingPrice; disabled: boolean }) {
	const t = useScopedT("billing");
	const { locale } = useI18n();
	const discount = getDiscountPercent(price);
	return (
		<RadioGroup
			aria-label={t("accountPlan", "Plan & billing")}
			value="monthly"
			isDisabled={disabled}
			className="split-upgrade-plans"
		>
			<Radio value="monthly" className="split-upgrade-plan">
				<Radio.Content>
					<Radio.Control>
						<Radio.Indicator />
					</Radio.Control>
					<div className="split-upgrade-plan-name">
						<Label>{t("monthly", "Monthly")}</Label>
						{price.promotion === "early_bird" && discount !== null && (
							<span>{t("earlyPricing", "Early bird pricing")}</span>
						)}
					</div>
					<div className="pricing-price-offer">
						{discount !== null && (
							<div className="pricing-regular-price">
								<del>
									{formatPrice(
										{ ...price, unitAmount: price.regularUnitAmount! },
										locale,
									)}
								</del>
								<span className="pricing-price-banner pricing-heading-offer">
									{t("discount", "{{percent}}% off", { percent: discount })}
								</span>
							</div>
						)}
						<p className="pricing-price">
							{formatPrice(price, locale)}
							<span> {t("perMonth", "USD / month")}</span>
						</p>
					</div>
				</Radio.Content>
			</Radio>
		</RadioGroup>
	);
}

/** Cloud upgrade using Recordly styling and the verified billing catalog. */
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
	const pricingLoading = loading || (!manageSubscription && catalogLoading);
	const checkingPricing = Boolean(user && !needsSignIn && pricingLoading);
	const paymentPending = !plus && awaitingCheckout && !manageSubscription;
	const retryPricing = !(manageSubscription || checkoutReady) || paymentPending;
	const showSubscriptionPricing = !plus && !manageSubscription;
	const currentPeriodEnd = status?.billing.currentPeriodEnd;
	const actionLabel =
		!user || needsSignIn
			? t("signIn", "Sign in to continue")
			: checkingPricing && !busy
				? t("loadingPricing", "Loading pricing…")
				: paymentPending
					? t("checkPayment", "Check payment status")
					: retryPricing
						? plus
							? t("refreshPlan", "Refresh plan")
							: t("retryPricing", "Retry loading pricing")
						: plus || manageSubscription
							? t("manage", "Manage subscription")
							: t("start", "Get started");
	const pending = Boolean(busy) || checkingPricing;
	const benefits = [
		t("featureLicense", "Full commercial license"),
		t("featureLinkSharing", "Share any video with a 24/7 link"),
		t("featureStorage", "Unlimited cloud storage and bandwidth"),
		t("featurePlayback", "Play cloud videos in FHD 1080p"),
		t("featureCaptionExport", "Export caption SRT and VTT files"),
		t("featurePrioritySupport", "Priority support service"),
	];

	return (
		<Modal isOpen={pricingOpen} onOpenChange={setPricingOpen}>
			<Modal.Backdrop variant="blur" className="split-upgrade-backdrop">
				<Modal.Container size="lg" scroll="inside">
					<Modal.Dialog aria-label="Recordly Cloud" className="split-upgrade-modal">
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
												<OnboardingHeroTitle
													text={t(
														"upgradeHeading",
														"Unlock Recordly's full power",
													).replace("Recordly", "{{brand}}")}
												/>
											}
											description={t(
												"intro",
												"Commercial Use, Shareable Links, Cloud Storage and More.",
											)}
										/>
									</div>
									<div className="split-upgrade-details">
										<section
											className="split-upgrade-benefits"
											aria-label={t("yourBenefits", "Your Cloud benefits")}
										>
											<h3>{t("benefits", "Cloud benefits")}</h3>
											<ul>
												{benefits.map((benefit) => (
													<li key={benefit}>
														<span className="split-upgrade-check">
															<Check
																weight="bold"
																size={14}
																aria-hidden="true"
															/>
														</span>
														<span>{benefit}</span>
													</li>
												))}
											</ul>
										</section>
										<div className="split-upgrade-purchase">
											{showSubscriptionPricing && (
												<>
													{price && (
														<MonthlyPlanOption
															price={price}
															disabled={
																Boolean(busy) || paymentPending
															}
														/>
													)}
												</>
											)}
											{user && !loading && !needsSignIn && error && (
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
											{manageSubscription && !plus && (
												<p className="pricing-feedback" role="status">
													{t(
														"attention",
														"Your subscription needs attention. Open Manage subscription to review your payment details, invoices or cancellation options.",
													)}
												</p>
											)}
											{plus && (
												<p className="pricing-feedback" role="status">
													{t("active", "Your Cloud plan is active.")}
													{status.billing.cancelAtPeriodEnd &&
													currentPeriodEnd
														? ` ${t("ends", "It ends on {{date}}.", { date: new Date(currentPeriodEnd * 1000).toLocaleDateString(locale) })}`
														: ""}{" "}
													{t(
														"noExpiry",
														"Cloud recordings have no expiry while Cloud is active. They expire 7 days after Cloud ends.",
													)}
													{portalAvailable
														? ` ${t("portal", "Manage your payment details or cancel in the secure billing portal.")}`
														: ""}
												</p>
											)}
											{!plus && awaitingCheckout && (
												<p className="pricing-feedback" role="status">
													{t(
														"checkout",
														"Complete checkout in your browser, then return here. Your plan will update after payment is confirmed.",
													)}
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
														isPending={pending}
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
