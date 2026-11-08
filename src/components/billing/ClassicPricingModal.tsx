import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { Button, Modal } from "@heroui/react";
import {
	ArrowLeft,
	ArrowRight,
	Briefcase,
	ClosedCaptioning,
	CloudArrowUp,
	Heart,
	Link,
} from "@phosphor-icons/react";
import { useRef } from "react";
import { RecordlyDemoVideo } from "@/components/ui/RecordlyDemoVideo";
import { useBilling } from "./BillingProvider";
import "./Billing.css";
import { EarlyBirdTag } from "./EarlyBirdTag";
import { PaymentMethods } from "./PaymentMethods";
import { PlusFeatureDetails } from "./PlusFeatureDetails";
import { UpgradeTestimonials } from "./UpgradeTestimonials";

export { formatCloudBytes } from "./formatBillingValues";
import { getDiscountPercent, getPlusPrice, hasVerifiedCheckoutPrice } from "./pricingOffer";
import { formatPrice } from "./formatBillingValues";

/** Original upgrade design, retained for comparison and a one-line rollback. */
export function ClassicPricingModal({ onSignIn }: { onSignIn: () => void }) {
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
	const featureTrack = useRef<HTMLDivElement>(null);
	const interval = "monthly";
	const plus = status?.billing.plan === "pro";
	const price = getPlusPrice(catalog, interval);
	const percent = getDiscountPercent(price);
	const regularPrice =
		price && percent !== null ? { ...price, unitAmount: price.regularUnitAmount! } : null;
	const checkoutReady = Boolean(
		!plus &&
			status?.billing.checkoutAvailable &&
			status.billing.checkoutIntervals.includes(interval) &&
			hasVerifiedCheckoutPrice(catalog, status.billing, interval),
	);
	const portalAvailable = Boolean(status?.billing.portalAvailable);
	const manageSubscription = portalAvailable && (plus || !checkoutReady);
	const canManage = manageSubscription || checkoutReady;
	const pricingLoading = loading || (!manageSubscription && catalogLoading);
	const paymentPending = !plus && awaitingCheckout && !manageSubscription;
	const retryPricing = !canManage || paymentPending;
	const actionLabel =
		!user || needsSignIn
			? t("signIn", "Sign in to continue")
			: paymentPending
				? t("checkPayment", "Check payment status")
				: plus || manageSubscription
					? t("manage", "Manage subscription")
					: t("start", "Get started");
	const signIn = () => {
		setPricingOpen(false);
		onSignIn();
	};
	const currentPeriodEnd = status?.billing.currentPeriodEnd;
	// The catalog describes new purchases, not an existing subscriber's agreed price.
	const showSubscriptionPricing = !plus && !manageSubscription;
	return (
		<Modal isOpen={pricingOpen} onOpenChange={setPricingOpen}>
			<Modal.Backdrop variant="blur">
				<Modal.Container size="lg" scroll="inside">
					<Modal.Dialog
						aria-label="Recordly Cloud"
						className="pricing-modal upgrade-modal"
					>
						<Modal.CloseTrigger
							className="pricing-close"
							aria-label={appT("common.actions.close", "Close")}
						/>
						<Modal.Body className="pricing-body">
							{/* Structure ported from shots.so's live upgrade-modal, 2026-10-17. */}
							<Modal.Header className="upgrade-modal-head">
								<div className="cover" aria-hidden="true">
									<RecordlyDemoVideo />
								</div>
								<div className="copy">
									{showSubscriptionPricing && (
										<EarlyBirdTag className="pricing-heading-offer" />
									)}
									<Modal.Heading className="heading-display">
										{t("heading", "Unlock the full power of Recordly")}
									</Modal.Heading>
									<p className="pricing-intro">
										{t(
											"intro",
											"Commercial Use, Shareable Links, Cloud Storage and More.",
										)}
									</p>
								</div>
							</Modal.Header>
							<div className="slideshow-component">
								<div
									className="items-scroll"
									ref={featureTrack}
									role="region"
									aria-label={t("benefits", "Cloud benefits")}
									tabIndex={0}
								>
									<div className="all-items">
										{[
											{
												title: t(
													"perkCommercial",
													"Commercial use included",
												),
												icon: Briefcase,
												theme: "export",
											},
											{
												title: t(
													"featureCaptionFiles",
													"SRT and VTT caption-file exports",
												),
												icon: ClosedCaptioning,
												theme: "export",
											},
											{
												title: t("perkShare", "Share without limits"),
												icon: CloudArrowUp,
												theme: "cloud",
											},
											{
												title: t("perkLinks", "Keep your links alive"),
												icon: Link,
												theme: "retention",
											},
											{
												title: t("perkSupport", "Support solo development"),
												icon: Heart,
												theme: "support",
											},
										].map(({ title, icon: Icon, theme }) => (
											<div className="slideshow-item is-list" key={title}>
												<article className={`perk-card perk-${theme}`}>
													<div className="copy">
														<h3>{title}</h3>
													</div>
													<div className="cover" aria-hidden="true">
														<Icon size={64} weight="fill" />
													</div>
												</article>
											</div>
										))}
									</div>
								</div>
								<div className="nav-buttons inline-mode">
									<Button
										isIconOnly
										variant="secondary"
										aria-label={t("previous", "Previous benefits")}
										onPress={() =>
											featureTrack.current?.scrollBy({
												left:
													-(
														featureTrack.current?.querySelector(
															"article",
														)?.clientWidth ?? 280
													) - 10,
												behavior: window.matchMedia(
													"(prefers-reduced-motion: reduce)",
												).matches
													? "instant"
													: "smooth",
											})
										}
									>
										<ArrowLeft size={18} />
									</Button>
									<Button
										isIconOnly
										variant="secondary"
										aria-label={t("next", "Next benefits")}
										onPress={() =>
											featureTrack.current?.scrollBy({
												left: 250,
												behavior: window.matchMedia(
													"(prefers-reduced-motion: reduce)",
												).matches
													? "instant"
													: "smooth",
											})
										}
									>
										<ArrowRight size={18} />
									</Button>
								</div>
							</div>
							{!plus && <PaymentMethods />}
							<div className="pricing-purchase plans-info">
								<PlusFeatureDetails
									pricing={
										showSubscriptionPricing && price ? (
											<div className="pricing-price-offer">
												{regularPrice && (
													<div className="pricing-regular-price">
														<del
															aria-label={t(
																"regularPrice",
																"Regular price {{price}} USD per month",
																{
																	price: formatPrice(
																		regularPrice,
																		locale,
																	),
																},
															)}
														>
															{formatPrice(regularPrice, locale)}
														</del>
														<span className="pricing-price-banner">
															{t(
																"earlyBird",
																"EARLY BIRD {{percent}}% OFF",
																{
																	percent: percent!,
																},
															)}
														</span>
													</div>
												)}
												<p className="pricing-price">
													{formatPrice(price, locale)}
													<span> {t("perMonth", "USD / month")}</span>
												</p>
											</div>
										) : null
									}
									action={
										(showSubscriptionPricing ||
											currentPeriodEnd != null ||
											status?.billing.portalAvailable) && (
											<Button
												variant="primary"
												className="pricing-cta"
												aria-label={actionLabel}
												isPending={
													Boolean(busy) ||
													(Boolean(user) && pricingLoading)
												}
												isDisabled={
													Boolean(busy) ||
													(Boolean(user) && pricingLoading)
												}
												onPress={() => {
													if (!user || needsSignIn) signIn();
													else if (retryPricing) void refresh();
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
										)
									}
								/>
								{paymentPending && checkoutReady && (
									<Button
										variant="ghost"
										isDisabled={Boolean(busy) || pricingLoading}
										onPress={() => void startBilling("checkout", interval)}
									>
										{t("returnToCheckout", "Return to checkout")}
									</Button>
								)}
								{!plus && checkoutReady && portalAvailable && (
									<Button
										variant="ghost"
										isDisabled={Boolean(busy) || loading}
										onPress={() => void startBilling("portal")}
									>
										{t("previousSubscription", "Manage previous subscription")}
									</Button>
								)}
							</div>
							{user && !loading && !needsSignIn && error && (
								<p className="pricing-error" role="alert">
									{t(
										"connectionError",
										"We couldn\u2019t connect to secure billing. Try again or refresh your plan, or contact support if the problem continues.",
									)}
									<ErrorReportButton error={error} context="billing" />
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
									{status.billing.cancelAtPeriodEnd && currentPeriodEnd
										? ` ${t("ends", "It ends on {{date}}.", { date: new Date(currentPeriodEnd * 1000).toLocaleDateString(locale) })}`
										: ""}{" "}
									{t(
										"noExpiry",
										"Cloud recordings have no expiry while Cloud is active. They expire 7 days after Cloud ends.",
									)}
									{status.billing.portalAvailable &&
										` ${t("portal", "Manage your payment details or cancel in the secure billing portal.")}`}
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
							<UpgradeTestimonials />
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
