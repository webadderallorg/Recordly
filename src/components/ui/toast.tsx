import { toast as heroToast, Toast } from "@heroui/react";
import { isValidElement, type ReactNode } from "react";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { Button } from "@/components/ui/button";
import { translate } from "@/contexts/I18nContext";
import { copyTextToClipboard } from "@/lib/clipboard";

type Options = {
	id?: string | number;
	description?: ReactNode;
	duration?: number;
	action?: { label: ReactNode; onClick: () => void };
	onDismiss?: () => void;
	copyable?: boolean;
};
type Variant = "default" | "accent" | "success" | "warning" | "danger";
const ids = new Map<string | number, string>();

function plainText(value: ReactNode): string {
	if (typeof value === "string" || typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.map(plainText).join("");
	if (isValidElement<{ children?: ReactNode }>(value)) return plainText(value.props.children);
	return "";
}

// Keep existing callers compatible while HeroUI owns the queue and presentation.
function notify(title: ReactNode, options: Options = {}, variant: Variant = "default") {
	const errorText = [plainText(title), plainText(options.description)]
		.filter(Boolean)
		.join("\n\n");
	const action = options.action;
	const reportable = variant === "danger" && Boolean(errorText);
	const actionProps = action
		? { children: action.label, onPress: action.onClick }
		: reportable && options.copyable !== false
			? {
					children: translate("common.clipboard.copy", "Copy"),
					onPress: () => {
						void copyTextToClipboard(errorText).then(
							() =>
								heroToast.success(
									translate("common.clipboard.errorCopied", "Error copied"),
								),
							() =>
								heroToast.danger(
									translate(
										"common.clipboard.errorCopyFailed",
										"Could not copy error",
									),
									{ description: errorText },
								),
						);
					},
				}
			: undefined;
	// Error diagnostics can contain dozens of lines. Keep the report action outside
	// their scroll area so it remains reachable on a small viewport.
	const notificationTitle =
		variant === "danger" &&
		(plainText(title).length > 160 || plainText(title).includes("\n")) ? (
			<span
				className="block max-h-16 overflow-y-auto whitespace-pre-wrap break-words"
				tabIndex={0}
				data-error-title
			>
				{title}
			</span>
		) : (
			title
		);
	const nativeOptions = {
		variant,
		description: reportable ? (
			<div className="flex flex-col items-start gap-2">
				<div className="flex items-center gap-2" data-error-actions>
					<ErrorReportButton error={errorText} context="notification" compact />
					{actionProps && (
						<Button {...actionProps} size="sm" className="h-8 shrink-0 text-xs" />
					)}
				</div>
				{options.description && (
					<div
						className="max-h-[min(10rem,30vh)] w-full overflow-y-auto whitespace-pre-wrap break-words"
						tabIndex={0}
						role="region"
						aria-label={translate("ui.technicalDetails", "Technical details")}
						data-error-diagnostics
					>
						{options.description}
					</div>
				)}
			</div>
		) : (
			options.description
		),
		timeout:
			options.duration === Infinity
				? 0
				: (options.duration ?? (variant === "danger" ? 0 : 4000)),
		onClose: () => {
			if (options.id !== undefined) ids.delete(options.id);
			options.onDismiss?.();
		},
		actionProps: reportable ? undefined : actionProps,
	};
	const previous = options.id === undefined ? undefined : ids.get(options.id);
	const key = previous
		? heroToast.update(previous, notificationTitle, nativeOptions)
		: heroToast(notificationTitle, nativeOptions);
	if (options.id !== undefined) ids.set(options.id, key);
	return key;
}
export const toast = Object.assign(notify, {
	success: (message: ReactNode, options?: Options) => notify(message, options, "success"),
	error: (message: ReactNode, options?: Options) => notify(message, options, "danger"),
	info: (message: ReactNode, options?: Options) => notify(message, options, "accent"),
	warning: (message: ReactNode, options?: Options) => notify(message, options, "warning"),
	dismiss: (id?: string | number) => {
		if (id === undefined) {
			heroToast.clear();
			ids.clear();
		} else heroToast.close(ids.get(id) ?? String(id));
	},
});
export function Toaster({ className }: { className?: string }) {
	return <Toast.Provider placement="bottom end" className={className} />;
}
