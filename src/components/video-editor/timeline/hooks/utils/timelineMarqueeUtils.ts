export const MARQUEE_DRAG_THRESHOLD_PX = 4;

const MARQUEE_SELECTABLE_KINDS = ["zoom", "camera", "fillFrame", "annotation", "speed"] as const;

export type MarqueeSelectableKind = (typeof MARQUEE_SELECTABLE_KINDS)[number];

export interface MarqueeSelectedItem {
	kind: MarqueeSelectableKind;
	id: string;
}

export interface MarqueeRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface MarqueePoint {
	x: number;
	y: number;
}

export interface MarqueeCandidateItem {
	id: string;
	kind: string;
	rect: MarqueeRect;
}

export function isMarqueeSelectableKind(kind: string): kind is MarqueeSelectableKind {
	return (MARQUEE_SELECTABLE_KINDS as readonly string[]).includes(kind);
}

// Plain clicks must behave exactly as before; only treat the gesture as a
// marquee once the pointer travels past the threshold.
export function exceedsMarqueeThreshold(
	anchor: MarqueePoint,
	current: MarqueePoint,
	thresholdPx = MARQUEE_DRAG_THRESHOLD_PX,
): boolean {
	return Math.hypot(current.x - anchor.x, current.y - anchor.y) > thresholdPx;
}

export function buildMarqueeRect(anchor: MarqueePoint, current: MarqueePoint): MarqueeRect {
	const left = Math.min(anchor.x, current.x);
	const top = Math.min(anchor.y, current.y);
	return {
		left,
		top,
		width: Math.abs(current.x - anchor.x),
		height: Math.abs(current.y - anchor.y),
	};
}

export function rectsIntersect(a: MarqueeRect, b: MarqueeRect): boolean {
	return (
		a.left < b.left + b.width &&
		a.left + a.width > b.left &&
		a.top < b.top + b.height &&
		a.top + a.height > b.top
	);
}

// Resolves the marquee release into the multi-selection set: every selectable
// chip whose rendered rect intersects the marquee. Non-selectable kinds (the
// main clip track and audio waveforms) are filtered out here.
export function resolveMarqueeSelection(
	candidates: readonly MarqueeCandidateItem[],
	marqueeRect: MarqueeRect,
): MarqueeSelectedItem[] {
	const selected: MarqueeSelectedItem[] = [];
	const seenIds = new Set<string>();
	for (const candidate of candidates) {
		if (!candidate.id || seenIds.has(candidate.id)) continue;
		if (!isMarqueeSelectableKind(candidate.kind)) continue;
		if (!rectsIntersect(candidate.rect, marqueeRect)) continue;
		seenIds.add(candidate.id);
		selected.push({ kind: candidate.kind, id: candidate.id });
	}
	return selected;
}
