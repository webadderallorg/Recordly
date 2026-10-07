import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import {
	AREA_HANDLES,
	type AreaHandle,
	type AreaRect,
	frontmostAt,
	MIN_AREA_SIZE,
	moveAreaRect,
	normalizeAreaRect,
	rectContains,
	resizeAreaRect,
} from "./areaGeometry";

type PickerWindow = { window: CapturePickerWindow; rect: AreaRect };

/** Something a click picks: the window under the cursor, or the whole screen. */
type Target =
	| { kind: "window"; window: CapturePickerWindow; rect: AreaRect }
	| { kind: "screen"; rect: AreaRect };

type Selection = Target | { kind: "area"; rect: AreaRect };

type Drag =
	| { kind: "press"; startX: number; startY: number }
	| { kind: "draw"; originX: number; originY: number }
	| { kind: "move"; startX: number; startY: number; rect: AreaRect; moved: boolean }
	| {
			kind: "resize";
			handle: AreaHandle;
			startX: number;
			startY: number;
			rect: AreaRect;
			moved: boolean;
	  };

const TOOLBAR_HEIGHT = 44;
const TOOLBAR_GAP = 12;
/** A press that travels this far draws an area instead of clicking. */
const DRAG_THRESHOLD = 4;
const DIM = "rgba(0,0,0,0.38)";
const HIGHLIGHT = "rgba(10,132,255,0.95)";

const HANDLE_POSITIONS: Record<AreaHandle, { left: string; top: string; cursor: string }> = {
	nw: { left: "0%", top: "0%", cursor: "nwse-resize" },
	n: { left: "50%", top: "0%", cursor: "ns-resize" },
	ne: { left: "100%", top: "0%", cursor: "nesw-resize" },
	e: { left: "100%", top: "50%", cursor: "ew-resize" },
	se: { left: "100%", top: "100%", cursor: "nwse-resize" },
	s: { left: "50%", top: "100%", cursor: "ns-resize" },
	sw: { left: "0%", top: "100%", cursor: "nesw-resize" },
	w: { left: "0%", top: "50%", cursor: "ew-resize" },
};

function viewport() {
	return { width: window.innerWidth, height: window.innerHeight };
}

function screenRect(): AreaRect {
	return { x: 0, y: 0, ...viewport() };
}

/** Converts a global rectangle to this overlay's coordinates, clipped to it. */
function toLocal(rect: CaptureArea): AreaRect {
	return normalizeAreaRect(
		{
			x: rect.x - window.screenX,
			y: rect.y - window.screenY,
			width: rect.width,
			height: rect.height,
		},
		viewport(),
	);
}

