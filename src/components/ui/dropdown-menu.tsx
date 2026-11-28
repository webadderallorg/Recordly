import { Dropdown, Kbd, Label, Separator } from "@heroui/react";
import { type ComponentProps, type ReactNode } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { SlidingHighlightGroup } from "./sliding-highlight";

export function SlidingDropdownMenu(props: ComponentProps<typeof Dropdown.Menu>) {
	return (
		<SlidingHighlightGroup items='[data-slot="menu-item"]'>
			<Dropdown.Menu {...props} />
		</SlidingHighlightGroup>
	);
}
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
	const t = useScopedT("capture");
	return (
		<Dropdown.Popover
			{...props}
			placement={align === "center" ? "bottom" : `bottom ${align}`}
			offset={sideOffset}
		>
			<SlidingDropdownMenu aria-label={t("actions")}>{children}</SlidingDropdownMenu>
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
	const t = useScopedT("capture");
	return (
		<Dropdown.Item
			{...props}
			isDisabled={disabled}
			textValue={
				props.textValue ??
				(typeof children === "string" ? children : String(props.id ?? t("action")))
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
