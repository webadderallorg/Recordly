import { Modal, Description } from "@heroui/react";
import { type ComponentProps, type ReactNode } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
export function Dialog({
	open,
	defaultOpen,
	...props
}: Omit<ComponentProps<typeof Modal>, "isOpen"> & { open?: boolean; defaultOpen?: boolean }) {
	return <Modal {...props} isOpen={open} defaultOpen={defaultOpen} />;
}
export function DialogTrigger({ children }: { asChild?: boolean; children: ReactNode }) {
	return <>{children}</>;
}
export function DialogContent({
	children,
	className,
	...props
}: Omit<ComponentProps<typeof Modal.Dialog>, "children"> & {
	children?: import("react").ReactNode;
}) {
	const { t } = useI18n();
	return (
		<Modal.Backdrop isDismissable>
			<Modal.Container size="lg" placement="center">
				<Modal.Dialog {...props} className={cn("w-full gap-4", className)}>
					<Modal.CloseTrigger aria-label={t("common.actions.close", "Close")} />
					{children}
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
export const DialogHeader = Modal.Header;
export const DialogFooter = Modal.Footer;
export const DialogTitle = Modal.Heading;
export const DialogDescription = Description;
export const DialogClose = Modal.CloseTrigger;
