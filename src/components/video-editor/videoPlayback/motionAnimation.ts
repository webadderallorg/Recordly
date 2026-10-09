/**
 * Global Motion Animation gate helpers.
 *
 * When motion animation is disabled, playback and export should match the
 * capture "as displayed" by skipping sway, motion blur, spring camera motion
 * (classic snap), click bounce, and auto-applied fresh-recording zooms.
 * Underlying preference values stay intact so turning the feature back on
 * restores the previous look.
 */

export type MotionAnimationPlaybackFields = {
	cursorSway: number;
	cursorMotionBlur: number;
	zoomMotionBlur: number;
	zoomClassicMode: boolean;
	cursorClickBounce: number;
};

export function resolveMotionAnimationPlayback(
	motionAnimationEnabled: boolean,
	values: MotionAnimationPlaybackFields,
): MotionAnimationPlaybackFields {
	if (motionAnimationEnabled) {
		return values;
	}

	return {
		cursorSway: 0,
		cursorMotionBlur: 0,
		zoomMotionBlur: 0,
		zoomClassicMode: true,
		cursorClickBounce: 0,
	};
}

export function isAutoMotionAllowed(
	motionAnimationEnabled: boolean,
	autoApplyFreshRecordingAutoZooms: boolean,
): boolean {
	return motionAnimationEnabled && autoApplyFreshRecordingAutoZooms;
}
