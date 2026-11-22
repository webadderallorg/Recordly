import { Checkbox, Label } from "@heroui/react";
import { useScopedT } from "@/contexts/I18nContext";

/** Local GIF optimization is available to everyone. */
export function GifOptimizeSizeCheckbox({
	selected,
	onChange,
}: {
	selected: boolean;
	onChange?: (enabled: boolean) => void;
}) {
	const t = useScopedT("settings");
	return (
		<Checkbox isSelected={selected} onChange={onChange}>
			<Checkbox.Content>
				<Checkbox.Control>
					<Checkbox.Indicator />
				</Checkbox.Control>
				<Label className="flex items-center gap-2 whitespace-nowrap text-xs">
					{t("export.optimizeSize", "Optimize size")}
				</Label>
			</Checkbox.Content>
		</Checkbox>
	);
}

export const GifOptimizeSizeControl = GifOptimizeSizeCheckbox;
