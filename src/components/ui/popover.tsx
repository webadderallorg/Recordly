import { Popover as HeroPopover } from "@heroui/react";
import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useUNSAFE_PortalContext } from "react-aria";
const ModalContext = createContext(true);
const CloseContext = createContext<(() => void) | undefined>(undefined);
export function Popover({
	open,
	defaultOpen,
	onOpenChange,
	modal = true,
	children,
	...props
}: Omit<ComponentProps<typeof HeroPopover>, "isOpen"> & { open?: boolean; modal?: boolean }) {
	const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
	const changeOpen = (value: boolean) => {
		setInternalOpen(value);
		onOpenChange?.(value);
	};
	return (
		<ModalContext.Provider value={modal}>
			<CloseContext.Provider value={() => changeOpen(false)}>
				<HeroPopover {...props} isOpen={open ?? internalOpen} onOpenChange={changeOpen}>
					{children}
				</HeroPopover>
			</CloseContext.Provider>
		</ModalContext.Provider>
	);
}
export function PopoverTrigger({ children }: { asChild?: boolean; children: ReactNode }) {
	return <>{children}</>;
}
type ContentProps = Omit<ComponentProps<typeof HeroPopover.Content>, "children"> & {
	children: ReactNode;
	align?: "start" | "center" | "end";
	side?: "top" | "bottom" | "left" | "right";
	alignOffset?: number;
	sideOffset?: number;
	avoidCollisions?: boolean;
	collisionPadding?: number;
	usePortal?: boolean;
	unstyled?: boolean;
	animated?: boolean;
};
export function PopoverContent({
	children,
	className,
	side = "bottom",
	align = "center",
	sideOffset = 8,
	alignOffset = 0,
	avoidCollisions = true,
	collisionPadding = 12,
	usePortal = true,
	unstyled: _unstyled,
	animated: _animated,
	...props
}: ContentProps) {
	const modal = useContext(ModalContext);
	const scopedPortalContainer = useUNSAFE_PortalContext().getContainer?.();
	const close = useContext(CloseContext);
	const placement = (align === "center" ? side : `${side} ${align}`) as ComponentProps<
		typeof HeroPopover.Content
	>["placement"];
	return (
		<HeroPopover.Content
			{...props}
			placement={placement}
			offset={sideOffset}
			crossOffset={alignOffset}
			shouldFlip={avoidCollisions}
			containerPadding={collisionPadding}
			isNonModal={!modal}
			UNSTABLE_portalContainer={
				usePortal
					? undefined
					: (scopedPortalContainer ?? document.getElementById("root") ?? undefined)
			}
			className="max-w-[calc(100vw-24px)]"
		>
			<HeroPopover.Dialog
				aria-label={props["aria-label"] ?? "Options"}
				className={cn("max-w-full max-h-[min(80vh,640px)] overflow-y-auto p-4", className)}
			>
				<div
					className="contents"
					onKeyDownCapture={(event) => {
						// Choice groups can consume Escape; dismiss before their keyboard handler.
						// A nested portalled menu handles its own Escape first.
						if (
							event.key === "Escape" &&
							!event.defaultPrevented &&
							!props.isKeyboardDismissDisabled &&
							event.currentTarget.contains(event.target as Node)
						) {
							event.preventDefault();
							event.stopPropagation();
							close?.();
						}
					}}
				>
					{children}
				</div>
			</HeroPopover.Dialog>
		</HeroPopover.Content>
	);
}
export const PopoverArrow = HeroPopover.Arrow;
