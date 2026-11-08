import { Label, Slider, Tooltip } from "@heroui/react";
import {
	memo,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useOverlayPosition } from "react-aria";

function SliderValueTooltip({
	thumbRef,
	isOpen,
	value,
	position,
}: {
	thumbRef: RefObject<HTMLDivElement | null>;
	isOpen: boolean;
	value: string;
	position: number;
}) {
	const tooltipRef = useRef<HTMLDivElement>(null);
	const { overlayProps, updatePosition } = useOverlayPosition({
		targetRef: thumbRef,
		overlayRef: tooltipRef,
		placement: "top",
		offset: 8,
		isOpen,
	});
	// Moving a thumb doesn't resize it, so reposition even when the text width stays the same.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the value change moves the anchor.
	useLayoutEffect(() => updatePosition(), [updatePosition, position]);

	return (
		<Tooltip isOpen={isOpen} delay={0} closeDelay={0}>
			<Tooltip.Content
				ref={tooltipRef}
				triggerRef={thumbRef}
				placement="top"
				offset={8}
				style={overlayProps.style}
				className="pointer-events-none text-xs tabular-nums"
			>
				{value}
			</Tooltip.Content>
		</Tooltip>
	);
}
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
	const thumbRef = useRef<HTMLDivElement>(null);
	const pointerActive = useRef(false);
	const [dragValue, setDragValue] = useState<number | null>(null);
	const isPointerDragging = dragValue !== null;
	const endPointerDrag = useCallback(() => {
		pointerActive.current = false;
		setDragValue(null);
	}, []);

	useEffect(() => {
		if (!isPointerDragging) return;
		// Also clean up if the pointer leaves the control or the window loses focus.
		window.addEventListener("pointerup", endPointerDrag);
		window.addEventListener("pointercancel", endPointerDrag);
		window.addEventListener("blur", endPointerDrag);
		return () => {
			window.removeEventListener("pointerup", endPointerDrag);
			window.removeEventListener("pointercancel", endPointerDrag);
			window.removeEventListener("blur", endPointerDrag);
		};
	}, [isPointerDragging, endPointerDrag]);

	// Keep pointer movement fine enough to follow the hand, while settings and keyboard
	// changes retain their configured increments (including integer-only settings).
	const pointerStep = Math.min(step, (max - min) / 1000);
	const formattedValue = formatValue(value);

	return (
		<Slider
			aria-label={ariaLabel ?? label}
			value={dragValue ?? value}
			minValue={min}
			maxValue={max}
			step={isPointerDragging ? pointerStep : step}
			onChange={(nextValue) => {
				const next = Number(nextValue);
				if (pointerActive.current) setDragValue(next);
				const snapped = Number(
					Math.min(
						max,
						Math.max(min, min + Math.round((next - min) / step) * step),
					).toFixed(10),
				);
				if (snapped !== value) onChange(snapped);
			}}
			onChangeEnd={endPointerDrag}
			className="my-1 w-full gap-y-2"
		>
			<Label className="text-xs">{label}</Label>
			<Slider.Track
				onPointerDownCapture={(event) => {
					if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey)
						return;
					pointerActive.current = true;
					setDragValue(value);
				}}
			>
				<Slider.Fill />
				<Slider.Thumb ref={thumbRef}>
					{({ isDragging, isFocusVisible }) => (
						<SliderValueTooltip
							thumbRef={thumbRef}
							isOpen={(isDragging && isPointerDragging) || isFocusVisible}
							value={formattedValue}
							position={dragValue ?? value}
						/>
					)}
				</Slider.Thumb>
			</Slider.Track>
		</Slider>
	);
});
