import { useCallback, useEffect, useRef, useState } from "react";
import { extensionHost } from "@/lib/extensions";
import type { ExportEncodingMode } from "@/lib/exporter/types";
import { matchesShortcut, type ShortcutBinding } from "@/lib/shortcuts";
import { saveEditorPreferences } from "../editorPreferences";
import { resolveVideoUrl } from "../projectPersistence";
import type { CursorTelemetryPoint, EditorEffectSection } from "../types";
import type { useEditorPreferences } from "./useEditorPreferences";
import type { useEditorRegions } from "./useEditorRegions";
import type { useEditorCaptions } from "./useEditorCaptions";
import type { useEditorHistory } from "./useEditorHistory";
import type { useEditorExport } from "./useEditorExport";

type Prefs = ReturnType<typeof useEditorPreferences>;
type Regions = ReturnType<typeof useEditorRegions>;
type Captions = ReturnType<typeof useEditorCaptions>;

interface SmokeExportConfig {
	enabled: boolean;
	encodingMode?: string;
}

interface UseEditorSideEffectsParams {
	prefs: Prefs;
	regions: Regions;
	captions: Captions;
	history: ReturnType<typeof useEditorHistory>;
	exp: ReturnType<typeof useEditorExport>;
	videoPath: string | null;
	currentSourcePath: string | null;
	loading: boolean;
	isPreviewReady: boolean;
	duration: number;
	error: string | null;
	cursorTelemetry: CursorTelemetryPoint[];
	normalizedCursorTelemetry: CursorTelemetryPoint[];
	isMac: boolean;
	shortcuts: { playPause: ShortcutBinding };
	smokeExportConfig: SmokeExportConfig;
	videoPlaybackRef: React.RefObject<{
		video?: HTMLVideoElement | null;
		play: () => Promise<void>;
		pause: () => void;
	} | null>;
	setAppPlatform: (v: string) => void;
	setSourceAudioFallbackPaths: (v: string[]) => void;
	setAutoSuggestZoomsTrigger: React.Dispatch<React.SetStateAction<number>>;
}

