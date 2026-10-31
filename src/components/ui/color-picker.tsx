import {
	ColorArea,
	ColorField,
	ColorPicker,
	ColorSlider,
	ColorSwatch,
	ColorSwatchPicker,
	Input,
	Label,
	Popover,
} from "@heroui/react";
import { Button } from "./button";

type PaletteProps = {
	color?: string;
	colors: readonly string[];
	onChange: (color: { hex: string }) => void;
	style?: React.CSSProperties;
};
export function ColorPalette({ color = "#000000", colors, onChange }: PaletteProps) {
	return (
		<div className="flex flex-col gap-3">
			<ColorSwatchPicker
				aria-label="Colors"
				value={color}
				onChange={(value) => onChange({ hex: value.toString("hex") })}
			>
				{colors.map((color) => (
					<ColorSwatchPicker.Item key={color} color={color}>
						<ColorSwatchPicker.Swatch className="ring-1 ring-inset ring-foreground/10" />
						<ColorSwatchPicker.Indicator />
					</ColorSwatchPicker.Item>
				))}
			</ColorSwatchPicker>
		</div>
	);
}
export function ColorControl({
	value,
	onChange,
	label,
	colors,
	compact = false,
	onClear,
}: {
	value: string;
	onChange: (value: string) => void;
	label: string;
	colors?: readonly string[];
	compact?: boolean;
	onClear?: () => void;
}) {
	return (
		<ColorPicker
			value={value === "transparent" ? "#00000000" : value}
			onChange={(color) => onChange(color.toString("hex"))}
		>
			<Button
				variant="secondary"
				aria-label={label}
				className="h-9 min-w-0 max-w-full gap-2 px-3 text-[13px]"
			>
				<ColorSwatch size="sm" />
				<span className="truncate">
					{compact ? (value === "transparent" ? "None" : value.toUpperCase()) : label}
				</span>
			</Button>
			<ColorPicker.Popover>
				<Popover.Dialog aria-label={label} className="flex w-64 flex-col gap-4 p-4">
					<ColorArea colorSpace="hsb" xChannel="saturation" yChannel="brightness">
						<ColorArea.Thumb />
					</ColorArea>
					<ColorSlider colorSpace="hsb" channel="hue">
						<ColorSlider.Track>
							<ColorSlider.Thumb />
						</ColorSlider.Track>
					</ColorSlider>
					{colors && (
						<ColorSwatchPicker aria-label="Preset colors">
							{colors.map((color) => (
								<ColorSwatchPicker.Item key={color} color={color}>
									<ColorSwatchPicker.Swatch />
									<ColorSwatchPicker.Indicator />
								</ColorSwatchPicker.Item>
							))}
						</ColorSwatchPicker>
					)}
					<ColorField>
						<Label>Hex color</Label>
						<Input />
					</ColorField>
					{onClear && (
						<Button variant="ghost" onClick={onClear}>
							Clear background
						</Button>
					)}
				</Popover.Dialog>
			</ColorPicker.Popover>
		</ColorPicker>
	);
}
