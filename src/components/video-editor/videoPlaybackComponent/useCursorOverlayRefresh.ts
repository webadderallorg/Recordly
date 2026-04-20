import { useEffect } from "react";
import { extensionHost } from "@/lib/extensions";
import { preloadCursorAssets } from "../videoPlayback/cursorRenderer";
import { getContributedCursorStylesSignature, type VideoPlaybackRuntimeRefs } from "./shared";

interface UseCursorOverlayRefreshParams {
	refs: VideoPlaybackRuntimeRefs;
	cursorStyle: string;
	cursorSize: number;
	cursorSmoothing: number;
	cursorMotionBlur: number;
	cursorClickBounce: number;
	cursorClickBounceDuration: number;
	cursorSway: number;
}

export function useCursorOverlayRefresh({
	refs,
	cursorStyle,
	cursorSize,
	cursorSmoothing,
	cursorMotionBlur,
	cursorClickBounce,
	cursorClickBounceDuration,
	cursorSway,
}: UseCursorOverlayRefreshParams) {
	useEffect(() => {
		const overlay = refs.cursorOverlayRef.current;
		if (!overlay) return;

		let cancelled = false;
		overlay.setDotRadius(6 * cursorSize);
		overlay.setSmoothingFactor(cursorSmoothing);
		overlay.setMotionBlur(cursorMotionBlur);
		overlay.setClickBounce(cursorClickBounce);
		overlay.setClickBounceDuration(cursorClickBounceDuration);
		overlay.setSway(cursorSway);

		void (async () => {
			try {
				await preloadCursorAssets();
			} catch (error) {
				console.warn("Failed to refresh cursor assets for preview:", error);
				return;
			}

			if (cancelled || refs.cursorOverlayRef.current !== overlay) return;
			overlay.setStyle(cursorStyle);
			overlay.reset();
		})();

		return () => {
			cancelled = true;
		};
	}, [cursorClickBounce, cursorClickBounceDuration, cursorMotionBlur, cursorSize, cursorSmoothing, cursorStyle, cursorSway, refs.cursorOverlayRef]);

	useEffect(() => {
		let cancelled = false;
		let signature = getContributedCursorStylesSignature();

		const refreshSelectedCursorStyle = async () => {
			const overlay = refs.cursorOverlayRef.current;
			if (!overlay) return;

			try {
				await preloadCursorAssets();
			} catch (error) {
				console.warn("Failed to refresh contributed cursor styles in preview:", error);
				return;
			}

			if (cancelled || refs.cursorOverlayRef.current !== overlay) return;
			overlay.setStyle(refs.cursorStyleRef.current);
			overlay.reset();
		};

		const unsubscribe = extensionHost.onChange(() => {
			const nextSignature = getContributedCursorStylesSignature();
			if (nextSignature === signature) return;
			signature = nextSignature;
			void refreshSelectedCursorStyle();
		});

		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [refs.cursorOverlayRef, refs.cursorStyleRef]);
}