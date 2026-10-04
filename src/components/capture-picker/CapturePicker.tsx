import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
	frontmostAt,
	MIN_AREA_SIZE,
	normalizeAreaRect,
	moveAreaRect,
	resizeAreaRect,
	rectContains,
	AREA_HANDLES,
	type AreaHandle,
	type AreaRect,
} from "./areaGeometry";

type Target =
	| { kind: "window"; window: CapturePickerWindow; rect: AreaRect }
	| { kind: "screen"; rect: AreaRect }
	| { kind: "area"; rect: AreaRect };

function screenRect() {
	return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}

/** Chooses a source only. Recording remains controlled by the existing HUD. */
export function CapturePicker() {
	const displayId = Number(new URLSearchParams(window.location.search).get("displayId"));
	const [target, setTarget] = useState<Target | null>(null);
	const [allowArea, setAllowArea] = useState(false);
	const windows = useRef<{ window: CapturePickerWindow; rect: AreaRect }[]>([]);
	const origin = useRef({ x: window.screenX, y: window.screenY });
	const current = useRef<Target | null>(null);
	const press = useRef<{
		x: number;
		y: number;
		drawing: boolean;
		rect?: AreaRect;
		handle?: AreaHandle;
		moving?: boolean;
	} | null>(null);
	const editingArea = useRef(false);
	const completed = useRef(false);
	const targetAt = useCallback((x: number, y: number): Target => {
		const hit = frontmostAt(windows.current, x, y);
		return hit
			? { kind: "window", window: hit.window, rect: hit.rect }
			: { kind: "screen", rect: screenRect() };
	}, []);
	const update = (next: Target) => {
		current.current = next;
		setTarget(next);
	};
	const finish = useCallback(
		(pick: Target | null) => {
			if (completed.current) return;
			if (
				pick?.kind === "area" &&
				(pick.rect.width < MIN_AREA_SIZE || pick.rect.height < MIN_AREA_SIZE)
			)
				return;
			completed.current = true;
			const common = { displayId, record: false };
			void window.electronAPI.completeCapturePick(
				!pick
					? null
					: pick.kind === "window"
						? { ...common, kind: "window", windowId: pick.window.id }
						: pick.kind === "screen"
							? { ...common, kind: "screen" }
							: {
									...common,
									kind: "area",
									...pick.rect,
									x: origin.current.x + pick.rect.x,
									y: origin.current.y + pick.rect.y,
								},
			);
		},
		[displayId],
	);
	useEffect(() => {
		let disposed = false;
		void window.electronAPI
			.getCapturePickerContext(displayId)
			.then((context) => {
				if (disposed) return;
				if (context.displayBounds) origin.current = context.displayBounds;
				setAllowArea(context.allowArea === true);
				windows.current = context.windows
					.map((entry) => ({
						window: entry,
						rect: normalizeAreaRect(
							{
								...entry,
								x: entry.x - origin.current.x,
								y: entry.y - origin.current.y,
							},
							screenRect(),
						),
					}))
					.filter((entry) => entry.rect.width > 0 && entry.rect.height > 0);
				const next =
					context.lastArea && context.allowArea
						? {
								kind: "area" as const,
								rect: normalizeAreaRect(
									{
										...context.lastArea,
										x: context.lastArea.x - origin.current.x,
										y: context.lastArea.y - origin.current.y,
									},
									screenRect(),
								),
							}
						: context.cursor
							? targetAt(
									context.cursor.x - origin.current.x,
									context.cursor.y - origin.current.y,
								)
							: null;
				current.current = next;
				editingArea.current = next?.kind === "area";
				setTarget(next);
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						if (!disposed) window.electronAPI.capturePickerReady();
					}),
				);
			})
			.catch(() => {
				if (!disposed) finish(null);
			});
		return () => {
			disposed = true;
		};
	}, [displayId, targetAt, finish]);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				finish(null);
			}
			if (event.key === "Enter") {
				event.preventDefault();
				if (current.current) finish(current.current);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [finish]);
	const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const start = press.current;
		if (start?.rect) {
			const dx = event.clientX - start.x;
			const dy = event.clientY - start.y;
			update({
				kind: "area",
				rect: start.handle
					? resizeAreaRect(start.rect, start.handle, dx, dy, screenRect())
					: moveAreaRect(start.rect, dx, dy, screenRect()),
			});
		} else if (
			start &&
			allowArea &&
			(start.drawing || Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4)
		) {
			start.drawing = true;
			editingArea.current = true;
			update({
				kind: "area",
				rect: normalizeAreaRect(
					{
						x: start.x,
						y: start.y,
						width: event.clientX - start.x,
						height: event.clientY - start.y,
					},
					screenRect(),
				),
			});
		} else if (!start && !editingArea.current) update(targetAt(event.clientX, event.clientY));
	};
	const label =
		target?.kind === "window"
			? [target.window.appName, target.window.title].filter(Boolean).join(" — ")
			: target?.kind === "screen"
				? "Entire screen"
				: "Area";
	return (
		<div
			className="fixed inset-0 select-none overflow-hidden"
			style={{ cursor: "crosshair", background: target ? "transparent" : "rgba(0,0,0,0.38)" }}
			onPointerMove={onMove}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				const area =
					editingArea.current && current.current?.kind === "area"
						? current.current.rect
						: null;
				const handle = (event.target as HTMLElement).closest<HTMLElement>(
					"[data-area-handle]",
				)?.dataset.areaHandle as AreaHandle | undefined;
				press.current = {
					x: event.clientX,
					y: event.clientY,
					drawing: false,
					...(area && (handle || rectContains(area, event.clientX, event.clientY))
						? { rect: area, handle, moving: !handle }
						: {}),
				};
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerUp={(event) => {
				if (event.button !== 0 || !press.current) return;
				const start = press.current;
				press.current = null;
				if (event.currentTarget.hasPointerCapture(event.pointerId))
					event.currentTarget.releasePointerCapture(event.pointerId);
				if (start.drawing || start.rect) return;
				if (editingArea.current) {
					editingArea.current = false;
				}
				finish(targetAt(event.clientX, event.clientY));
			}}
			onPointerCancel={() => {
				press.current = null;
			}}
			onContextMenu={(event) => {
				event.preventDefault();
				finish(null);
			}}
		>
			{target && (
				<div
					className={
						target.kind === "area" && editingArea.current
							? "absolute cursor-move"
							: "pointer-events-none absolute"
					}
					style={{
						left: target.rect.x,
						top: target.rect.y,
						width: target.rect.width,
						height: target.rect.height,
						background: "rgba(10,132,255,0.16)",
						boxShadow: "0 0 0 100vmax rgba(0,0,0,0.38)",
						outline: "2px solid #0a84ff",
						outlineOffset: -2,
					}}
				>
					{target.kind === "area" &&
						AREA_HANDLES.map((handle) => {
							const left = handle.includes("w")
								? "0%"
								: handle.includes("e")
									? "100%"
									: "50%";
							const top = handle.includes("n")
								? "0%"
								: handle.includes("s")
									? "100%"
									: "50%";
							return (
								<div
									key={handle}
									data-area-handle={handle}
									className="absolute size-3 rounded-full border border-black/30 bg-white"
									style={{
										left,
										top,
										transform: "translate(-50%, -50%)",
										cursor: `${handle}-resize`,
									}}
								/>
							);
						})}
					<div
						className="pointer-events-none absolute whitespace-nowrap rounded-md bg-blue-600 px-2 py-1 text-xs text-white"
						style={{ top: target.rect.y >= 30 ? -28 : 6, left: 6 }}
					>
						{label} · {Math.round(target.rect.width)} × {Math.round(target.rect.height)}
					</div>
				</div>
			)}
			<div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center">
				<div className="rounded-full bg-black/80 px-4 py-2 text-sm text-white">
					{target?.kind === "area" && editingArea.current
						? target.rect.width < MIN_AREA_SIZE || target.rect.height < MIN_AREA_SIZE
							? "Area is too small · Drag to enlarge · Esc to cancel"
							: "Move or resize the area · Enter to select · Esc to cancel"
						: allowArea
							? "Click a window or the desktop, or drag an area · Esc to cancel"
							: "Click a window or the desktop · Esc to cancel"}
				</div>
			</div>
		</div>
	);
}
export default CapturePicker;
