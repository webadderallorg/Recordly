import { useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { type CaptionEditSession } from "./playbackTypes";
export function usePreviewCaptionState() {
	const te = useScopedT("editing");

	const captionBoxRef = useRef<HTMLDivElement | null>(null);

	const captionEditInputRef = useRef<HTMLTextAreaElement | null>(null);

	const captionEditSessionRef = useRef<CaptionEditSession | null>(null);

	const [captionEditSession, setCaptionEditSession] = useState<CaptionEditSession | null>(null);
	return {
		te,
		captionBoxRef,
		captionEditInputRef,
		captionEditSessionRef,
		captionEditSession,
		setCaptionEditSession,
	};
}
