import { useScopedT } from "@/contexts/I18nContext";
import "./EarlyBirdTag.css";
import { useOptionalBilling } from "./BillingProvider";
import { getDiscountPercent, getPlusPrice } from "./pricingOffer";

export function EarlyBirdTag({
	className = "",
	compact = false,
}: {
	className?: string;
	compact?: boolean;
}) {
	const t = useScopedT("billing");
	const price = getPlusPrice(useOptionalBilling()?.catalog ?? null);
	const percent = getDiscountPercent(price);
	if (price?.promotion !== "early_bird" || percent === null) return null;
	return (
		<span
			className={`early-bird-banner ${compact ? "early-bird-banner--compact" : ""} ${className}`}
		>
			{t("earlyBird", "EARLY BIRD {{percent}}% OFF", { percent })}
		</span>
	);
}
