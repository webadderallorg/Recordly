import { ClassicPricingModal } from "./ClassicPricingModal";
import { SplitPricingModal } from "./SplitPricingModal";

export { formatCloudBytes } from "./formatBillingValues";

export type UpgradeModalDesign = "split" | "classic";
// Keep the original design available without changing any upgrade entry points.
export const DEFAULT_UPGRADE_MODAL_DESIGN: UpgradeModalDesign = "split";

export function PricingModal({
	onSignIn,
	design = DEFAULT_UPGRADE_MODAL_DESIGN,
}: {
	onSignIn: () => void;
	design?: UpgradeModalDesign;
}) {
	const previewClassic =
		import.meta.env.DEV &&
		new URLSearchParams(window.location.search).get("upgradeModal") === "classic";
	return design === "classic" || previewClassic ? (
		<ClassicPricingModal onSignIn={onSignIn} />
	) : (
		<SplitPricingModal onSignIn={onSignIn} />
	);
}
