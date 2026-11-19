import type { CaptureArea, SelectedSource } from "./ipc/types";

/** Non-overlapping strips which never cover a pixel inside the recording. */
export function outsideRecordingRects(
	displays: CaptureArea[],
	target: CaptureArea,
	exclusions: CaptureArea[] = [],
): CaptureArea[] {
	if (
		![target.x, target.y, target.width, target.height].every(Number.isFinite) ||
		target.width <= 0 ||
		target.height <= 0
	)
		return [];
	const rectangles = displays.flatMap((display) => {
		// Round the hole outward: fractional display points must never dim a captured edge.
		const left = Math.max(display.x, Math.floor(target.x));
		const top = Math.max(display.y, Math.floor(target.y));
		const right = Math.min(display.x + display.width, Math.ceil(target.x + target.width));
		const bottom = Math.min(display.y + display.height, Math.ceil(target.y + target.height));
		if (right <= left || bottom <= top) return [{ ...display }];
		return [
			{ x: display.x, y: display.y, width: display.width, height: top - display.y },
			{
				x: display.x,
				y: bottom,
				width: display.width,
				height: display.y + display.height - bottom,
			},
			{ x: display.x, y: top, width: left - display.x, height: bottom - top },
			{ x: right, y: top, width: display.x + display.width - right, height: bottom - top },
		].filter((rect) => rect.width > 0 && rect.height > 0);
	});
	return exclusions.reduce(
		(remaining, exclusion) =>
			remaining.flatMap((rect) => outsideRecordingRects([rect], exclusion)),
		rectangles,
	);
}

export function createRecordingFocusController(deps: {
	resolve: (source: SelectedSource) => Promise<CaptureArea | null>;
	show: (bounds: CaptureArea) => void;
	hide: () => void;
}) {
	let source: SelectedSource | null = null;
	let revision = 0;
	let timer: ReturnType<typeof setInterval> | undefined;
	let pendingRevision: number | null = null;
	const refresh = async () => {
		if (!source || pendingRevision === revision) return;
		const activeRevision = revision;
		const activeSource = source;
		pendingRevision = activeRevision;
		try {
			const bounds = await deps.resolve(activeSource);
			if (activeRevision !== revision || !source) return;
			if (bounds) deps.show(bounds);
			else deps.hide();
		} catch {
			if (activeRevision === revision) deps.hide();
		} finally {
			if (pendingRevision === activeRevision) pendingRevision = null;
		}
	};
	const stop = () => {
		revision++;
		source = null;
		if (timer) clearInterval(timer);
		timer = undefined;
		deps.hide();
	};
	return {
		async start(next: SelectedSource | null) {
			// Countdown and recording share a target; keep its windows alive across the transition.
			if (source && next && JSON.stringify(source) === JSON.stringify(next)) {
				await refresh();
				return;
			}
			stop();
			source = next;
			if (!source) return;
			const activeRevision = revision;
			await refresh();
			if (!source || activeRevision !== revision) return;
			timer = setInterval(() => {
				void refresh();
			}, 250);
			timer.unref?.();
		},
		stop,
		sourceChanged(next: SelectedSource | null) {
			// A selection alone must not dim the desktop. Only update an already
			// active recording surround; recording state starts and stops it.
			if (source) void this.start(next);
		},
	};
}
