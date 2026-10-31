import { Select as HeroSelect, ListBox, Label, Separator } from "@heroui/react";
import { type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
export function Select({
	value,
	defaultValue,
	onValueChange,
	disabled,
	children,
	...props
}: Omit<ComponentProps<typeof HeroSelect>, "value" | "defaultValue" | "onChange" | "children"> & {
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<HeroSelect
			{...props}
			aria-label={props["aria-label"] ?? "Select option"}
			value={value || null}
			defaultValue={defaultValue}
			onChange={(key) => onValueChange?.(String(key ?? ""))}
			isDisabled={disabled}
		>
			{children}
		</HeroSelect>
	);
}
export function SelectTrigger({
	children,
	...props
}: Omit<ComponentProps<typeof HeroSelect.Trigger>, "children"> & {
	children?: import("react").ReactNode;
}) {
	return (
		<HeroSelect.Trigger {...props}>
			{children}
			<HeroSelect.Indicator />
		</HeroSelect.Trigger>
	);
}
export function SelectValue({
	placeholder,
	...props
}: ComponentProps<typeof HeroSelect.Value> & { placeholder?: string }) {
	return (
		<HeroSelect.Value {...props}>
			{({ selectedText }) => selectedText || placeholder || "Select"}
		</HeroSelect.Value>
	);
}
export function SelectContent({
	children,
	className,
	...props
}: ComponentProps<typeof HeroSelect.Popover>) {
	return (
		<HeroSelect.Popover {...props} className={cn("max-h-80", className)}>
			<ListBox>{children}</ListBox>
		</HeroSelect.Popover>
	);
}
export function SelectItem({
	value,
	disabled,
	children,
	...props
}: Omit<
	Omit<ComponentProps<typeof ListBox.Item>, "children"> & {
		children?: import("react").ReactNode;
	},
	"id"
> & { value: string; disabled?: boolean }) {
	return (
		<ListBox.Item
			{...props}
			id={value}
			textValue={props.textValue ?? (typeof children === "string" ? children : value)}
			isDisabled={disabled}
		>
			{children}
			<ListBox.ItemIndicator />
		</ListBox.Item>
	);
}
export const SelectGroup = ListBox.Section;
export const SelectLabel = Label;
export const SelectSeparator = Separator;
