import { Card } from "@heroui/react";
import { PuzzlePiece } from "@/components/ui/icons";

export default function ExtensionManager() {
	return (
		<Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden rounded-none bg-transparent p-0 shadow-none">
			<div className="flex flex-1 items-center justify-center p-6">
				<div className="flex max-w-[240px] flex-col items-center text-center">
					<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-foreground/10 bg-foreground/[0.04]">
						<PuzzlePiece className="h-6 w-6 text-muted-foreground" />
					</div>
					<h3 className="text-sm font-semibold text-foreground">
						Extensions are no longer available
					</h3>
					<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
						Extension installation and marketplace access have been disabled. This area
						is kept as a placeholder for existing projects and navigation.
					</p>
				</div>
			</div>
		</Card>
	);
}
