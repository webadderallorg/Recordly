import type { Range, ResizeMoveEvent, ResizeStartEvent, Span } from "dnd-timeline";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface Session {
	id: string;
	node: HTMLElement;
	origin: Span;
	initialRange: Range;
	range: Range;
	startX: number;
	pointerX: number;
	maxEnd: number;
	viewportEnd: number;
	preview: Span;
	moved: boolean;
	cancelled: boolean;
}

function restoreCancelledResize(session: Session) {
	const row = session.node.parentElement;
	if (!row) return;
	const msPerPixel =
		(session.initialRange.end - session.initialRange.start) / row.getBoundingClientRect().width;
	const side = getComputedStyle(row).direction === "rtl" ? "right" : "left";
	session.node.style[side] =
		`${(session.origin.start - session.initialRange.start) / msPerPixel}px`;
	session.node.style.width = `${(session.origin.end - session.origin.start) / msPerPixel}px`;
}

/** Keep a right-edge trim moving while the pointer rests at the viewport edge. */
export function useClipResizeScroll({
	range,
	totalMs,
	minDurationMs,
	clipResizeEndById,
	onPreview,
	onCancel,
}: {
	range: Range;
	totalMs: number;
	minDurationMs: number;
	clipResizeEndById: Record<string, number>;
	onPreview: (span: Span, screenX: number, id: string) => void;
	onCancel: () => void;
}) {
	const hostRef = useRef<HTMLDivElement>(null);
	const sessionRef = useRef<Session | null>(null);
	const frameRef = useRef<number | null>(null);
	const [scrollRange, setScrollRange] = useState<Range | null>(null);
	const previewRef = useRef(onPreview);
	previewRef.current = onPreview;
	const cancelRef = useRef(onCancel);
	cancelRef.current = onCancel;

	const paint = (session: Session) => {
		const row = session.node.parentElement;
		if (!row) return;
		const width = row.getBoundingClientRect().width;
		if (width <= 0) return;
		const rtl = getComputedStyle(row).direction === "rtl";
		const msPerPixel = (session.range.end - session.range.start) / width;
		const end =
			session.origin.end +
			(session.pointerX - session.startX) * (rtl ? -1 : 1) * msPerPixel +
			session.range.start -
			session.initialRange.start;
		session.preview = {
			start: session.origin.start,
			end: Math.max(session.origin.start + minDurationMs, Math.min(session.maxEnd, end)),
		};
		session.node.style[rtl ? "right" : "left"] =
			`${(session.origin.start - session.range.start) / msPerPixel}px`;
		session.node.style.width = `${(session.preview.end - session.preview.start) / msPerPixel}px`;
		previewRef.current(session.preview, session.pointerX, session.id);
	};

	// React lays out the new range before repainting the imperative resize preview.
	useLayoutEffect(() => {
		if (sessionRef.current?.cancelled) restoreCancelledResize(sessionRef.current);
		else if (sessionRef.current?.moved) paint(sessionRef.current);
	});

	const stopFrame = () => {
		if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		frameRef.current = null;
	};
	useEffect(() => {
		const cancel = () => {
			const session = sessionRef.current;
			if (!session) return;
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
			frameRef.current = null;
			session.cancelled = true;
			session.moved = false;
			restoreCancelledResize(session);
			setScrollRange(null);
			cancelRef.current();
		};
		const keydown = (event: KeyboardEvent) => {
			if (event.key === "Escape") cancel();
		};
		window.addEventListener("blur", cancel);
		window.addEventListener("pointercancel", cancel);
		window.addEventListener("keydown", keydown);
		return () => {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
			window.removeEventListener("blur", cancel);
			window.removeEventListener("pointercancel", cancel);
			window.removeEventListener("keydown", keydown);
		};
	}, []);

	const start = (event: ResizeStartEvent) => {
		stopFrame();
		sessionRef.current = null;
		const id = String(event.active.id);
		const maxEnd = clipResizeEndById[id];
		if (event.direction !== "end" || !Number.isFinite(maxEnd)) return;
		const node = Array.from(
			hostRef.current?.querySelectorAll<HTMLElement>("[data-timeline-item]") ?? [],
		).find(
			(item) =>
				item.dataset.variant === "clip" &&
				item.getAttribute("data-timeline-item-id") === id,
		);
		if (!node) return;
		const origin = { start: Number(node.dataset.startMs), end: Number(node.dataset.endMs) };
		const pointerX = (event.activatorEvent as PointerEvent).clientX;
		sessionRef.current = {
			id,
			node,
			origin,
			initialRange: range,
			range,
			startX: pointerX,
			pointerX,
			maxEnd,
			viewportEnd: totalMs + maxEnd - origin.end,
			preview: origin,
			moved: false,
			cancelled: false,
		};
	};

	const move = (event: ResizeMoveEvent) => {
		const session = sessionRef.current;
		if (!session || session.id !== String(event.active.id)) return false;
		if (session.cancelled) {
			restoreCancelledResize(session);
			return true;
		}
		session.pointerX = (event.activatorEvent as PointerEvent).clientX;
		session.moved ||= Math.abs(event.delta.x) > 4;
		if (!session.moved) return true;
		paint(session);
		if (frameRef.current === null) {
			let previousTime = performance.now();
			const tick = (now: number) => {
				const current = sessionRef.current;
				if (!current) return;
				const rect = current.node.parentElement?.getBoundingClientRect();
				const elapsed = Math.min(now - previousTime, 50);
				previousTime = now;
				if (rect && rect.width > 0) {
					const rtl = getComputedStyle(current.node.parentElement!).direction === "rtl";
					const x = rtl ? rect.right - current.pointerX : current.pointerX - rect.left;
					const edge = Math.min(80, rect.width * 0.1);
					const speed =
						x > rect.width - edge
							? Math.min(1, (x - rect.width + edge) / edge)
							: x < edge
								? -Math.min(1, (edge - x) / edge)
								: 0;
					const visibleMs = current.range.end - current.range.start;
					const start = Math.max(
						0,
						Math.min(
							current.range.start + (speed * visibleMs * 2 * elapsed) / 1000,
							Math.max(0, current.viewportEnd - visibleMs),
						),
					);
					if (start !== current.range.start) {
						current.range = { start, end: start + visibleMs };
						setScrollRange(current.range);
						paint(current);
					}
				}
				frameRef.current = requestAnimationFrame(tick);
			};
			frameRef.current = requestAnimationFrame(tick);
		}
		return true;
	};

	const finish = () => {
		const session = sessionRef.current;
		stopFrame();
		sessionRef.current = null;
		setScrollRange(null);
		return session ? { span: session.preview, moved: session.moved } : null;
	};
	return { hostRef, range: scrollRange ?? range, start, move, finish };
}
