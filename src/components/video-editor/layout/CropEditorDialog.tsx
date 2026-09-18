import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { useI18n } from "@/contexts/I18nContext";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import { CropControl } from "../CropControl";
import type { CropRegion } from "../types";

type Props = {
	open: boolean;
	t: ReturnType<typeof useI18n>["t"];
	videoElement: HTMLVideoElement | null;
	cropRegion: CropRegion;
	setCropRegion: Dispatch<SetStateAction<CropRegion>>;
	aspectRatio: AspectRatio;
	onCancel: () => void;
	onDone: () => void;
};

export function CropEditorDialog({
	open,
	t,
	videoElement,
	cropRegion,
	setCropRegion,
	aspectRatio,
	onCancel,
	onDone,
}: Props) {
	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
			<DialogContent className="max-h-[90vh] w-[90vw] max-w-5xl overflow-auto rounded-2xl border-foreground/10 bg-editor-dialog p-8 shadow-2xl">
				<div className="mb-6 flex items-center justify-between">
					<div>
						<DialogTitle className="text-xl font-bold text-foreground">
							{t("settings.crop.title")}
						</DialogTitle>
						<p className="mt-2 text-sm text-muted-foreground">
							{t("settings.crop.instruction")}
						</p>
					</div>
				</div>
				<CropControl
					videoElement={videoElement}
					cropRegion={cropRegion}
					onCropChange={setCropRegion}
					aspectRatio={aspectRatio}
				/>
				<div className="mt-6 flex justify-end">
					<Button
						onClick={onDone}
						size="lg"
						className="bg-primary text-white hover:bg-primary/90"
					>
						{t("common.actions.done")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
