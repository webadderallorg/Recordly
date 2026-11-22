// Electron IPC wraps the error message and discards custom error properties.
export const SAVED_SIGN_IN_LOCKED =
	"Could not unlock saved authentication. Restart Recordly and try again.";

export function isSavedSignInLocked(error: unknown): boolean {
	return error instanceof Error && error.message.endsWith(SAVED_SIGN_IN_LOCKED);
}
