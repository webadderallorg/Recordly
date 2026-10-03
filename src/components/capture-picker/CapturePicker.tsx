import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { frontmostAt, MIN_AREA_SIZE, normalizeAreaRect, type AreaRect } from "./areaGeometry";

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
	const press = useRef<{ x: number; y: number; drawing: boolean } | null>(null);
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
		if (
			start &&
			allowArea &&
			(start.drawing || Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4)
		) {
			start.drawing = true;
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
		} else if (!start) update(targetAt(event.clientX, event.clientY));
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
				press.current = { x: event.clientX, y: event.clientY, drawing: false };
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerUp={(event) => {
				if (event.button !== 0 || !press.current) return;
				const start = press.current;
				press.current = null;
				if (event.currentTarget.hasPointerCapture(event.pointerId))
					event.currentTarget.releasePointerCapture(event.pointerId);
				finish(start.drawing ? current.current : targetAt(event.clientX, event.clientY));
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
					className="pointer-events-none absolute"
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
					<div
						className="absolute whitespace-nowrap rounded-md bg-blue-600 px-2 py-1 text-xs text-white"
						style={{ top: target.rect.y >= 30 ? -28 : 6, left: 6 }}
					>
						{label} · {Math.round(target.rect.width)} × {Math.round(target.rect.height)}
					</div>
				</div>
			)}
			<div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center">
				<div className="rounded-full bg-black/80 px-4 py-2 text-sm text-white">
					{allowArea
						? "Click a window or the desktop, or drag an area · Esc to cancel"
						: "Click a window or the desktop · Esc to cancel"}
				</div>
			</div>
		</div>
	);
}
export default CapturePicker;
