import {
	Button,
	ColorArea,
	ColorField,
	ColorPicker,
	ColorSlider,
	Input,
	Popover,
	ToggleButton,
} from "@heroui/react";
import { type ReactNode, useState } from "react";
import { Plus, X } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { loadEditorPreferences, saveEditorPreferences } from "./editorPreferences";
import { WallpaperGlassGrid } from "./WallpaperGlassGrid";

export function ColorBackgroundPicker({
	value,
	presets,
	onChange,
	tileClassName,
	children,
	onCreateGradient,
}: {
	children?: ReactNode;
	onCreateGradient?: () => void;
	value: string;
	presets: readonly string[];
	onChange: (color: string) => void;
	tileClassName: (selected: boolean) => string;
}) {
	const te = useScopedT("editing");
	const [custom, setCustom] = useState(() => loadEditorPreferences().customColors);
	const [open, setOpen] = useState(false);
	const selectedColor = /^#(?:[0-9a-f]{3}){1,2}$/i.test(value) ? value : "";
	const [draft, setDraft] = useState(selectedColor || presets[0]);
	const colors = [
		...new Set(
			[...custom, ...presets, ...(selectedColor ? [selectedColor] : [])].map((color) =>
				color.toLowerCase(),
			),
		),
	];
	return (
		<>
			<WallpaperGlassGrid aria-label={te("backgroundColors", "Background colors")}>
				<ColorPicker value={draft} onChange={(color) => setDraft(color.toString("hex"))}>
					<Button
						variant="secondary"
						isIconOnly
						aria-label={te("addCustomColor", "Add custom color")}
						className="wallpaper-upload-tile aspect-[4/3] h-auto w-full min-w-0 overflow-hidden rounded-md p-0 text-muted"
						onPress={() => {
							setDraft(selectedColor || presets[0]);
							setOpen(true);
						}}
					>
						<Plus className="relative z-10 size-4" />
					</Button>
					<ColorPicker.Popover isOpen={open} onOpenChange={setOpen}>
						<Popover.Dialog
							aria-label={te("customColor", "Custom color")}
							className="relative flex w-64 flex-col gap-3 p-3"
						>
							<Button
								isIconOnly
								variant="secondary"
								aria-label={te("closeColorPicker", "Close color picker")}
								className="absolute -right-2 -top-2 z-10 size-6 min-w-0 rounded-full p-0"
								onPress={() => setOpen(false)}
							>
								<X className="size-3.5" />
							</Button>
							<ColorArea
								colorSpace="hsb"
								xChannel="saturation"
								yChannel="brightness"
								className="h-40"
							>
								<ColorArea.Thumb />
							</ColorArea>
							<ColorSlider colorSpace="hsb" channel="hue">
								<ColorSlider.Track>
									<ColorSlider.Thumb />
								</ColorSlider.Track>
							</ColorSlider>
							<div className="flex items-center gap-2">
								<ColorField
									aria-label={te("hexColor", "Hex color")}
									className="min-w-0 flex-1"
								>
									<Input aria-label={te("hexColor", "Hex color")} />
								</ColorField>
								<Button
									onPress={() => {
										const next = [
											...new Set([draft.toLowerCase(), ...custom]),
										].slice(0, 50);
										setCustom(next);
										saveEditorPreferences({ customColors: next });
										onChange(draft);
										setOpen(false);
									}}
								>
									{te("add", "Add")}
								</Button>
							</div>
							{onCreateGradient && (
								<Button
									variant="secondary"
									onPress={() => {
										setOpen(false);
										onCreateGradient();
									}}
								>
									{te("createCustomGradient", "Create custom gradient")}
								</Button>
							)}
						</Popover.Dialog>
					</ColorPicker.Popover>
				</ColorPicker>
				{colors.map((color) => (
					<div key={color} className="group relative min-w-0">
						<ToggleButton
							aria-label={te("backgroundColorValue", "Background color {{color}}", {
								color: color.toUpperCase(),
							})}
							isSelected={value.toLowerCase() === color}
							onChange={() => onChange(color)}
							className={`wallpaper-tile ${tileClassName(value.toLowerCase() === color)}`}
						>
							<span
								className="wallpaper-swatch absolute inset-0 rounded-[inherit]"
								style={{ background: color }}
							/>
						</ToggleButton>
						{!presets.some((preset) => preset.toLowerCase() === color) && (
							<Button
								isIconOnly
								variant="secondary"
								aria-label={te(
									"removeCustomColor",
									"Remove custom color {{color}}",
									{ color: color.toUpperCase() },
								)}
								className="absolute right-0.5 top-0.5 z-10 size-5 min-w-0 rounded-full bg-overlay p-0 text-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
								onPress={() => {
									const next = custom.filter(
										(item) => item.toLowerCase() !== color,
									);
									setCustom(next);
									saveEditorPreferences({ customColors: next });
									if (value.toLowerCase() === color) onChange(presets[0]);
								}}
							>
								<X className="size-3" />
							</Button>
						)}
					</div>
				))}
				{children}
			</WallpaperGlassGrid>
		</>
	);
}