export function useEditorSideEffects({
	prefs,
	regions,
	captions,
	history,
	exp,
	videoPath,
	currentSourcePath,
	loading,
	isPreviewReady,
	duration,
	error,
	cursorTelemetry,
	normalizedCursorTelemetry,
	isMac,
	shortcuts,
	smokeExportConfig,
	videoPlaybackRef,
	setAppPlatform,
	setSourceAudioFallbackPaths,
	setAutoSuggestZoomsTrigger,
}: UseEditorSideEffectsParams) {
	const pendingFreshRecordingAutoSuggestTimeoutRef = useRef<number | null>(null);
	const pendingFreshRecordingAutoSuggestTelemetryCountRef = useRef(0);

	// Platform detection
	useEffect(() => {
		void window.electronAPI?.getPlatform?.()?.then((platform: string) =>
			setAppPlatform(platform),
		);
	}, [setAppPlatform]);

	// Reset auto-suggested refs on mount
	useEffect(() => {
		regions.autoSuggestedVideoPathRef.current = null;
		pendingFreshRecordingAutoSuggestTelemetryCountRef.current = 0;
		if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
			window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
			pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Auto-activate builtin extensions
	useEffect(() => {
		extensionHost.autoActivateBuiltins();
	}, []);

	// Load source audio fallback paths
	useEffect(() => {
		let cancelled = false;
		setSourceAudioFallbackPaths([]);
		if (!currentSourcePath) return () => { cancelled = true; };
		void (async () => {
			try {
				const result =
					await window.electronAPI.getVideoAudioFallbackPaths(currentSourcePath);
				if (cancelled) return;
				setSourceAudioFallbackPaths(result.success ? (result.paths ?? []) : []);
			} catch {
				if (!cancelled) setSourceAudioFallbackPaths([]);
			}
		})();
		return () => { cancelled = true; };
	}, [currentSourcePath, setSourceAudioFallbackPaths]);

	// Resolve webcam video URL
	useEffect(() => {
		let cancelled = false;
		if (!prefs.webcam.sourcePath) {
			prefs.setResolvedWebcamVideoUrl(null);
			return;
		}
		prefs.setResolvedWebcamVideoUrl(null);
		void resolveVideoUrl(prefs.webcam.sourcePath).then((url) => {
			if (!cancelled) prefs.setResolvedWebcamVideoUrl(url);
		});
		return () => { cancelled = true; };
	}, [prefs.webcam.sourcePath, prefs.setResolvedWebcamVideoUrl]);

	// Reset auto-zoom ref when preference is disabled
	useEffect(() => {
		if (!prefs.autoApplyFreshRecordingAutoZooms) {
			regions.pendingFreshRecordingAutoZoomPathRef.current = null;
		}
	}, [prefs.autoApplyFreshRecordingAutoZooms]);

	// Persist whisper paths
	useEffect(() => {
		saveEditorPreferences({
			whisperExecutablePath: captions.whisperExecutablePath,
			whisperModelPath: captions.whisperModelPath,
		});
	}, [captions.whisperExecutablePath, captions.whisperModelPath]);

	// Auto-zoom suggestion
	useEffect(() => {
		if (
			!videoPath ||
			loading ||
			!isPreviewReady ||
			duration <= 0 ||
			regions.zoomRegions.length > 0 ||
			normalizedCursorTelemetry.length < 2
		) {
			if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
				window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
				pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
			}
			return;
		}
		if (regions.pendingFreshRecordingAutoZoomPathRef.current !== videoPath) return;
		if (regions.autoSuggestedVideoPathRef.current === videoPath) {
			regions.pendingFreshRecordingAutoZoomPathRef.current = null;
			return;
		}
		const telemetryPointCount = cursorTelemetry.length;
		if (pendingFreshRecordingAutoSuggestTelemetryCountRef.current === telemetryPointCount)
			return;
		pendingFreshRecordingAutoSuggestTelemetryCountRef.current = telemetryPointCount;
		if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
			window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
			pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
		}
		pendingFreshRecordingAutoSuggestTimeoutRef.current = window.setTimeout(() => {
			pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
			if (
				regions.pendingFreshRecordingAutoZoomPathRef.current !== videoPath ||
				regions.autoSuggestedVideoPathRef.current === videoPath ||
				regions.zoomRegions.length > 0
			) {
				return;
			}
			setAutoSuggestZoomsTrigger((v) => v + 1);
		}, 500);
	}, [
		videoPath, loading, isPreviewReady, duration, cursorTelemetry.length,
		normalizedCursorTelemetry, regions.zoomRegions, setAutoSuggestZoomsTrigger,
	]);

	// Keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			const isEditableTarget =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target?.isContentEditable;
			const usesPrimaryModifier = isMac ? e.metaKey : e.ctrlKey;
			const key = e.key.toLowerCase();

			if (usesPrimaryModifier && !e.altKey && key === "z") {
				if (!isEditableTarget) {
					e.preventDefault();
					if (e.shiftKey) history.handleRedo();
					else history.handleUndo();
				}
				return;
			}
			if (!isMac && e.ctrlKey && !e.metaKey && !e.altKey && key === "y") {
				if (!isEditableTarget) {
					e.preventDefault();
					history.handleRedo();
				}
				return;
			}
			if (e.key === "Tab") {
				if (isEditableTarget) return;
				e.preventDefault();
			}
			if (matchesShortcut(e, shortcuts.playPause, isMac)) {
				if (isEditableTarget) return;
				e.preventDefault();
				const playback = videoPlaybackRef.current;
				if (playback?.video) {
					if (playback.video.paused) playback.play().catch(console.error);
					else playback.pause();
				}
			}
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [shortcuts, isMac, history.handleUndo, history.handleRedo, videoPlaybackRef]);

	// Smoke export trigger
	useEffect(() => {
		if (!smokeExportConfig.enabled || exp.smokeExportStartedRef.current) return;
		if (error) {
			exp.smokeExportStartedRef.current = true;
			console.error(`[smoke-export] ${error}`);
			window.close();
			return;
		}
		if (!videoPath || loading) return;
		exp.smokeExportStartedRef.current = true;
		void exp.handleExport({
			format: "mp4",
			quality: "good",
			encodingMode: (smokeExportConfig.encodingMode ?? "balanced") as ExportEncodingMode,
		});
	}, [
		error, exp.handleExport, loading, smokeExportConfig.enabled,
		smokeExportConfig.encodingMode, videoPath,
	]);

	// Cleanup auto-suggest timeout
	useEffect(() => {
		return () => {
			if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
				window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
				pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
			}
		};
	}, []);

	// Extension section buttons
	const [extensionSectionButtons, setExtensionSectionButtons] = useState<
		{ id: EditorEffectSection; label: string; icon: string }[]
	>([]);
	useEffect(() => {
		const update = () => {
			const panels = extensionHost.getSettingsPanels();
			const standalone = panels
				.filter((p) => !p.panel.parentSection)
				.map((p) => ({
					id: `ext:${p.extensionId}/${p.panel.id}` as EditorEffectSection,
					label: p.panel.label,
					icon: p.panel.icon || "",
				}));
			setExtensionSectionButtons(standalone);
		};
		update();
		return extensionHost.onChange(update);
	}, []);

	return {
		extensionSectionButtons,
		handleAutoSuggestZoomsConsumed: useCallback(() => {
			setAutoSuggestZoomsTrigger(0);
		}, [setAutoSuggestZoomsTrigger]),
	};
}
