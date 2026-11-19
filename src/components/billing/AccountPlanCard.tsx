import { Button, Card } from "@heroui/react";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { useI18n } from "@/contexts/I18nContext";
import { useBilling } from "./BillingProvider";
import { PlusBadge } from "./PlusBadge";
import { UpgradeButton } from "./UpgradeButton";

/** Account controls use the same verified plan and portal flow as the Cloud screen. */
export function AccountPlanCard() {
	const { t, locale } = useI18n();
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
							? t("billing.active", "Your Cloud plan is active.")
							: t("billing.freeActive", "You’re on the Free plan.")
						: loading
							? t("billing.loadingPlan", "Loading your plan…")
							: needsSignIn
								? t("billing.signIn", "Sign in to continue")
								: t(
										"billing.planUnavailable",
										"We couldn’t load your plan. Refresh to try again.",
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
				{plus && periodEnd && !billing?.portalAvailable && (
					<p>
						{t(
							"billing.portalUnavailable",
							"Subscription management is not available yet. Try refreshing your plan.",
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
							"We couldn’t connect to secure billing. Try again or refresh your plan, or contact support if the problem continues.",
						)}{" "}
						<ErrorReportButton error={error} context="billing" />
					</p>
				)}
			</Card.Content>
			<Card.Footer className="flex-wrap justify-start gap-2">
				{needsSignIn ? (
					<Button size="sm" variant="secondary" onPress={openPricing}>
						{t("billing.signIn", "Sign in to continue")}
					</Button>
				) : billing?.portalAvailable ? (
					<Button
						size="sm"
						variant="secondary"
						isDisabled={disabled}
						isPending={busy === "portal"}
						onPress={() => void startBilling("portal")}
					>
						{t("billing.manage", "Manage subscription")}
					</Button>
				) : null}
				{!needsSignIn && billing?.checkoutAvailable && !plus && !pending && (
					<UpgradeButton />
				)}
				<Button
					size="sm"
					variant="ghost"
					isDisabled={disabled}
					isPending={loading}
					onPress={() => void refresh()}
				>
					{pending
						? t("billing.checkPayment", "Check payment status")
						: t("billing.refreshPlan", "Refresh plan")}
				</Button>
			</Card.Footer>
		</Card>
	);
}
