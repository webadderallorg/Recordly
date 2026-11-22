export interface HudInteractiveBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
	shape?: "ellipse";
}

// The native HUD covers the work area. Only these visible surfaces may catch
// clicks; layout containers and the toast region include transparent space.
export function getHudInteractiveBounds(root: Pick<Document, "querySelectorAll">) {
	return Array.from(
		root.querySelectorAll<HTMLElement>(
			'[data-hud-surface], [data-hud-interactive], [data-slot="toast"]',
		),
	)
		.filter(
			(element) => element.dataset.exiting !== "true" && element.dataset.hidden !== "true",
		)
		.map((element): HudInteractiveBounds => {
			const { left, top, right, bottom } = element.getBoundingClientRect();
			return {
				left,
				top,
				right,
				bottom,
				shape: element.dataset.floatingWebcamPreview !== undefined ? "ellipse" : undefined,
			};
		});
}

export function isPointerOverHudSurface(
	bounds: Array<HudInteractiveBounds | null | undefined>,
	clientX: number,
	clientY: number,
): boolean {
	return bounds.some(
		(rect) =>
			rect &&
			Number.isFinite(rect.left + rect.top + rect.right + rect.bottom) &&
			rect.right > rect.left &&
			rect.bottom > rect.top &&
			clientX >= rect.left &&
			clientX <= rect.right &&
			clientY >= rect.top &&
			clientY <= rect.bottom &&
			(rect.shape !== "ellipse" ||
				((2 * clientX - rect.left - rect.right) / (rect.right - rect.left)) ** 2 +
					((2 * clientY - rect.top - rect.bottom) / (rect.bottom - rect.top)) ** 2 <=
					1),
	);
}

export function mergeHudInteractiveBounds(
	bounds: Array<HudInteractiveBounds | null | undefined>,
): HudInteractiveBounds | null {
	const presentBounds = bounds.filter((value): value is HudInteractiveBounds => Boolean(value));
	if (presentBounds.length === 0) {
		return null;
	}

	return presentBounds.reduce((merged, current) => ({
		left: Math.min(merged.left, current.left),
		top: Math.min(merged.top, current.top),
		right: Math.max(merged.right, current.right),
		bottom: Math.max(merged.bottom, current.bottom),
	}));
}

export function shouldRestoreHudMousePassthroughAfterDrag(
	bounds: HudInteractiveBounds | null,
	clientX: number,
	clientY: number,
): boolean {
	if (!bounds) {
		return true;
	}

	return (
		clientX < bounds.left ||
		clientX > bounds.right ||
		clientY < bounds.top ||
		clientY > bounds.bottom
	);
}
