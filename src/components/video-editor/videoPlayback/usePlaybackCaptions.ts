import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCaptionPreset } from "@/components/video-editor/captionPresets";
import { normalizeCaptionEditText } from "../captionEditing";
import { prepareCaptionLayout } from "../captionLayout";
import {
	getCaptionFontBaseline,
	getCaptionScaledFontSize,
	getCaptionTextMaxWidth,
} from "../captionStyle";
import { useCaptionFont } from "../useCaptionFont";
import type { PlaybackProps } from "./playbackProps";
import type { usePlaybackState } from "./usePlaybackState";
export type usePlaybackCaptionsInput = Pick<
	PlaybackProps & ReturnType<typeof usePlaybackState>,
	| "autoCaptionSettings"
	| "autoCaptions"
	| "overlayRef"
	| "pixiReady"
	| "videoReady"
	| "currentTime"
	| "captionEditSession"
	| "onEditAutoCaption"
	| "clipPlaybackRef"
	| "captionEditSessionRef"
	| "setCaptionEditSession"
	| "captionEditInputRef"
	| "captionBoxRef"
>;
export function usePlaybackCaptions(input: usePlaybackCaptionsInput) {
	const {
		autoCaptionSettings,
		autoCaptions,
		overlayRef,
		pixiReady,
		videoReady,
		currentTime,
		captionEditSession,
		onEditAutoCaption,
		clipPlaybackRef,
		captionEditSessionRef,
		setCaptionEditSession,
		captionEditInputRef,
	} = input;
	const captionFont = useCaptionFont(autoCaptionSettings);

	const measurementContextRef = useRef<CanvasRenderingContext2D | null>(null);
	const getMeasurementContext = useCallback(() => {
		if (!measurementContextRef.current && typeof document !== "undefined") {
			measurementContextRef.current = document.createElement("canvas").getContext("2d");
		}
		return measurementContextRef.current;
	}, []);
	const [overlayWidth, setOverlayWidth] = useState(960);
	useEffect(() => {
		if (!pixiReady || !videoReady) return;
		const overlay = overlayRef.current;
		if (!overlay) return;
		const updateWidth = () => setOverlayWidth(overlay.clientWidth || 960);
		updateWidth();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(updateWidth);
		observer.observe(overlay);
		return () => observer.disconnect();
	}, [overlayRef, pixiReady, videoReady]);

	const preparedCaptionLayout = useMemo(() => {
		if (
			!autoCaptionSettings?.enabled ||
			!captionFont.ready ||
			autoCaptions.length === 0 ||
			typeof document === "undefined"
		) {
			return null;
		}

		const fontSize = getCaptionScaledFontSize(
			autoCaptionSettings.fontSize,
			overlayWidth,
			autoCaptionSettings.maxWidth,
		);
		const maxTextWidthPx = getCaptionTextMaxWidth(
			overlayWidth,
			autoCaptionSettings.maxWidth,
			fontSize,
			autoCaptionSettings.style,
		);
		const measurementContext = getMeasurementContext();
		if (!measurementContext) {
			return null;
		}

		measurementContext.font = `${getCaptionPreset(autoCaptionSettings.style).fontWeight} ${fontSize}px ${captionFont.fontFamily}`;

		return prepareCaptionLayout({
			fontBaselinePx: getCaptionFontBaseline(fontSize, measurementContext.measureText("Hg")),
			cues: autoCaptions,
			settings: autoCaptionSettings,
			maxWidthPx: maxTextWidthPx,
			measureText: (text) => measurementContext.measureText(text).width,
		});
	}, [
		autoCaptionSettings,
		autoCaptions,
		overlayWidth,
		getMeasurementContext,
		captionFont.fontFamily,
		captionFont.ready,
	]);

	const activeCaptionLayout = useMemo(
		() => preparedCaptionLayout?.(Math.round(currentTime * 1000)) ?? null,
		[preparedCaptionLayout, currentTime],
	);

	const isCaptionEditing = captionEditSession !== null;

	const captionEditDraft = captionEditSession?.draft ?? "";

	const captionEditTargetId = captionEditSession?.target.id ?? null;

	const captionEditTextMetrics = useMemo(() => {
		if (
			!captionEditSession ||
			!autoCaptionSettings ||
			!captionFont.ready ||
			typeof document === "undefined"
		) {
			return null;
		}

		const fontSize = getCaptionScaledFontSize(
			autoCaptionSettings.fontSize,
			overlayWidth,
			autoCaptionSettings.maxWidth,
		);
		const maxTextWidthPx = getCaptionTextMaxWidth(
			overlayWidth,
			autoCaptionSettings.maxWidth,
			fontSize,
			autoCaptionSettings.style,
		);
		const measurementContext = getMeasurementContext();
		if (!measurementContext) {
			return null;
		}

		measurementContext.font = `${getCaptionPreset(autoCaptionSettings.style).fontWeight} ${fontSize}px ${captionFont.fontFamily}`;
		const measuredWidth = Math.max(
			...captionEditSession.draft
				.split(/\r?\n/)
				.map((line) => measurementContext.measureText(line || " ").width),
		);

		return {
			fontSize,
			maxTextWidthPx,
			widthPx: Math.ceil(Math.min(maxTextWidthPx, Math.max(fontSize * 2, measuredWidth + 2))),
		};
	}, [
		autoCaptionSettings,
		captionEditSession,
		overlayWidth,
		getMeasurementContext,
		captionFont.fontFamily,
		captionFont.ready,
	]);

	const captionEditSizeKey = captionEditSession
		? `${captionEditTextMetrics?.widthPx ?? 0}:${captionEditDraft}`
		: "";

	const beginCaptionEdit = useCallback(() => {
		if (!activeCaptionLayout?.editTarget || !onEditAutoCaption) {
			return;
		}

		clipPlaybackRef.current?.pause();
		const nextSession = {
			target: activeCaptionLayout.editTarget,
			draft: activeCaptionLayout.editTarget.text,
		};
		captionEditSessionRef.current = nextSession;
		setCaptionEditSession(nextSession);
	}, [
		activeCaptionLayout,
		onEditAutoCaption,
		clipPlaybackRef,
		captionEditSessionRef,
		setCaptionEditSession,
	]);

	const commitCaptionEdit = useCallback(() => {
		const session = captionEditSessionRef.current;
		if (!session || !onEditAutoCaption) {
			captionEditSessionRef.current = null;
			setCaptionEditSession(null);
			return;
		}

		const normalizedDraft = normalizeCaptionEditText(session.draft);
		captionEditSessionRef.current = null;
		if (!normalizedDraft) {
			setCaptionEditSession(null);
			return;
		}

		if (normalizedDraft !== normalizeCaptionEditText(session.target.text)) {
			onEditAutoCaption(session.target, session.draft);
		}
		setCaptionEditSession(null);
	}, [onEditAutoCaption, captionEditSessionRef, setCaptionEditSession]);

	const cancelCaptionEdit = useCallback(() => {
		captionEditSessionRef.current = null;
		setCaptionEditSession(null);
	}, [captionEditSessionRef, setCaptionEditSession]);

	useEffect(() => {
		if (!captionEditTargetId) {
			return;
		}

		const frame = requestAnimationFrame(() => {
			const input = captionEditInputRef.current;
			if (!input) {
				return;
			}

			input.focus();
			const cursorPosition = input.value.length;
			input.setSelectionRange(cursorPosition, cursorPosition);
		});

		return () => cancelAnimationFrame(frame);
	}, [captionEditTargetId, captionEditInputRef]);

	useEffect(() => {
		if (!captionEditSizeKey) {
			return;
		}

		const frame = requestAnimationFrame(() => {
			const input = captionEditInputRef.current;
			if (!input) {
				return;
			}

			input.style.height = "auto";
			input.style.height = `${input.scrollHeight}px`;
		});

		return () => cancelAnimationFrame(frame);
	}, [captionEditSizeKey, captionEditInputRef]);

	return {
		captionFontReady: captionFont.ready,
		activeCaptionLayout,
		isCaptionEditing,
		captionEditDraft,
		captionEditTargetId,
		captionEditTextMetrics,
		captionEditSizeKey,
		beginCaptionEdit,
		commitCaptionEdit,
		cancelCaptionEdit,
	};
}
