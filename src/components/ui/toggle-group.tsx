import { ToggleButtonGroup, ToggleButton } from "@heroui/react";
import { type ComponentProps } from "react";
type Props = Omit<ComponentProps<typeof ToggleButtonGroup>, "onSelectionChange" | "size"> & {
	value?: string | string[];
	defaultValue?: string | string[];
	disabled?: boolean;
	size?: "default" | "sm" | "lg";
	variant?: "default" | "outline";
} & (
		| { type: "single"; onValueChange?: (value: string) => void }
		| { type: "multiple"; onValueChange?: (value: string[]) => void }
	);
const keys = (value?: string | string[]) =>
	value === undefined ? undefined : Array.isArray(value) ? value : value ? [value] : [];
export function ToggleGroup({
	type,
	value,
	defaultValue,
	onValueChange,
	disabled,
	size,
	variant: _variant,
	...props
}: Props) {
	return (
		<ToggleButtonGroup
			{...props}
			selectionMode={type}
			selectedKeys={keys(value)}
			defaultSelectedKeys={keys(defaultValue)}
			isDisabled={disabled}
			size={size === "default" ? "md" : size}
			onSelectionChange={(selection) => {
				const values = Array.from(selection, String);
				if (type === "single")
					(onValueChange as ((v: string) => void) | undefined)?.(values[0] ?? "");
				else (onValueChange as ((v: string[]) => void) | undefined)?.(values);
			}}
		/>
	);
}
export function ToggleGroupItem({
	value,
	disabled,
	...props
}: Omit<ComponentProps<typeof ToggleButton>, "id"> & {
	value: string;
	disabled?: boolean;
	title?: string;
}) {
	return <ToggleButton {...props} id={value} isDisabled={disabled} />;
}
