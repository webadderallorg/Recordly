import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useScopedT } from "../../contexts/I18nContext";
import type { WebcamMaskPoint } from "./types";
import { WebcamMaskPenEditor } from "./WebcamMaskPenEditor";

interface WebcamMaskEditorDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	points: WebcamMaskPoint[];
	mirrored?: boolean;
	previewSrc?: string | null;
	previewCurrentTime?: number;
	previewPlaying?: boolean;
	previewTimeOffsetMs?: number | null;
	onPointsChange: (points: WebcamMaskPoint[]) => void;
}

/**
 * Full-size modal wrapper around the pen mask editor so fine handle work
 * isn't cramped into the settings sidebar. Edits flow through the same
 * onPointsChange callback as the inline editor.
 */
export function WebcamMaskEditorDialog({
	open,
	onOpenChange,
	points,
	mirrored,
	previewSrc,
	previewCurrentTime,
	previewPlaying,
	previewTimeOffsetMs,
	onPointsChange,
}: WebcamMaskEditorDialogProps) {
	const tSettings = useScopedT("settings");

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-4xl">
				<DialogHeader>
					<DialogTitle>
						{tSettings("effects.webcamMaskEditorTitle", "Edit mask")}
					</DialogTitle>
					<DialogDescription>
						{tSettings(
							"effects.webcamMaskEditorDescription",
							"Click empty space to add a point, click the outline to insert one, drag handles to curve, double-click a point to toggle smooth, Delete removes the selected point",
						)}
					</DialogDescription>
				</DialogHeader>
				<WebcamMaskPenEditor
					points={points}
					mirrored={mirrored}
					previewSrc={previewSrc}
					previewCurrentTime={previewCurrentTime}
					previewPlaying={previewPlaying}
					previewTimeOffsetMs={previewTimeOffsetMs}
					onPointsChange={onPointsChange}
				/>
			</DialogContent>
		</Dialog>
	);
}
