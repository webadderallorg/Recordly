type FocusCandidate = {
	isDestroyed(): boolean;
	isVisible(): boolean;
};

export function pickWindowToFocus<T extends FocusCandidate>(candidates: {
	current: T | null;
	editor: T | null;
	overlay: T | null;
}): T | null {
	const { current, editor, overlay } = candidates;
	if (current && !current.isDestroyed()) return current;
	if (editor && !editor.isDestroyed()) return editor;
	if (overlay && !overlay.isDestroyed() && overlay.isVisible()) return overlay;
	return null;
}
