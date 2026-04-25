import { FilmSlate as Film, Image } from "@phosphor-icons/react";
import { useScopedT } from "@/contexts/I18nContext";
import type { ExportFormat } from "@/lib/exporter/types";
import { cn } from "@/lib/utils";

interface FormatSelectorProps {
	selectedFormat: ExportFormat;
	onFormatChange: (format: ExportFormat) => void;
	disabled?: boolean;
}

interface FormatOption {
	value: ExportFormat;
	label: string;
	description: string;
	icon: React.ReactNode;
}

export function FormatSelector({
	selectedFormat,
	onFormatChange,
	disabled = false,
}: FormatSelectorProps) {
	const t = useScopedT("editor");

	const formatOptions: FormatOption[] = [
		{
			value: "mp4",
			label: t("format.mp4Video"),
			description: t("format.mp4Description"),
			icon: <Film className="w-5 h-5" />,
		},
		{
			value: "gif",
			label: t("format.gifAnimation"),
			description: t("format.gifDescription"),
			icon: <Image className="w-5 h-5" />,
		},
	];

	return (
		<div className="grid grid-cols-2 gap-3">
			{formatOptions.map((option) => {
				const isSelected = selectedFormat === option.value;
				return (
					<button
						key={option.value}
						type="button"
						disabled={disabled}
						onClick={() => onFormatChange(option.value)}
						className={cn(
							"relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200",
							"focus:outline-none focus:ring-2 focus:ring-[#2563EB]/50 focus:ring-offset-2 focus:ring-offset-editor-dialog",
							isSelected
								? "bg-[#2563EB]/10 border-[#2563EB]/50 text-[#2563EB] dark:text-white"
								: "bg-foreground/5 border-foreground/10 text-muted-foreground hover:bg-foreground/10 hover:border-foreground/20 hover:text-foreground",
							disabled && "opacity-50 cursor-not-allowed",
						)}
					>
						<div
							className={cn(
								"w-10 h-10 rounded-full flex items-center justify-center transition-colors",
								isSelected ? "bg-[#2563EB]/20 text-[#2563EB]" : "bg-foreground/5",
							)}
						>
							{option.icon}
						</div>
						<div className="text-center">
							<div className="font-medium text-sm">{option.label}</div>
							<div className="text-xs text-muted-foreground/70 mt-0.5">
								{option.description}
							</div>
						</div>
						{isSelected && (
							<div className="absolute top-2 end-2 w-2 h-2 rounded-full bg-[#2563EB]" />
						)}
					</button>
				);
			})}
		</div>
	);
}
