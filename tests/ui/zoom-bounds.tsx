import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CURSOR_MOTION_PRESETS } from "@/components/video-editor/cursorMotionPresets";
import { useEditorHistory } from "@/components/video-editor/hooks/useEditorHistory";
import { useTimelineState } from "@/components/video-editor/state/useTimelineState";
import TimelineEditor from "@/components/video-editor/timeline/TimelineEditor";
import type { ZoomRegion } from "@/components/video-editor/types";
import { I18nProvider } from "@/contexts/I18nContext";
import { ShortcutsProvider } from "@/contexts/ShortcutsContext";
import "@/index.css";

const first: ZoomRegion = {
	id: "first",
	startMs: 1000,
	endMs: 4000,
	depth: 3,
	focus: { cx: 0.35, cy: 0.5 },
	mode: "manual",
};
const constraint = new URLSearchParams(location.search).get("constraint");
const totalMs =
	constraint === "timeline" ? 1500 : constraint === "rounded-boundary" ? 16256 : 12000;
const clips = [{ id: "clip", startMs: 0, endMs: totalMs, speed: 1 }];
function ZoomBounds() {
	const timeline = useTimelineState();
	const {
		zoomRegions: regions,
		setZoomRegions: commit,
		selectedZoomId: selected,
		setSelectedZoomId: setSelected,
	} = timeline;
	const [connected, setConnected] = useState(true);
	const nextId = useRef(0);
	const history = useEditorHistory({
		timeline,
		nextZoomIdRef: nextId,
		nextClipIdRef: useRef(1),
		nextAnnotationIdRef: useRef(1),
		nextAudioIdRef: useRef(1),
		nextAnnotationZIndexRef: useRef(1),
	});
	useEffect(() => {
		commit(
			constraint === "rounded-boundary"
				? [{ ...first, startMs: 11228, endMs: totalMs }]
				: constraint
					? [
							{ ...first, endMs: 1500 },
							...(constraint === "neighbor"
								? [
										{
											...first,
											id: "after",
											startMs: 1501,
											endMs: 2500,
											depth: 2 as const,
										},
									]
								: []),
						]
					: [first],
		);
		timeline.setClipRegions(clips);
	}, [commit, timeline.setClipRegions]);
	const add = (id: string, startMs: number, endMs: number) =>
		commit([...regions.filter((r) => r.id !== id), { ...first, id, startMs, endMs, depth: 2 }]);
	// Match the editor's appearance object: connection settings belong to playback,
	// while TimelineEditor consumes only the nominal entrance/exit settings.
	const appearance = { ...CURSOR_MOTION_PRESETS.focused, connectZooms: connected };
	return (
		<main
			style={{ width: 1200 }}
			data-regions={JSON.stringify(regions)}
			data-connected={connected}
		>
			<button onClick={() => add("before", 0, 500)}>Add before</button>
			<button onClick={() => add("after", 4500, 5500)}>Add after</button>
			<button onClick={() => add("after", 4500, 4600)}>Add short after</button>
			<button onClick={() => commit(regions.filter((r) => r.id === "first"))}>
				Remove neighbors
			</button>
			<button
				onClick={() =>
					commit(
						regions.map((r) =>
							r.id === "after"
								? { ...r, startMs: 8000, endMs: 8000 + r.endMs - r.startMs }
								: r,
						),
					)
				}
			>
				Move neighbor away
			</button>
			<button onClick={() => setConnected((v) => !v)}>Toggle connections</button>
			<button disabled={!history.canUndo} onClick={history.handleUndo}>
				Undo edit
			</button>
			<div style={{ height: 300 }}>
				<TimelineEditor
					videoDuration={totalMs / 1000}
					currentTime={0}
					zoomRegions={regions}
					clipRegions={clips}
					zoomPresentationOptions={appearance}
					selectedZoomId={selected}
					onSelectZoom={setSelected}
					onZoomAdded={(span) => add(`added-${nextId.current++}`, span.start, span.end)}
					onZoomSpanChange={(id, span) =>
						commit(
							regions.map((r) =>
								r.id === id
									? {
											...r,
											startMs: Math.round(span.start),
											endMs: Math.round(span.end),
										}
									: r,
							),
						)
					}
					onZoomDelete={(id) => commit(regions.filter((r) => r.id !== id))}
				/>
			</div>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<ShortcutsProvider>
			<ZoomBounds />
		</ShortcutsProvider>
	</I18nProvider>,
);
