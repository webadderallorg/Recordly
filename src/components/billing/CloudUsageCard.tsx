import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { Button, Card, ProgressBar } from "@heroui/react";
import { Cloud } from "@phosphor-icons/react";
import { useI18n } from "@/contexts/I18nContext";
import { useBilling } from "./BillingProvider";
import { formatCloudBytes } from "./formatBillingValues";
import { UpgradeButton } from "./UpgradeButton";
import "./Billing.css";

export function CloudUsageCard({
	onSignIn,
	className = "",
	lowStorageOnly = false,
	showUpgrade = true,
}: {
	onSignIn?: () => void;
	className?: string;
	lowStorageOnly?: boolean;
	showUpgrade?: boolean;
}) {
	const { t, locale } = useI18n();
	const remaining = (count: number) =>
		t("billing.remainingCount", "{{number}} recordings remaining", {
			count,
			number: new Intl.NumberFormat(locale).format(count),
		});
	const { user, status, catalog, fallbackUsage, usagePreview, loading, error, refresh } =
		useBilling();
	const usage = status?.usage ?? (fallbackUsage ? null : usagePreview?.usage);
	const plus = (status?.billing.plan ?? usagePreview?.plan) === "pro";
	const unlimited = plus && usage?.storageLimitBytes === null;
	const recordings = usage?.recordings ?? fallbackUsage?.recordings;
	const limit = usage?.recordingLimit ?? catalog?.limits.freeRecordingLimit ?? 5;
	const knownUsage = recordings !== undefined;
	const storageLimit = usage?.storageLimitBytes ?? 0;
	const max = plus ? storageLimit : limit;
	const value = plus && usage ? usage.storageBytes : (recordings ?? 0);
	if (lowStorageOnly && (unlimited || (plus && storageLimit - value > 5_000_000_000)))
		return null;
	return (
		<Card
			className={`cloud-usage-card ${className}`}
			aria-label={t("settings.cloudUsage.label", "Cloud usage")}
		>
			<Card.Header>
				<div className="cloud-usage-heading">
					<Cloud size={16} aria-hidden="true" />
					<Card.Title
						aria-label={
							plus ? t("settings.cloudUsage.plus", "Cloud storage") : undefined
						}
					>
						{plus
							? t("settings.cloudUsage.plus", "Cloud storage")
							: t("settings.cloudUsage.recordings", "Cloud recordings")}
					</Card.Title>
				</div>
			</Card.Header>
			<Card.Content>
				{!user ? (
					<p>
						{t(
							"settings.cloudUsage.signIn",
							"Sign in to share recordings and see your cloud usage.",
						)}
					</p>
				) : !knownUsage ? (
					<p role={error && !loading ? "alert" : "status"}>
						{loading
							? t("settings.cloudUsage.loading", "Loading usage…")
							: t("settings.cloudUsage.unavailable", "Cloud usage is unavailable.")}
						{error && !loading && (
							<ErrorReportButton error={error} context="cloud-usage" />
						)}
					</p>
				) : (
					<>
						<p className="cloud-usage-count">
							{plus && usage
								? unlimited
									? t(
											"settings.cloudUsage.unlimited",
											"{{used}} used · Unlimited storage",
											{ used: formatCloudBytes(usage.storageBytes, locale) },
										)
									: t("settings.cloudUsage.storage", "{{used}} of {{limit}}", {
											used: formatCloudBytes(usage.storageBytes, locale),
											limit: formatCloudBytes(storageLimit, locale),
										})
								: t("settings.cloudUsage.slots", "{{count}} of {{limit}} used", {
										count: new Intl.NumberFormat(locale).format(
											recordings ?? 0,
										),
										limit: new Intl.NumberFormat(locale).format(limit),
									})}
						</p>
						{!unlimited && (
							<ProgressBar
								aria-label={
									plus
										? t("settings.cloudUsage.usedLabel", "Cloud storage used")
										: t(
												"settings.cloudUsage.slotsLabel",
												"Cloud recording slots used",
											)
								}
								value={Math.min(value, max)}
								maxValue={Math.max(max, 1)}
								size="sm"
							>
								<ProgressBar.Track>
									<ProgressBar.Fill />
								</ProgressBar.Track>
							</ProgressBar>
						)}
						<p>
							{plus
								? t("billing.recordingCount", "{{number}} cloud recordings", {
										count: recordings ?? 0,
										number: new Intl.NumberFormat(locale).format(
											recordings ?? 0,
										),
									})
								: remaining(Math.max(0, limit - (recordings ?? 0)))}
						</p>
					</>
				)}
				{user && error && !loading && !knownUsage && (
					<>
						<Button
							variant="ghost"
							size="sm"
							className="cloud-usage-retry"
							onPress={() => void refresh()}
						>
							{t("settings.cloudUsage.retry", "Retry usage")}
						</Button>
					</>
				)}
			</Card.Content>
			{(showUpgrade || (!user && onSignIn)) && (
				<Card.Footer>
					{showUpgrade && (
						<UpgradeButton
							label={t("billing.upgradeShort", "Upgrade")}
							className="w-full"
						/>
					)}
					{!user && onSignIn && (
						<Button variant="ghost" size="sm" className="w-full" onPress={onSignIn}>
							{t("settings.cloudUsage.signInFree", "Sign in for free")}
						</Button>
					)}
				</Card.Footer>
			)}
		</Card>
	);
}
