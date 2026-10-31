import { Card } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { sidebarCardConfig } from "./sidebarCardConfig";

export function SidebarCards() {
	if (!sidebarCardConfig.enabled || sidebarCardConfig.cards.length === 0) return null;
	return (
		<div
			aria-label="Sidebar announcements"
			className="mb-4 max-h-[35vh] space-y-3 overflow-y-auto"
		>
			{sidebarCardConfig.cards.map((card) => (
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
													result.error || "Could not open link",
												);
										})
										.catch((error) => toast.error(String(error)))
								}
							>
								{card.linkLabel ?? "Learn more"}
							</Button>
						</Card.Footer>
					)}
				</Card>
			))}
		</div>
	);
}
