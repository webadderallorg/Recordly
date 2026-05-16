import { getProject, types } from "@theatre/core";

// The single project that holds all animation state.
// State is serializable JSON — save/load by passing { state } to getProject.
export const project = getProject("MocklyStudio");

// One sheet = one "scene" / one animation clip.
// Multiple sheets can coexist for different takes.
export const sheet = project.sheet("Scene");

// ─── Camera object ───────────────────────────────────────────────────────────
// Every property here becomes an animatable track in the timeline.
export const cameraObject = sheet.object("Camera", {
	position: {
		x: types.number(0, { range: [-20, 20], nudgeMultiplier: 0.01 }),
		y: types.number(0, { range: [-20, 20], nudgeMultiplier: 0.01 }),
		z: types.number(5, { range: [0.5, 30], nudgeMultiplier: 0.01 }),
	},
	lookAt: {
		x: types.number(0, { range: [-10, 10], nudgeMultiplier: 0.01 }),
		y: types.number(0, { range: [-10, 10], nudgeMultiplier: 0.01 }),
		z: types.number(0, { range: [-10, 10], nudgeMultiplier: 0.01 }),
	},
	fov: types.number(45, { range: [10, 120], nudgeMultiplier: 0.5 }),
});

// ─── Device object ────────────────────────────────────────────────────────────
// Primary animation target: rotation gives the "3D reveal" motion.
// Scale can be used for entrance zoom.
export const deviceObject = sheet.object("Device", {
	rotation: {
		x: types.number(0, { range: [-180, 180], nudgeMultiplier: 0.1 }),
		y: types.number(0, { range: [-180, 180], nudgeMultiplier: 0.1 }),
		z: types.number(0, { range: [-180, 180], nudgeMultiplier: 0.1 }),
	},
	position: {
		x: types.number(0, { range: [-5, 5], nudgeMultiplier: 0.01 }),
		y: types.number(0, { range: [-5, 5], nudgeMultiplier: 0.01 }),
		z: types.number(0, { range: [-5, 5], nudgeMultiplier: 0.01 }),
	},
	scale: types.number(1, { range: [0.01, 3], nudgeMultiplier: 0.01 }),
});

export type CameraValues = typeof cameraObject.value;
export type DeviceValues = typeof deviceObject.value;

// Load a previously saved state by passing { state } to getProject on init.
// Call getProject("MocklyStudio", { state: savedJson }) to restore.
export type SavedProjectState = Record<string, unknown>;
