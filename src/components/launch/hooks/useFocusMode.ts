import { useCallback, useEffect, useState } from "react";
import { useScopedT } from "../../../contexts/I18nContext";
import { setFocusModeEnabledRef, setFocusModeInitialized } from "../../../lib/focusMode";
import { toast } from "../../../lib/toast";

/**
 * Manages focus-mode state for the HUD.
 *
 * - Queries `getFocusModeStatus()` on mount to restore persisted state.
 * - Subscribes to `onFocusModeChanged` for multi-window synchronisation.
 * - `toggleFocusMode` sends `setFocusMode` and updates state only after a
 *   confirmed success; on failure it reverts the icon and surfaces a toast.
 */
export function useFocusMode() {
	const t = useScopedT("launch");
	const [focusModeEnabled, setFocusModeEnabled] = useState(false);
	const [focusModeSupported, setFocusModeSupported] = useState(true);
	const [focusModeLoading, setFocusModeLoading] = useState(false);

	// Keep the module-level ref in sync so the toast wrapper can read it
	// without needing access to React state.
	const applyState = useCallback((enabled: boolean, supported: boolean) => {
		setFocusModeEnabled(enabled);
		setFocusModeSupported(supported);
		setFocusModeEnabledRef(enabled);
	}, []);

	// ── Initial load ──────────────────────────────────────────────────────────
	useEffect(() => {
		let cancelled = false;

		const load = async () => {
			try {
				const result = await window.electronAPI?.getFocusModeStatus?.();
				if (!cancelled && result?.success) {
					applyState(result.enabled, result.supported);
					// Mark as initialized so toast suppression activates from this point.
					setFocusModeInitialized();
				}
			} catch (error) {
				console.error("[useFocusMode] Failed to load focus mode status:", error);
			}
		};

		void load();

		return () => {
			cancelled = true;
		};
	}, [applyState]);

	// ── Multi-window sync ─────────────────────────────────────────────────────
	useEffect(() => {
		const cleanup = window.electronAPI?.onFocusModeChanged?.((result) => {
			if (result.success) {
				applyState(result.enabled, result.supported);
			}
		});

		return () => {
			cleanup?.();
		};
	}, [applyState]);

	// ── Toggle ────────────────────────────────────────────────────────────────
	const toggleFocusMode = useCallback(async () => {
		if (focusModeLoading) return;

		const next = !focusModeEnabled;
		setFocusModeLoading(true);

		try {
			const result = await window.electronAPI?.setFocusMode?.(next);

			if (result?.success) {
				applyState(result.enabled, result.supported);
			} else {
				// Revert to the last known-good state; the ref is already correct.
				// Use errorAlways so this control error is visible even when focus
				// mode is currently active.
				const errorMsg = result?.error ?? t("recording.focusModeError");
				toast.errorAlways(errorMsg);
			}
		} catch (error) {
			console.error("[useFocusMode] Failed to toggle focus mode:", error);
			toast.errorAlways(t("recording.focusModeError"));
		} finally {
			setFocusModeLoading(false);
		}
	}, [focusModeEnabled, focusModeLoading, applyState, t]);

	return {
		focusModeEnabled,
		focusModeSupported,
		focusModeLoading,
		toggleFocusMode,
	};
}
