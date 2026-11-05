import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { Plus } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RecordNewButton({
	busy,
	run,
	className,
	first = false,
}: {
	busy: boolean;
	run: (action: () => Promise<void>) => Promise<void>;
	className?: string;
	first?: boolean;
}) {
	const { t: uiText } = useUiLocale();
	return (
		<Button
			variant="default"
			disabled={busy}
			onClick={() => void run(() => window.electronAPI.showRecordingHud())}
			className={cn("h-10 shrink-0 gap-2 text-[13px]", className)}
		>
			<Plus className="size-4" />
			{first ? uiText("ui.recordYourFirstVideo") : uiText("ui.recordNew")}
		</Button>
	);
}
