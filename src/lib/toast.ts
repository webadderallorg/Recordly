/**
 * Focus-mode-aware toast wrapper.
 *
 * Import `toast` from this module instead of directly from `"sonner"`.
 * All calls are silently suppressed while focus mode is active so that
 * Recordly does not interrupt the user's focus session with notifications.
 *
 * The API surface mirrors the subset of sonner's `toast` that is used
 * across this codebase: the base call plus `.success`, `.error`, `.info`,
 * `.warning`, `.loading`, `.promise`, `.custom`, `.message`, and `.dismiss`.
 *
 * `.errorAlways` bypasses suppression for critical control errors (e.g.
 * focus-mode toggle failures) that must always be visible to the user.
 */

import { toast as sonnerToast } from "sonner";
import { isFocusModeEnabled } from "./focusMode";

type SonnerToast = typeof sonnerToast;

function noop(): string {
	// Return a stable dummy ID so callers that pass the ID to toast.dismiss()
	// don't break when the toast was suppressed.
	return "focus-mode-suppressed";
}

function maybeToast(...args: Parameters<SonnerToast>): ReturnType<SonnerToast> {
	if (isFocusModeEnabled()) {
		return noop() as ReturnType<SonnerToast>;
	}
	return sonnerToast(...args);
}

maybeToast.success = ((...args: Parameters<SonnerToast["success"]>) => {
	if (isFocusModeEnabled()) return noop();
	return sonnerToast.success(...args);
}) as SonnerToast["success"];

maybeToast.error = ((...args: Parameters<SonnerToast["error"]>) => {
	if (isFocusModeEnabled()) return noop();
	return sonnerToast.error(...args);
}) as SonnerToast["error"];

maybeToast.info = ((...args: Parameters<SonnerToast["info"]>) => {
	if (isFocusModeEnabled()) return noop();
	return sonnerToast.info(...args);
}) as SonnerToast["info"];

maybeToast.warning = ((...args: Parameters<SonnerToast["warning"]>) => {
	if (isFocusModeEnabled()) return noop();
	return sonnerToast.warning(...args);
}) as SonnerToast["warning"];

maybeToast.loading = ((...args: Parameters<SonnerToast["loading"]>) => {
	if (isFocusModeEnabled()) return noop();
	return sonnerToast.loading(...args);
}) as SonnerToast["loading"];

maybeToast.promise = ((...args: Parameters<SonnerToast["promise"]>) => {
	if (isFocusModeEnabled()) return noop();
	return sonnerToast.promise(...args);
}) as SonnerToast["promise"];

maybeToast.custom = ((...args: Parameters<SonnerToast["custom"]>) => {
	if (isFocusModeEnabled()) return noop();
	return sonnerToast.custom(...args);
}) as SonnerToast["custom"];

maybeToast.message = ((...args: Parameters<SonnerToast["message"]>) => {
	if (isFocusModeEnabled()) return noop();
	return sonnerToast.message(...args);
}) as SonnerToast["message"];

maybeToast.dismiss = sonnerToast.dismiss;

/**
 * Like `toast.error` but always shows the toast regardless of focus mode.
 * Use only for critical control errors that the user must see
 * (e.g. the focus-mode toggle itself failing).
 */
maybeToast.errorAlways = sonnerToast.error;

/** Focus-mode-aware drop-in replacement for sonner's `toast`. */
export const toast = maybeToast;
