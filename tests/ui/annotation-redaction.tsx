import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AnnotationOverlay } from "@/components/video-editor/AnnotationOverlay";
import { type AnnotationRegion, DEFAULT_ANNOTATION_STYLE } from "@/components/video-editor/types";
import { I18nProvider } from "@/contexts/I18nContext";
import "@/index.css";

function RedactionPreview() {
	const [selected, setSelected] = useState(false);
	const [position, setPosition] = useState({ x: 20, y: 20 });
	const [solid, setSolid] = useState(false);
	const annotation: AnnotationRegion = {
		id: "redaction",
		type: "blur",
		startMs: 0,
		endMs: 1000,
		content: "",
		position,
		size: { width: 50, height: 50 },
		style: { ...DEFAULT_ANNOTATION_STYLE, borderRadius: 0 },
		zIndex: 1,
		blurIntensity: 20,
		blurColor: solid ? "#000000" : "",
	};
	return (
		<>
			<button onClick={() => setSelected(!selected)}>Toggle selection</button>
			<button onClick={() => setPosition({ x: 40, y: 20 })}>Move redaction</button>
			<button onClick={() => setSolid(!solid)}>Toggle solid</button>
			<div
				data-scene
				style={{
					position: "relative",
					width: 800,
					height: 400,
					background: "repeating-linear-gradient(90deg, #fff 0px 4px, #000 4px 8px)",
				}}
			>
				<div style={{ position: "absolute", inset: 0, transform: "matrix(1,0,0,1,0,0)" }}>
					<AnnotationOverlay
						annotation={annotation}
						isSelected={selected}
						containerWidth={800}
						containerHeight={400}
						recordingRect={{ x: 0, y: 0, width: 800, height: 400 }}
						sceneTransform={{ scale: 1, x: 0, y: 0 }}
						onPositionChange={(_, next) => setPosition(next)}
						onSizeChange={() => undefined}
						onClick={() => setSelected(true)}
						zIndex={1}
						isSelectedBoost={selected}
					/>
				</div>
			</div>
		</>
	);
}
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<RedactionPreview />
	</I18nProvider>,
);