function sizeLabel(rect: AreaRect) {
	return `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
}

/**
 * Full-display overlay for picking what to record, one per display. Hovering
 * highlights the window under the cursor; a click picks it, or the whole screen
 * over the desktop; a drag draws an area. Moving or resizing a pick turns it into
 * an area. Enter or double-click records, Escape cancels.
 */
export function CapturePicker() {
	const t = useScopedT("launch");
	const [displayId] = useState(() =>
		Number(new URLSearchParams(window.location.search).get("displayId")),
	);
	const [selection, setSelection] = useState<Selection | null>(null);
	const [hover, setHover] = useState<Target | null>(null);
	const [dragging, setDragging] = useState(false);
	const dragRef = useRef<Drag | null>(null);
	const selectionRef = useRef<Selection | null>(null);
	selectionRef.current = selection;
	const windowsRef = useRef<PickerWindow[]>([]);

	const targetAt = useCallback((x: number, y: number): Target => {
		const hit = frontmostAt(windowsRef.current, x, y);
		return hit
			? { kind: "window", window: hit.window, rect: hit.rect }
			: { kind: "screen", rect: screenRect() };
	}, []);

	useEffect(() => {
		let cancelled = false;
		// Reveal the window only after a frame with the picker's real state.
		const reveal = () =>
			requestAnimationFrame(() =>
				requestAnimationFrame(() => window.electronAPI.capturePickerReady()),
			);
		window.electronAPI
			.getCapturePickerContext(displayId)
			.then((context) => {
				if (cancelled) return;
				windowsRef.current = context.windows
					.map((entry) => ({ window: entry, rect: toLocal(entry) }))
					.filter((entry) => entry.rect.width > 0 && entry.rect.height > 0);
				if (context.lastArea && !selectionRef.current) {
					setSelection({ kind: "area", rect: toLocal(context.lastArea) });
				} else if (context.cursor) {
					const x = context.cursor.x - window.screenX;
					const y = context.cursor.y - window.screenY;
					if (rectContains(screenRect(), x, y)) setHover(targetAt(x, y));
				}
			})
			.finally(reveal);
		return () => {
			cancelled = true;
		};
	}, [displayId, targetAt]);

	const finish = useCallback(
		(record: boolean | null) => {
			const current = selectionRef.current;
			if (record === null || !current) {
				void window.electronAPI.completeCapturePick(null);
				return;
			}
			if (current.kind === "window") {
				void window.electronAPI.completeCapturePick({
					kind: "window",
					windowId: current.window.id,
					displayId,
					record,
				});
				return;
			}
			if (current.kind === "screen") {
				void window.electronAPI.completeCapturePick({ kind: "screen", displayId, record });
				return;
			}
			const { rect } = current;
			if (rect.width < MIN_AREA_SIZE || rect.height < MIN_AREA_SIZE) return;
			void window.electronAPI.completeCapturePick({
				kind: "area",
				x: window.screenX + rect.x,
				y: window.screenY + rect.y,
				width: rect.width,
				height: rect.height,
				displayId,
				record,
			});
		},
		[displayId],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				finish(null);
			} else if (event.key === "Enter") {
				event.preventDefault();
				finish(true);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [finish]);

	const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		const target = event.target as HTMLElement;
		if (target.closest("[data-picker-toolbar]")) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		const handle = target.closest<HTMLElement>("[data-picker-handle]")?.dataset.pickerHandle as
			| AreaHandle
			| undefined;
		const current = selectionRef.current;
		if (handle && current) {
			dragRef.current = {
				kind: "resize",
				handle,
				startX: event.clientX,
				startY: event.clientY,
				rect: current.rect,
				moved: false,
			};
		} else if (current && rectContains(current.rect, event.clientX, event.clientY)) {
			dragRef.current = {
				kind: "move",
				startX: event.clientX,
				startY: event.clientY,
				rect: current.rect,
				moved: false,
			};
		} else {
			dragRef.current = { kind: "press", startX: event.clientX, startY: event.clientY };
		}
	};

	const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		const bounds = viewport();
		if (!drag) {
			const current = selectionRef.current;
			setHover(
				current && rectContains(current.rect, event.clientX, event.clientY)
					? null
					: targetAt(event.clientX, event.clientY),
			);
			return;
		}

		if (drag.kind === "press") {
			const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
			if (distance < DRAG_THRESHOLD) return;
			dragRef.current = { kind: "draw", originX: drag.startX, originY: drag.startY };
			setHover(null);
		}

		const active = dragRef.current;
		if (!active || active.kind === "press") return;
		if (active.kind === "draw") {
			setDragging(true);
			setSelection({
				kind: "area",
				rect: normalizeAreaRect(
					{
						x: active.originX,
						y: active.originY,
						width: event.clientX - active.originX,
						height: event.clientY - active.originY,
					},
					bounds,
				),
			});
			return;
		}

		const dx = event.clientX - active.startX;
		const dy = event.clientY - active.startY;
		// A click inside a picked window keeps it; only real movement turns it into an area.
		if (!active.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD / 2) return;
		active.moved = true;
		setDragging(true);
		setSelection({
			kind: "area",
			rect:
				active.kind === "move"
					? moveAreaRect(active.rect, dx, dy, bounds)
					: resizeAreaRect(active.rect, active.handle, dx, dy, bounds),
		});
	};

	const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		const drag = dragRef.current;
		dragRef.current = null;
		setDragging(false);
		if (drag?.kind === "press") {
			// A click picks the window under the cursor, or the screen over the desktop.
			setSelection(targetAt(drag.startX, drag.startY));
			setHover(null);
			return;
		}
		const current = selectionRef.current;
		if (
			drag?.kind === "draw" &&
			current &&
			(current.rect.width < DRAG_THRESHOLD || current.rect.height < DRAG_THRESHOLD)
		) {
			setSelection(null);
		}
	};

	const describe = (pick: Selection) =>
		pick.kind === "window"
			? [pick.window.appName, pick.window.title].filter(Boolean).join(" — ")
			: pick.kind === "screen"
				? t("capturePicker.entireScreen", "Entire screen")
				: "";

	const tooSmall =
		selection?.kind === "area" &&
		(selection.rect.width < MIN_AREA_SIZE || selection.rect.height < MIN_AREA_SIZE);
	const rect = selection?.rect ?? null;
	const toolbarTop = rect
		? rect.y + rect.height + TOOLBAR_GAP + TOOLBAR_HEIGHT <= window.innerHeight
			? rect.y + rect.height + TOOLBAR_GAP
			: rect.y - TOOLBAR_GAP - TOOLBAR_HEIGHT >= 0
				? rect.y - TOOLBAR_GAP - TOOLBAR_HEIGHT
				: rect.y + rect.height - TOOLBAR_HEIGHT - TOOLBAR_GAP
		: 0;
	const placeLabel = (target: AreaRect): CSSProperties =>
		target.y >= 30 ? { top: -26, left: 0 } : { top: 6, left: 6 };

	return (
		<div
			className="fixed inset-0 select-none overflow-hidden"
			style={{
				cursor: "crosshair",
				background: selection || hover ? "transparent" : DIM,
			}}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerUp}
			onPointerLeave={() => {
				if (!dragRef.current) setHover(null);
			}}
			onDoubleClick={(event) => {
				const current = selectionRef.current;
				if (current && rectContains(current.rect, event.clientX, event.clientY))
					finish(true);
			}}
			onContextMenu={(event) => {
				event.preventDefault();
				finish(null);
			}}
		>
			{hover && !dragging && (
				<div
					className="pointer-events-none absolute"
					style={{
						left: hover.rect.x,
						top: hover.rect.y,
						width: hover.rect.width,
						height: hover.rect.height,
						background: selection ? "transparent" : "rgba(10,132,255,0.16)",
						boxShadow: selection
							? `inset 0 0 0 2px ${HIGHLIGHT}`
							: `inset 0 0 0 2px ${HIGHLIGHT}, 0 0 0 100vmax ${DIM}`,
					}}
				>
					<div
						className="absolute max-w-[min(520px,90%)] truncate whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium text-white"
						style={{ ...placeLabel(hover.rect), background: HIGHLIGHT }}
					>
						{describe(hover)} · {sizeLabel(hover.rect)}
					</div>
				</div>
			)}

			{selection === null ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center">
					<div className="rounded-full bg-[rgba(18,18,22,0.88)] px-4 py-2 text-[13px] font-medium text-white/90 shadow-lg ring-1 ring-white/10 backdrop-blur-md">
						{t(
							"capturePicker.hint",
							"Click a window or the desktop, or drag an area · Esc to cancel",
						)}
					</div>
				</div>
			) : (
				<>
					<div
						className="absolute"
						style={{
							left: selection.rect.x,
							top: selection.rect.y,
							width: selection.rect.width,
							height: selection.rect.height,
							cursor: dragging ? "grabbing" : "move",
							boxShadow: `0 0 0 100vmax ${DIM}`,
							outline: "1px solid rgba(255,255,255,0.95)",
							outlineOffset: selection.kind === "screen" ? -1 : 0,
						}}
					>
						{AREA_HANDLES.map((handle) => (
							<div
								key={handle}
								data-picker-handle={handle}
								className="absolute h-[11px] w-[11px] rounded-full border border-black/30 bg-white shadow"
								style={{
									left: HANDLE_POSITIONS[handle].left,
									top: HANDLE_POSITIONS[handle].top,
									transform: "translate(-50%, -50%)",
									cursor: HANDLE_POSITIONS[handle].cursor,
								}}
							/>
						))}
						<div
							className="pointer-events-none absolute max-w-[min(520px,90%)] truncate whitespace-nowrap rounded-md bg-[rgba(18,18,22,0.88)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-white/90"
							style={placeLabel(selection.rect)}
						>
							{selection.kind === "area"
								? sizeLabel(selection.rect)
								: `${describe(selection)} · ${sizeLabel(selection.rect)}`}
						</div>
					</div>
					{!dragging && (
						<div
							data-picker-toolbar
							className="absolute flex items-center gap-1 rounded-full bg-[rgba(18,18,22,0.92)] p-1 text-[13px] font-medium text-white shadow-xl ring-1 ring-white/10 backdrop-blur-md"
							style={{
								top: toolbarTop,
								left: Math.min(
									Math.max(selection.rect.x + selection.rect.width / 2, 160),
									window.innerWidth - 160,
								),
								height: TOOLBAR_HEIGHT,
								transform: "translateX(-50%)",
								cursor: "default",
							}}
						>
							<button
								type="button"
								className="h-full rounded-full px-4 text-white/80 hover:bg-white/10 hover:text-white"
								onClick={() => finish(null)}
							>
								{t("capturePicker.cancel", "Cancel")}
							</button>
							<button
								type="button"
								disabled={tooSmall}
								className="h-full rounded-full px-4 text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40"
								onClick={() => finish(false)}
							>
								{t("capturePicker.select", "Select")}
							</button>
							<button
								type="button"
								disabled={tooSmall}
								className="flex h-full items-center gap-2 rounded-full bg-[#e5484d] px-4 text-white hover:bg-[#ec5d62] disabled:opacity-40"
								onClick={() => finish(true)}
							>
								<span className="h-2.5 w-2.5 rounded-full bg-white" />
								{t("capturePicker.record", "Record")}
							</button>
						</div>
					)}
				</>
			)}
		</div>
	);
}

export default CapturePicker;
