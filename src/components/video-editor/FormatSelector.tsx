import { ToggleButtonGroup, ToggleButton } from "@heroui/react";
import { FilmSlate as Film, Image } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import type { ExportFormat } from "@/lib/exporter/types";

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
		<ToggleButtonGroup
			aria-label={t("format.title", "Export format")}
			selectionMode="single"
			disallowEmptySelection
			selectedKeys={[selectedFormat]}
			onSelectionChange={(keys) => {
				const value = Array.from(keys)[0];
				if (value) onFormatChange(value as ExportFormat);
			}}
			isDisabled={disabled}
			fullWidth
		>
			{formatOptions.map((option) => (
				<ToggleButton
					key={option.value}
					id={option.value}
					className="h-auto flex-1 flex-col gap-2 p-4"
				>
					{option.icon}
					<span>{option.label}</span>
					<span className="text-xs opacity-70">{option.description}</span>
				</ToggleButton>
			))}
		</ToggleButtonGroup>
	);
}
