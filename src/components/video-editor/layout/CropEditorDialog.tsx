import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { useI18n } from "@/contexts/I18nContext";
import { CropControl } from "../CropControl";
import type { CropRegion } from "../types";

type Props = {
	open: boolean;
	t: ReturnType<typeof useI18n>["t"];
	videoElement: HTMLVideoElement | null;
	cropRegion: CropRegion;
	setCropRegion: Dispatch<SetStateAction<CropRegion>>;
	onCancel: () => void;
	onDone: () => void;
};

export function CropEditorDialog({
	open,
	t,
	videoElement,
	cropRegion,
	setCropRegion,
	onCancel,
	onDone,
}: Props) {
	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
			<DialogContent className="flex h-[90vh] max-h-[900px] w-[90vw] max-w-5xl flex-col gap-0 overflow-hidden p-0">
				<div className="shrink-0 px-6 pb-4 pr-12 pt-6">
					<DialogTitle className="text-xl font-bold text-foreground">
						{t("settings.crop.title")}
					</DialogTitle>
					<p className="mt-2 text-sm text-muted-foreground">
						{t("settings.crop.instruction")}
					</p>
				</div>
				<div className="min-h-0 flex-1 px-6 py-2">
					<CropControl
						videoElement={videoElement}
						cropRegion={cropRegion}
						onCropChange={setCropRegion}
					/>
				</div>
				<div className="flex shrink-0 justify-end border-t border-separator px-6 py-4">
					<Button onClick={onDone} size="lg">
						{t("common.actions.done")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
