import type { AnnotationRegion } from "../types";

/** Return whether an annotation is composited at the supplied media timestamp. */
export function isAnnotationActiveAtTime(
	annotation: Pick<AnnotationRegion, "startMs" | "endMs">,
	timeMs: number,
): boolean {
	return (
		Number.isFinite(annotation.startMs) &&
		Number.isFinite(annotation.endMs) &&
		timeMs >= annotation.startMs &&
		timeMs <= annotation.endMs
	);
}
