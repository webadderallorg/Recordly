import { useScopedT } from "@/contexts/I18nContext";
import { Button } from "@heroui/react";
import { getDiscountPercent, getPlusPrice } from "./pricingOffer";
import { useBilling } from "./BillingProvider";

export function UpgradeButton({
	className,
	label,
	showDiscount = true,
	variant = "secondary",
	size = "sm",
}: {
	className?: string;
	label?: string;
	showDiscount?: boolean;
	variant?: "primary" | "secondary" | "ghost";
	size?: "sm" | "md" | "lg";
}) {
	const t = useScopedT("billing");
	const { status, catalog, openPricing } = useBilling();
	const percent = getDiscountPercent(getPlusPrice(catalog));
	const discount =
		!showDiscount || percent === null ? null : t("discount", "{{percent}}% off", { percent });
	if (status?.billing.plan === "pro") return null;

	return (
		<Button
			variant={variant}
			size={size}
			className={`gap-2 ${className ?? ""}`}
			aria-label={[label ?? t("upgrade", "Upgrade to Cloud"), discount]
				.filter(Boolean)
				.join(", ")}
			onPress={openPricing}
		>
			{label ?? t("upgrade", "Upgrade to Cloud")}
			{discount && (
				<span className="shrink-0 whitespace-nowrap rounded-full bg-danger/10 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-danger">
					{discount}
				</span>
			)}
		</Button>
	);
}
