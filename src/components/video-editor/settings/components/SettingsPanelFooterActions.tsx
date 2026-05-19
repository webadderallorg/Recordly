import { Trash as Trash2 } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EditorEffectSection } from "../../types";

interface SettingsPanelFooterActionsProps {
	activeEffectSection: EditorEffectSection;
	selectedClipId?: string | null;
	selectedZoomId?: string | null;
	selectedAudioId?: string | null;
	selectedAnnotationId?: string | null;
	onClipDelete?: (id: string) => void;
	onZoomDelete?: (id: string) => void;
	onAudioDelete?: (id: string) => void;
	onAnnotationDelete?: (id: string) => void;
	tSettings: (key: string, fallback?: string) => string;
}

export function SettingsPanelFooterActions({
	activeEffectSection,
	selectedClipId,
	selectedZoomId,
	selectedAudioId,
	selectedAnnotationId,
	onClipDelete,
	onZoomDelete,
	onAudioDelete,
	onAnnotationDelete,
	tSettings,
}: SettingsPanelFooterActionsProps) {
	const shouldHide =
		(activeEffectSection === "clip" && !selectedClipId) ||
		(activeEffectSection === "zoom" && !selectedZoomId) ||
		(activeEffectSection === "audio" && !selectedAudioId) ||
		(activeEffectSection !== "clip" &&
			activeEffectSection !== "zoom" &&
			activeEffectSection !== "audio" &&
			!selectedAnnotationId);

	return (
		<div
			className={cn(
				"flex-shrink-0 border-t border-foreground/10 bg-editor-panel p-4 pt-3",
				shouldHide && "hidden",
			)}
		>
			{activeEffectSection === "clip" && selectedClipId && (
				<Button
					onClick={() => {
						if (selectedClipId && onClipDelete) onClipDelete(selectedClipId);
					}}
					variant="destructive"
					size="sm"
					className="h-8 w-full gap-2 border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
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
					variant="destructive"
					size="sm"
					className="h-8 w-full gap-2 border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
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
					variant="destructive"
					size="sm"
					className="h-8 w-full gap-2 border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
				>
					<Trash2 className="h-3 w-3" />
					{tSettings("audio.deleteRegion", "Delete Audio")}
				</Button>
			)}
			{selectedAnnotationId && (
				<Button
					onClick={() => {
						if (selectedAnnotationId && onAnnotationDelete) {
							onAnnotationDelete(selectedAnnotationId);
						}
					}}
					variant="destructive"
					size="sm"
					className="h-8 w-full gap-2 border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
				>
					<Trash2 className="h-3 w-3" />
					{tSettings("annotation.delete", "Delete Annotation")}
				</Button>
			)}
		</div>
	);
}
