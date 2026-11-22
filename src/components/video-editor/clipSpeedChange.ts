import type { ClipRegion, ZoomRegion } from "./types";

export type ClipSpeedChangeBlockReason = "clip-overlap" | "zoom-overlap";

export interface ClipSpeedChangePlan {
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
}

export interface BlockedClipSpeedChange {
	blockedReason: ClipSpeedChangeBlockReason;
}

export function formatClipSpeedLabel(speed: number): string | null {
	if (!Number.isFinite(speed) || speed <= 0 || speed === 1) {
		return null;
	}

	return `${Number.isInteger(speed) ? speed.toFixed(0) : speed.toString()}x`;
}

function spansOverlap(
	left: { startMs: number; endMs: number },
	right: { startMs: number; endMs: number },
): boolean {
	return left.startMs < right.endMs && left.endMs > right.startMs;
}

export function planClipSpeedChange(params: {
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
	selectedClipId: string;
	speed: number;
}): ClipSpeedChangePlan | BlockedClipSpeedChange | null {
	const { clipRegions, zoomRegions, selectedClipId, speed } = params;
	if (!selectedClipId || !Number.isFinite(speed) || speed <= 0) {
		return null;
	}

	const clip = clipRegions.find((candidate) => candidate.id === selectedClipId);
	if (!clip) {
		return null;
	}

	const oldSpeed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
	const sourceDurationMs = Math.max(0, clip.endMs - clip.startMs) * oldSpeed;
	const newEndMs = Math.round(clip.startMs + sourceDurationMs / speed);
	const nextClip = clipRegions
		.filter((candidate) => candidate.id !== selectedClipId && candidate.startMs >= clip.endMs)
		.sort((left, right) => left.startMs - right.startMs)[0];

	if (nextClip && newEndMs > nextClip.startMs) {
		return { blockedReason: "clip-overlap" };
	}

	const scaleFactor = oldSpeed / speed;
	const nextZoomRegions = zoomRegions.map((zoom) => {
		if (zoom.startMs < clip.startMs || zoom.startMs >= clip.endMs) {
			return zoom;
		}

		return {
			...zoom,
			startMs: Math.round(clip.startMs + (zoom.startMs - clip.startMs) * scaleFactor),
			endMs: Math.round(clip.startMs + (zoom.endMs - clip.startMs) * scaleFactor),
		};
	});

	const changedZoomIds = new Set(
		nextZoomRegions
			.filter((zoom, index) => {
				const previous = zoomRegions[index];
				return previous.startMs !== zoom.startMs || previous.endMs !== zoom.endMs;
			})
			.map((zoom) => zoom.id),
	);

	const hasZoomOverlap = nextZoomRegions.some((zoom, index) =>
		nextZoomRegions.some(
			(other, otherIndex) =>
				index !== otherIndex &&
				(changedZoomIds.has(zoom.id) || changedZoomIds.has(other.id)) &&
				spansOverlap(zoom, other),
		),
	);

	if (hasZoomOverlap) {
		return { blockedReason: "zoom-overlap" };
	}

	return {
		clipRegions: clipRegions.map((candidate) =>
			candidate.id === selectedClipId ? { ...candidate, speed, endMs: newEndMs } : candidate,
		),
		zoomRegions: nextZoomRegions,
	};
}
