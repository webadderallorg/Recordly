import { Button, Card } from "@heroui/react";
import { useId, useState } from "react";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { openExternalLink } from "@/components/feedback/FeedbackLinks";
import { useI18n } from "@/contexts/I18nContext";
import { useBilling } from "./BillingProvider";
import { PlusBadge } from "./PlusBadge";
import { UpgradeButton } from "./UpgradeButton";

const supportUrl = "mailto:support@recordly.dev";

/** Account controls use the same verified plan and portal flow as the Plus screen. */
export function AccountPlanCard() {
	const { t, locale } = useI18n();
	const portalHelpId = useId();
	const [showPortalHelp, setShowPortalHelp] = useState(false);
	const {
		status,
		loading,
		error,
		needsSignIn,
		busy,
		refresh,
		openPricing,
		startBilling,
		awaitingCheckout,
	} = useBilling();
	const billing = status?.billing;
	const plus = billing?.plan === "pro";
	const pending = awaitingCheckout && !plus;
	const periodEnd = billing?.currentPeriodEnd;
	const disabled = loading || Boolean(busy);
	const portalAvailable = billing?.portalAvailable === true;
	const showManage = plus || portalAvailable;
	const canUpgrade = !needsSignIn && billing?.checkoutAvailable && !plus && !pending;
	const canRetry = !needsSignIn && !billing && !loading;
	const [portalHelpBefore, portalHelpAfter] = t(
		"billing.noAccountPortal",
		"No billing portal is available for this account. If you’re being charged, {{support}}.",
	).split("{{support}}");
	return (
		<Card
			className="account-plan-card w-full gap-3 rounded-lg border border-separator p-4 shadow-none"
			aria-label={t("billing.accountPlan", "Plan & billing")}
		>
			<Card.Header className="flex-row items-center justify-between gap-3">
				<Card.Title>{t("billing.currentPlan", "Current plan")}</Card.Title>
				{billing &&
					(plus ? (
						<PlusBadge />
					) : (
						<span className="rounded-md bg-surface-secondary px-2 py-1 text-xs font-medium">
							{t("billing.freePlan", "Free")}
						</span>
					))}
			</Card.Header>
			<Card.Content className="gap-2 text-xs leading-relaxed text-muted">
				<p role={!billing ? (loading ? "status" : "alert") : undefined}>
					{billing
						? plus
							? t("billing.active", "Your Plus plan is active.")
							: t("billing.freeActive", "You’re on the Free plan.")
						: loading
							? t("billing.loadingPlan", "Loading your plan…")
							: needsSignIn
								? t("billing.signIn", "Sign in to continue")
								: t(
										"billing.planUnavailable",
										"We couldn’t load your plan. Please try again.",
									)}
				</p>
				{plus && periodEnd && (
					<p>
						{t(
							billing.cancelAtPeriodEnd ? "billing.ends" : "billing.periodEnds",
							billing.cancelAtPeriodEnd
								? "It ends on {{date}}."
								: "Current billing period ends on {{date}}.",
							{ date: new Date(periodEnd * 1000).toLocaleDateString(locale) },
						)}
					</p>
				)}
				{billing?.portalAvailable && (
					<p>
						{t(
							!plus && !billing.checkoutAvailable
								? "billing.attention"
								: "billing.portal",
							!plus && !billing.checkoutAvailable
								? "Your subscription needs attention. Open Manage subscription to review your payment details, invoices or cancellation options."
								: "Manage your payment details or cancel in the secure billing portal.",
						)}
					</p>
				)}
				{pending && (
					<p role="status">
						{t(
							"billing.checkout",
							"Complete checkout in your browser, then return here. Your plan will update after payment is confirmed.",
						)}
					</p>
				)}
				{error && !loading && billing && (
					<p role="alert" className="text-danger">
						{t(
							"billing.connectionError",
							"We couldn’t connect to secure billing. Try again, or contact support if the problem continues.",
						)}{" "}
						<ErrorReportButton error={error} context="billing" />
					</p>
				)}
			</Card.Content>
			{(needsSignIn || showManage || canUpgrade || pending || canRetry) && (
				<Card.Footer className="flex-wrap justify-start gap-2">
					{needsSignIn ? (
						<Button size="sm" variant="secondary" onPress={openPricing}>
							{t("billing.signIn", "Sign in to continue")}
						</Button>
					) : showManage ? (
						<Button
							size="sm"
							variant="secondary"
							isDisabled={disabled}
							isPending={busy === "portal"}
							aria-controls={portalAvailable ? undefined : portalHelpId}
							aria-expanded={portalAvailable ? undefined : showPortalHelp}
							onPress={() => {
								if (portalAvailable) void startBilling("portal");
								else setShowPortalHelp((show) => !show);
							}}
						>
							{t("billing.manage", "Manage subscription")}
						</Button>
					) : null}
					{canUpgrade && <UpgradeButton />}
					{!needsSignIn && showManage && !portalAvailable && (
						<p
							id={portalHelpId}
							hidden={!showPortalHelp}
							className="w-full text-xs leading-relaxed text-muted"
						>
							{portalHelpBefore}
							<a
								href={supportUrl}
								className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-current"
								onClick={(event) => {
									event.preventDefault();
									void openExternalLink(
										supportUrl,
										t("editor.feedback.openFailed", "Failed to open link."),
									);
								}}
							>
								{t("billing.contactSupport", "contact support")}
							</a>
							{portalHelpAfter}
						</p>
					)}
					{(pending || canRetry) && (
						<Button
							size="sm"
							variant="ghost"
							isDisabled={disabled}
							isPending={loading}
							onPress={() => void refresh()}
						>
							{pending
								? t("billing.checkPayment", "Check payment status")
								: t("ui.retry", "Retry")}
						</Button>
					)}
				</Card.Footer>
			)}
		</Card>
	);
}
