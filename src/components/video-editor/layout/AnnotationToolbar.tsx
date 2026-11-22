import { Tooltip } from "@heroui/react";
import { EyeSlash } from "@phosphor-icons/react";
import { TextFormatIcon } from "@solar-icons/react/bold/text-format";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import type { AnnotationType } from "../types";

type Props = {
	disabled: boolean;
	onAdd: (type: AnnotationType) => void;
};

function ToolTooltip({ label, children }: { label: string; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLSpanElement>(null);
	return (
		<Tooltip isOpen={open} onOpenChange={setOpen}>
			<span
				ref={triggerRef}
				className="inline-flex"
				onMouseEnter={() => setOpen(true)}
				onMouseLeave={() => setOpen(false)}
				onFocus={(event) => {
					if (event.target.matches(":focus-visible")) setOpen(true);
				}}
				onBlur={() => setOpen(false)}
				onPointerDown={() => setOpen(false)}
			>
				{children}
			</span>
			<Tooltip.Content triggerRef={triggerRef} placement="left" offset={10} className="z-50">
				{label}
			</Tooltip.Content>
		</Tooltip>
	);
}

export function AnnotationToolbar({ disabled, onAdd }: Props) {
	const t = useScopedT("editor");
	const te = useScopedT("editing");
	const toolbarRef = useRef<HTMLDivElement>(null);
	const tools = [
		{ type: "text", label: t("annotations.text") },
		{ type: "blur", label: te("mask", "Mask") },
	] as const;

	return (
		<div className="order-last flex w-11 shrink-0 items-center justify-center">
			<div
				ref={toolbarRef}
				role="toolbar"
				aria-label={te("annotationTools", "Annotation tools")}
				aria-orientation="vertical"
				className="flex flex-col items-center gap-1 rounded-2xl border border-foreground/5 bg-surface p-1 shadow-sm"
				onKeyDown={(event) => {
					if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
					const buttons = Array.from(
						toolbarRef.current?.querySelectorAll<HTMLButtonElement>(
							"button:not(:disabled)",
						) ?? [],
					);
					if (!buttons.length) return;
					event.preventDefault();
					const index = buttons.indexOf(event.target as HTMLButtonElement);
					const next =
						event.key === "Home"
							? 0
							: event.key === "End"
								? buttons.length - 1
								: (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
									buttons.length;
					buttons[next]?.focus();
				}}
			>
				{tools.map(({ type, label }) => (
					<div
						key={type}
						className={
							type === "blur" ? "mt-0.5 border-t border-foreground/10 pt-1.5" : ""
						}
					>
						<ToolTooltip label={label}>
							<Button
								variant="ghost"
								size="icon"
								className="size-8 rounded-xl text-muted-foreground hover:text-foreground"
								disabled={disabled}
								aria-label={label}
								onClick={() => onAdd(type)}
							>
								{type === "text" ? (
									<TextFormatIcon className="size-4" />
								) : (
									<EyeSlash weight="fill" className="size-4" />
								)}
							</Button>
						</ToolTooltip>
					</div>
				))}
			</div>
		</div>
	);
}
