export function canShowFloatingWebcamPreview(
	requested: boolean,
	_hudOverlayMousePassthroughSupported: boolean | null,
): boolean {
	return requested;
}

export function canToggleFloatingWebcamPreview(
	_hudOverlayMousePassthroughSupported: boolean | null,
): boolean {
	return true;
}
