import { Card } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Trash as Trash2 } from "@/components/ui/icons";
import type { EditorEffectSection } from "@/components/video-editor/types";
import { cn } from "@/lib/utils";

import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";
import { useSettingsTranslations } from "./useSettingsTranslations";

export const settingsPanelShellKeys = [
	"activeEffectSection",
	"selectedZoomId",
	"onZoomDelete",
	"selectedClipId",
	"onClipDelete",
	"selectedAudioId",
	"onAudioDelete",
	"selectedAnnotationId",
	"onAnnotationDelete",
] as const;
type Props = Pick<ResolvedSettingsPanelProps, (typeof settingsPanelShellKeys)[number]> & {
	activeEffectSection: EditorEffectSection;
	children: React.ReactNode;
};
export function SettingsPanelShell(props: Props) {
	const {
		activeEffectSection,
		selectedZoomId,
		onZoomDelete,
		selectedClipId,
		onClipDelete,
		selectedAudioId,
		onAudioDelete,
		selectedAnnotationId,
		onAnnotationDelete,
	} = props;
	const { tSettings } = useSettingsTranslations();
	const { children } = props;
	const scrollRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		if (activeEffectSection && scrollRef.current) scrollRef.current.scrollTop = 0;
	}, [activeEffectSection]);
	return (
		<Card className="settings-panel flex min-h-0 flex-1 flex-col gap-0 overflow-hidden rounded-none bg-transparent p-0 shadow-none">
			<div
				ref={scrollRef}
				className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar px-5 pb-6 pt-1 scroll-shadow scroll-shadow--vertical scroll-shadow--fade scroll-shadow--hide-scrollbar [--scroll-shadow-size:16px]"
				data-scroll-shadow-mode="auto"
			>
				{activeEffectSection === "settings" ? (
					children
				) : (
					<AnimatePresence mode="wait" initial={false}>
						<motion.div
							key={activeEffectSection}
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.18, ease: "easeOut" }}
						>
							{children}
						</motion.div>
					</AnimatePresence>
				)}
			</div>

			<div
				className={cn(
					"shrink-0 px-5 py-4",
					(() => {
						if (activeEffectSection === "clip" && selectedClipId) return false;
						if (activeEffectSection === "zoom" && selectedZoomId) return false;
						if (activeEffectSection === "audio" && selectedAudioId) return false;
						if (selectedAnnotationId) return false; // Annotation editor handles its own but let's see
						return true;
					})() && "hidden",
				)}
			>
				{activeEffectSection === "clip" && selectedClipId && (
					<Button
						onClick={() => {
							if (selectedClipId && onClipDelete) onClipDelete(selectedClipId);
						}}
						variant="destructive-soft"
						size="sm"
						className="h-9 w-full gap-2 text-xs"
					>
						<Trash2 className="h-3 w-3" />
						{tSettings("clip.delete", "Delete Clip")}
					</Button>
				)}
				{activeEffectSection === "zoom" && selectedZoomId && (
					<Button
						onClick={() => {
							if (selectedZoomId && onZoomDelete) onZoomDelete(selectedZoomId);
						}}
						variant="destructive-soft"
						size="sm"
						className="h-9 w-full gap-2 text-xs"
					>
						<Trash2 className="h-3 w-3" />
						{tSettings("zoom.deleteZoom", "Delete Zoom")}
					</Button>
				)}
				{activeEffectSection === "audio" && selectedAudioId && (
					<Button
						onClick={() => {
							if (selectedAudioId && onAudioDelete) onAudioDelete(selectedAudioId);
						}}
						variant="destructive-soft"
						size="sm"
						className="h-9 w-full gap-2 text-xs"
					>
						<Trash2 className="h-3 w-3" />
						{tSettings("audio.deleteRegion", "Delete Audio")}
					</Button>
				)}
				{selectedAnnotationId && (
					<Button
						onClick={() => {
							if (selectedAnnotationId && onAnnotationDelete)
								onAnnotationDelete(selectedAnnotationId);
						}}
						variant="destructive-soft"
						size="sm"
						className="h-9 w-full gap-2 text-xs"
					>
						<Trash2 className="h-3 w-3" />
						{tSettings("annotation.delete", "Delete Annotation")}
					</Button>
				)}
			</div>
		</Card>
	);
}
