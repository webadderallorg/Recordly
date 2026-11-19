import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import {
	ColorArea,
	ColorField,
	ColorPicker,
	ColorSlider,
	ColorSwatchPicker,
	Input,
	Popover,
} from "@heroui/react";
import { FolderSimple, Plus, X } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { FOLDER_COLORS } from "./useProjectFolders";

export function FolderColors({
	value,
	onChange,
	custom,
	onCustomChange,
	name,
}: {
	value: string;
	onChange: (color: string) => void;
	custom: string[];
	onCustomChange: (colors: string[]) => void;
	name: string;
}) {
	const { t: uiText } = useUiLocale();
	const colors = [...new Set([...FOLDER_COLORS, ...custom])];
	return (
		<ColorPicker value={value} onChange={(color) => onChange(color.toString("hex"))}>
			<Button
				variant="ghost"
				size="icon"
				aria-label={uiText("ui.changeColorFor", undefined, { name: name })}
				className="size-8 min-w-8 rounded-md"
			>
				<FolderSimple weight="fill" className="size-[18px]" style={{ color: value }} />
			</Button>
			<ColorPicker.Popover>
				<Popover.Dialog
					aria-label={uiText("ui.folderColor")}
					className="flex w-60 flex-col gap-3 p-3"
				>
					<ColorSwatchPicker aria-label={uiText("ui.folderColors")}>
						{colors.map((color) => (
							<ColorSwatchPicker.Item key={color} color={color}>
								<ColorSwatchPicker.Swatch />
								<ColorSwatchPicker.Indicator />
							</ColorSwatchPicker.Item>
						))}
					</ColorSwatchPicker>
					<ColorArea
						colorSpace="hsb"
						xChannel="saturation"
						yChannel="brightness"
						className="h-32"
					>
						<ColorArea.Thumb />
					</ColorArea>
					<ColorSlider colorSpace="hsb" channel="hue">
						<ColorSlider.Track>
							<ColorSlider.Thumb />
						</ColorSlider.Track>
					</ColorSlider>
					<div className="flex items-center gap-2">
						<ColorField aria-label={uiText("ui.hexColor")} className="min-w-0 flex-1">
							<Input aria-label={uiText("ui.hexColor")} className="h-8 text-xs" />
						</ColorField>
						<Button
							variant="ghost"
							size="icon"
							aria-label={
								custom.includes(value)
									? uiText("ui.removeCustomColor")
									: uiText("ui.saveCustomColor")
							}
							disabled={FOLDER_COLORS.includes(value)}
							className="size-8 min-w-8"
							onClick={() =>
								onCustomChange(
									custom.includes(value)
										? custom.filter((color) => color !== value)
										: [...custom, value],
								)
							}
						>
							{custom.includes(value) ? (
								<X className="size-4" />
							) : (
								<Plus className="size-4" />
							)}
						</Button>
					</div>
				</Popover.Dialog>
			</ColorPicker.Popover>
		</ColorPicker>
	);
}
