import { Dropdown, Label, Separator, Kbd } from "@heroui/react";
import { type ComponentProps, type ReactNode } from "react";
export function DropdownMenu({
	open,
	modal: _modal,
	...props
}: Omit<ComponentProps<typeof Dropdown>, "isOpen"> & { open?: boolean; modal?: boolean }) {
	return <Dropdown {...props} isOpen={open} />;
}
export function DropdownMenuTrigger({ children }: { asChild?: boolean; children: ReactNode }) {
	return <>{children}</>;
}
export function DropdownMenuContent({
	children,
	align = "start",
	sideOffset = 8,
	...props
}: ComponentProps<typeof Dropdown.Popover> & {
	align?: "start" | "end" | "center";
	sideOffset?: number;
}) {
	return (
		<Dropdown.Popover
			{...props}
			placement={align === "center" ? "bottom" : `bottom ${align}`}
			offset={sideOffset}
		>
			<Dropdown.Menu aria-label="Actions">{children}</Dropdown.Menu>
		</Dropdown.Popover>
	);
}
export function DropdownMenuItem({
	onSelect,
	onClick,
	onAction,
	disabled,
	children,
	...props
}: Omit<ComponentProps<typeof Dropdown.Item>, "onSelect" | "onClick"> & {
	onClick?: () => void;
	onSelect?: (event: Event) => void;
	disabled?: boolean;
}) {
	return (
		<Dropdown.Item
			{...props}
			isDisabled={disabled}
			textValue={
				props.textValue ??
				(typeof children === "string" ? children : String(props.id ?? "Action"))
			}
			onAction={() => {
				onSelect?.(new Event("select"));
				onClick?.();
				onAction?.();
			}}
		>
			{children}
		</Dropdown.Item>
	);
}
export const DropdownMenuGroup = Dropdown.Section;
export const DropdownMenuLabel = Label;
export const DropdownMenuSeparator = Separator;
export const DropdownMenuShortcut = Kbd;
