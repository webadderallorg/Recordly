import { useI18n, useScopedT } from "@/contexts/I18nContext";
import {
	ArrowClockwise,
	Briefcase,
	CloudArrowUp,
	FileText,
	Infinity as InfinityIcon,
	Link,
	Monitor,
	Sparkle,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useBilling } from "./BillingProvider";
import { PlusBadge } from "./PlusBadge";

export function PlusFeatureDetails({
	pricing,
	action,
}: {
	pricing?: ReactNode;
	action?: ReactNode;
}) {
	const t = useScopedT("billing");
	const { locale } = useI18n();
	const { catalog } = useBilling();
	const gb = (bytes: number) =>
		new Intl.NumberFormat(locale, {
			style: "unit",
			unit: "gigabyte",
			unitDisplay: "short",
			maximumFractionDigits: 1,
		}).format(bytes / 1_000_000_000);
	const limits = catalog?.limits;
	const plusFeatures = [
		t("featureCommercial", "Commercial use"),
		t("featureCaptionFiles", "SRT and VTT caption-file exports"),
		t("featureShare", "Share videos in high-definition 1080p"),
		t("featureStorage", "Unlimited cloud storage and bandwidth"),
		limits
			? t("featureUpload", "Upload recordings up to {{size}} each", {
					size: gb(limits.plusMaxRecordingBytes),
				})
			: t("featureUploadFallback", "Larger cloud uploads"),
		...(limits?.plusWeeklyUploadLimit
			? [
					t("featureWeeklyUploads", "{{count}} new uploads per rolling 7 days", {
						count: limits.plusWeeklyUploadLimit,
					}),
				]
			: []),
		t("featureLinks", "Shared links stay live while Cloud is active"),
		t("featureExisting", "Keep existing cloud recordings while Cloud is active"),
		t("featureFuture", "More features to come..."),
	];
	const featureIcons = [
		Briefcase,
		FileText,
		Monitor,
		Link,
		CloudArrowUp,
		...(limits?.plusWeeklyUploadLimit ? [CloudArrowUp] : []),
		InfinityIcon,
		ArrowClockwise,
		Sparkle,
	];
	return (
		<section
			className="plus-feature-details"
			aria-label={t("benefitsPricing", "Cloud benefits and pricing")}
		>
			<div className="plus-plan-badges">
				<PlusBadge size="lg" />
			</div>
			{pricing && <div className="plus-plan-pricing">{pricing}</div>}
			{action && <div className="plus-plan-action">{action}</div>}
			<div className="plus-feature-group">
				<ul aria-label={t("yourBenefits", "Your Cloud benefits")}>
					{plusFeatures.map((feature, index) => {
						const Icon = featureIcons[index];
						return (
							<li key={feature}>
								<Icon size={18} aria-hidden="true" />
								<span>{feature}</span>
							</li>
						);
					})}
				</ul>
			</div>
		</section>
	);
}
