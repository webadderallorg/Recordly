import { Container } from "pixi.js";
import type { Camera3DPreset, ZoomRegion3D } from "../types";

export type { Camera3DPreset };

/**
 * 3D camera moves: perspective tilt, dolly, and orbit.
 *
 * WHY SKEW AND NOT A PROJECTIVE MATRIX
 * -----------------------------------
 * PixiJS v8 `Container` is strictly 2D affine. `Container._updateSkew()`
 * builds only `_cx,_sx,_cy,_sy` from `rotation` + `skew` — there is no
 * `zx`, no perspective divide, and `scale` is a 2-component point rather than
 * a vector3. So a true rotateX/rotateY cannot be expressed on a container
 * transform.
 *
 * The faithful alternative is render-to-texture: draw the scene into a
 * RenderTexture and composite it with a hand-rolled 4x4 projection. That is a
 * per-frame extra draw pass and it does not compose with the existing
 * `filterArea` + `mask` arrangement on `videoEffectsContainer` without
 * restructuring both exporters. It also would not match the preview, which is
 * the constraint that matters most here: what you see while scrubbing has to
 * be what you get in the file.
 *
 * So this module implements the 2-axis projective tilt the way CSS does it
 * before the perspective divide: skewX/skewY coupled with a perspective-like
 * scale, all on a container ABOVE the camera. The result is a genuine
 * keystoned, foreshortened quad rather than a flat scale, and because it is a
 * plain affine transform it stays identical across preview and both exporters
 * with no extra render pass.
 *
 * The tilt is written to a dedicated parent, never to `cameraContainer`:
 * `applyZoomTransform` overwrites `cameraContainer.scale`/`.position` every
 * frame, so a 3D write there would fight the zoom write. Keeping them on
 * separate nodes makes the two transforms orthogonal.
 */

/** Magnitude of a tilt at full strength, in degrees. */
export interface Camera3DState {
	/** Signed tilt about the Y axis, in degrees. Positive turns the right edge away. */
	rotateY: number;
	/** Signed tilt about the X axis, in degrees. Positive drops the top edge away. */
	rotateX: number;
	/** Dolly along Z, expressed as a perspective strength 0..1. */
	perspective: number;
}

export const ZERO_CAMERA_3D_STATE: Camera3DState = {
	rotateY: 0,
	rotateX: 0,
	perspective: 0,
};

interface PresetDefinition {
	rotateY: number;
	rotateX: number;
	perspective: number;
}

/**
 * Preset tilts. Kept small on purpose: past roughly 12 degrees a screen
 * recording reads as a gimmick rather than depth, and beyond ~20 degrees the
 * far edge of a UI becomes unreadable.
 */
export const CAMERA_3D_PRESETS: Record<Exclude<Camera3DPreset, "none">, PresetDefinition> = {
	"tilt-left": { rotateY: -8, rotateX: 0, perspective: 0.42 },
	"tilt-right": { rotateY: 8, rotateX: 0, perspective: 0.42 },
	"tilt-up": { rotateY: 0, rotateX: -7, perspective: 0.38 },
	"tilt-down": { rotateY: 0, rotateX: 7, perspective: 0.38 },
	dolly: { rotateY: 0, rotateX: 0, perspective: 0.55 },
};

export function resolveCamera3DState(preset: Camera3DPreset): Camera3DState {
	if (preset === "none") {
		return ZERO_CAMERA_3D_STATE;
	}
	return CAMERA_3D_PRESETS[preset];
}

/**
 * Resolve a region's 3D move, scaled by its intensity.
 *
 * Returns the zero state for an absent move, for preset "none", and for
 * intensity 0 — so every pre-existing region takes the identity path and its
 * output is bit-identical to before this feature.
 */
export function resolveRegion3DState(move?: ZoomRegion3D | null): Camera3DState {
	if (!move || move.preset === "none") {
		return ZERO_CAMERA_3D_STATE;
	}

	const intensity = clamp(move.intensity ?? 1, 0, 1);
	if (intensity === 0) {
		return ZERO_CAMERA_3D_STATE;
	}

	const base = resolveCamera3DState(move.preset);
	return {
		rotateY: base.rotateY * intensity,
		rotateX: base.rotateX * intensity,
		perspective: base.perspective * intensity,
	};
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

/**
 * Map (rotateX, rotateY, perspective) onto the affine skew/scale that
 * reproduces the same quad.
 *
 * A real rotateY foreshortens the far edge, which a flat skew cannot express
 * on its own; the perspective term supplies the trapezoid by scaling the
 * content and skewing it about the pivot. `perspective` controls how much of
 * that trapezoid is applied, so fading it to zero collapses cleanly back to a
 * flat, untransformed frame.
 */
export function computeCamera3DTransform(
	state: Camera3DState,
	stageSize: { width: number; height: number },
): { skewX: number; skewY: number; scale: number } {
	if (
		stageSize.width <= 0 ||
		stageSize.height <= 0 ||
		(state.rotateX === 0 && state.rotateY === 0 && state.perspective === 0)
	) {
		return { skewX: 0, skewY: 0, scale: 1 };
	}

	const perspective = clamp(state.perspective, 0, 1);
	const skewX = clamp((state.rotateY / 90) * perspective, -1, 1);
	const skewY = clamp((state.rotateX / 90) * perspective, -1, 1);

	// PixiJS skew is a shear coefficient, not an angle: a 0.2 skew shifts the
	// top edge by 20% of the container's height. Dividing degrees by 90 put an
	// 8-degree tilt at 0.037, which is visually indistinguishable from no tilt
	// at all (measured: the top-left registration mark moved 2px). What
	// actually reads as depth is a shear of roughly 0.12-0.22 for a tasteful
	// tilt and ~0.3 at the strongest setting, so the angle is mapped through
	// this factor rather than straight to tan().
	const skewScale = 5;
	const skewXOut = clamp(skewX * skewScale, -1, 1);
	const skewYOut = clamp(skewY * skewScale, -1, 1);

	// A tilt shortens one axis, so scale up slightly to keep the framed
	// content filling the stage instead of leaving a gap.
	const shrink = Math.abs(skewXOut) + Math.abs(skewYOut);
	const scale = 1 + shrink * 0.35;

	return { skewX: skewXOut, skewY: skewYOut, scale };
}

/**
 * Apply a 3D state to the tilt container.
 *
 * `pivot` is set to the stage centre because the content is already centred by
 * `computeZoomTransform`; anchoring the tilt anywhere else would swing the
 * frame off-screen instead of rotating it in place.
 */
export function applyCamera3DTransform(
	tiltContainer: Container,
	state: Camera3DState,
	stageSize: { width: number; height: number },
) {
	tiltContainer.pivot.set(stageSize.width / 2, stageSize.height / 2);
	tiltContainer.position.set(stageSize.width / 2, stageSize.height / 2);

	const { skewX, skewY, scale } = computeCamera3DTransform(state, stageSize);

	if (skewX === 0 && skewY === 0 && scale === 1) {
		// Reset rather than leave a stale transform on the container, so a
		// region without a 3D move is provably identical to today's output.
		tiltContainer.skew.x = 0;
		tiltContainer.skew.y = 0;
		tiltContainer.scale.set(1);
		return;
	}

	tiltContainer.skew.x = skewX;
	tiltContainer.skew.y = skewY;
	tiltContainer.scale.set(scale);
}

export function createCamera3DContainer(): Container {
	const container = new Container();
	// sortChildren: the tilt container has no children of its own; keeping the
	// flag off avoids an unnecessary traversal every frame.
	container.sortableChildren = false;
	return container;
}
