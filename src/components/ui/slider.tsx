import { Slider as HeroSlider } from "@heroui/react";
import { forwardRef, type ComponentProps } from "react";

type SliderProps = Omit<
	Omit<ComponentProps<typeof HeroSlider>, "children"> & { children?: import("react").ReactNode },
	"onChange" | "onChangeEnd" | "value" | "defaultValue"
> & {
	value?: number[];
	defaultValue?: number[];
	min?: number;
	max?: number;
	disabled?: boolean;
	onValueChange?: (value: number[]) => void;
	onValueCommit?: (value: number[]) => void;
};
export const Slider = forwardRef<HTMLDivElement, SliderProps>(function Slider(
	{ min, max, disabled, onValueChange, onValueCommit, children, ...props },
	ref,
) {
	return (
		<HeroSlider
			{...props}
			ref={ref}
			minValue={min}
			maxValue={max}
			isDisabled={disabled}
			onChange={(value) => onValueChange?.(Array.isArray(value) ? value : [value])}
			onChangeEnd={(value) => onValueCommit?.(Array.isArray(value) ? value : [value])}
		>
			{children}
			<HeroSlider.Track>
				<HeroSlider.Fill />
				{(props.value ?? props.defaultValue ?? [0]).map((_, index) => (
					<HeroSlider.Thumb key={index} index={index} />
				))}
			</HeroSlider.Track>
		</HeroSlider>
	);
});
