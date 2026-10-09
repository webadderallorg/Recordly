import { useEffect, useState } from "react";
import type { HudWindowLayoutMode } from "../hudWindowMode";

export function useLaunchWindowSystemState(
	preparePermissions: (args: { startup?: boolean }) => Promise<unknown>,
) {
	const [hudOverlayMousePassthroughSupported, setHudOverlayMousePassthroughSupported] = useState<
		boolean | null
	>(null);
	const [platform, setPlatform] = useState<string | null>(null);
	// Hidden until known so the picker never flashes on Linux portal sessions.
	const [showSourcePicker, setShowSourcePicker] = useState(false);
	// HUD window sizing mode: "shape" (X11 carving), "grow" (Wayland
	// grow-downward, bar top-anchored), or "legacy" (fixed window).
	const [hudWindowMode, setHudWindowMode] = useState<HudWindowLayoutMode>("legacy");

	useEffect(() => {
		window.electronAPI?.hudOverlayRendererReady?.();
	}, []);

	useEffect(() => {
		let cancelled = false;
		const loadPlatform = async () => {
			try {
				const nextPlatform = await window.electronAPI.getPlatform();
				if (!cancelled) setPlatform(nextPlatform);
			} catch (error) {
				console.error("Failed to load platform:", error);
			}
		};
		void loadPlatform();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const loadSourcePickerVisibility = async () => {
			try {
				const visibility = await window.electronAPI.getSourcePickerVisibility();
				if (!cancelled) setShowSourcePicker(visibility.show);
			} catch {
				// Without an answer the safe default is to show the picker —
				// on portal-less X11 it is the only working capture path.
				if (!cancelled) setShowSourcePicker(true);
			}
		};
		void loadSourcePickerVisibility();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const loadWindowMode = async () => {
			try {
				const result = await window.electronAPI.getHudOverlayWindowMode();
				if (!cancelled && (result.mode === "shape" || result.mode === "grow" || result.mode === "legacy")) {
					setHudWindowMode(result.mode);
				}
			} catch (error) {
				console.error("Failed to load HUD window mode:", error);
			}
		};
		void loadWindowMode();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const loadSupport = async () => {
			try {
				const result = await window.electronAPI.getHudOverlayMousePassthroughSupported();
				if (!cancelled && result.success) {
					setHudOverlayMousePassthroughSupported(result.supported);
				}
			} catch (error) {
				console.error("Failed to load HUD overlay mouse passthrough support:", error);
			}
		};
		void loadSupport();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		void preparePermissions({ startup: true });
	}, [preparePermissions]);

	return {
		hudOverlayMousePassthroughSupported,
		platform,
		showSourcePicker,
		hudWindowMode,
	};
}
