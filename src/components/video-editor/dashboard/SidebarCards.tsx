import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { Card } from "@heroui/react";
import { CloudUsageCard } from "@/components/billing/CloudUsageCard";
import { useBilling } from "@/components/billing/BillingProvider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { sidebarCardConfig } from "./sidebarCardConfig";

export function SidebarCards({ onSignIn }: { onSignIn?: () => void }) {
	const { t: uiText } = useUiLocale();
	const { user, status, usagePreview } = useBilling();
	const showCloudUsage = user && (status?.billing.plan ?? usagePreview?.plan) === "free";
	return (
		<div aria-label={uiText("ui.sidebarAnnouncements")} className="mb-4 shrink-0 space-y-3">
			{showCloudUsage && (
				<CloudUsageCard onSignIn={onSignIn} lowStorageOnly showUpgrade={false} />
			)}
			{(sidebarCardConfig.enabled ? sidebarCardConfig.cards : []).map((card) => (
				<Card key={card.id} className="gap-3 overflow-hidden p-3 shadow-none">
					{card.image && (
						<img
							src={
								/^(https?:|data:)/.test(card.image)
									? card.image
									: `${import.meta.env.BASE_URL}${card.image}`
							}
							alt={card.imageAlt ?? ""}
							className="aspect-video w-full rounded-lg object-cover"
						/>
					)}
					<Card.Header className="gap-1 p-0">
						<Card.Title className="text-[13px]">{card.heading}</Card.Title>
						{card.subheading && (
							<Card.Description className="text-xs">
								{card.subheading}
							</Card.Description>
						)}
					</Card.Header>
					{card.paragraph && (
						<Card.Content className="p-0 text-xs leading-relaxed text-muted">
							{card.paragraph}
						</Card.Content>
					)}
					{card.href && (
						<Card.Footer className="p-0">
							<Button
								size="sm"
								variant="secondary"
								onClick={() =>
									void window.electronAPI
										.openExternalUrl(card.href!)
										.then((result) => {
											if (!result.success)
												throw new Error(
													result.error || uiText("ui.couldNotOpenLink"),
												);
										})
										.catch((error) => toast.error(String(error)))
								}
							>
								{card.linkLabel ?? uiText("ui.learnMore")}
							</Button>
						</Card.Footer>
					)}
				</Card>
			))}
		</div>
	);
}
