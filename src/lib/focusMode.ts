/**
 * Renderer-side focus-mode state.
 *
 * This module holds a single mutable reference to the current focus-mode
 * enabled flag. It is updated by the `useFocusMode` hook (which syncs from
 * the main process) and read synchronously by the `toast` wrapper to decide
 * whether to suppress notifications.
 *
 * Keeping state here — rather than only in React — avoids having to thread
 * the flag through every component that might show a toast.
 *
 * `_initialized` starts as `false` so that toasts are never suppressed
 * during early startup (before the persisted status has been fetched from
 * the main process). The hook sets it to `true` once the first
 * `getFocusModeStatus` response is received.
 */

let _focusModeEnabled = false;
let _initialized = false;

/** Returns true when focus mode is currently active AND the status has been initialized. */
export function isFocusModeEnabled(): boolean {
	return _initialized && _focusModeEnabled;
}

/**
 * Called by `useFocusMode` whenever the main-process broadcasts a state change.
 * Not intended for direct use outside of the hook.
 */
export function setFocusModeEnabledRef(enabled: boolean): void {
	_focusModeEnabled = enabled;
}

/**
 * Called by `useFocusMode` once the initial `getFocusModeStatus` response
 * succeeds. Until this is called, `isFocusModeEnabled()` returns `false`
 * so that early-startup toasts are never accidentally suppressed.
 */
export function setFocusModeInitialized(): void {
	_initialized = true;
}
