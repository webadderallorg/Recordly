import { Card } from "@heroui/react";
import { FilmSlate, Image, X } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import type { ExportFormat } from "@/lib/exporter";
import "./EditorExportCard.css";

type Props = {
	label: string;
	title: string;
	titleSuffix?: string;
	format: ExportFormat;
	thumbnail?: string;
	closeLabel: string;
	onClose: () => void;
	autoDismiss?: boolean;
	children: ReactNode;
};

export function ExportActivityCard({
	label,
	title,
	titleSuffix,
	format,
	thumbnail,
	closeLabel,
	onClose,
	autoDismiss,
	children,
}: Props) {
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const close = useEffectEvent(onClose);
	useEffect(() => {
		if (!autoDismiss || hovered || focused) return;
		const timer = window.setTimeout(() => close(), 10000);
		return () => window.clearTimeout(timer);
	}, [autoDismiss, hovered, focused]);

	return createPortal(
		<Card
			className="editor-export-card"
			role="region"
			aria-label={label}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocus={() => setFocused(true)}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
			}}
		>
			<div className="editor-export-card-file">
				<div className="editor-export-card-tile">
					{thumbnail ? (
						<img className="editor-export-card-thumbnail" src={thumbnail} alt="" />
					) : (
						<>
							{format === "gif" ? (
								<Image size={20} aria-hidden />
							) : (
								<FilmSlate size={20} aria-hidden />
							)}
							<span>{format.toUpperCase()}</span>
						</>
					)}
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="editor-export-card-close"
					aria-label={closeLabel}
					title={closeLabel}
					onClick={onClose}
				>
					<X className="size-3.5" aria-hidden />
				</Button>
			</div>
			<div className="editor-export-card-body">
				<p className="flex min-w-0 text-sm font-semibold" title={title}>
					<span className="truncate">
						{titleSuffix ? title.slice(0, -titleSuffix.length) : title}
					</span>
					{titleSuffix && <span className="shrink-0 whitespace-pre">{titleSuffix}</span>}
				</p>
				{children}
			</div>
		</Card>,
		document.body,
	);
}
