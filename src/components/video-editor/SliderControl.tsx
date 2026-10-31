import { Label, Slider } from "@heroui/react";
import { memo } from "react";
interface SliderControlProps {
	label: string;
	ariaLabel?: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
	formatValue: (value: number) => string;
}
export const SliderControl = memo(function SliderControl({
	label,
	ariaLabel,
	value,
	min,
	max,
	step,
	onChange,
	formatValue,
}: SliderControlProps) {
	return (
		<Slider
			aria-label={ariaLabel ?? label}
			value={value}
			minValue={min}
			maxValue={max}
			step={step}
			onChange={(value) => onChange(Number(value))}
			className="my-1 w-full gap-y-2"
		>
			<Label className="text-xs">{label}</Label>
			<Slider.Output className="text-xs font-normal">
				{() => formatValue(value)}
			</Slider.Output>
			<Slider.Track>
				<Slider.Fill />
				<Slider.Thumb />
			</Slider.Track>
		</Slider>
	);
});
