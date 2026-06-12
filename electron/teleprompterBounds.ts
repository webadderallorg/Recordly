export interface TeleprompterBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const TELEPROMPTER_DEFAULT_WIDTH = 520;
export const TELEPROMPTER_DEFAULT_HEIGHT = 360;
export const TELEPROMPTER_TOP_MARGIN = 12;

interface WorkArea {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Default placement: horizontally centered at the very top of the primary
 * display, so the window sits as close to the camera as possible.
 */
export function getTeleprompterDefaultBounds(workArea: WorkArea): TeleprompterBounds {
	const width = Math.min(TELEPROMPTER_DEFAULT_WIDTH, workArea.width);
	const height = Math.min(TELEPROMPTER_DEFAULT_HEIGHT, workArea.height);

	return {
		x: workArea.x + Math.round((workArea.width - width) / 2),
		y: workArea.y + Math.min(TELEPROMPTER_TOP_MARGIN, Math.max(0, workArea.height - height)),
		width,
		height,
	};
}
