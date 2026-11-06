import { getWebcamGlassRimImage } from "../video-editor/webcamGlassRim";
import type { MouseEventHandler, ReactNode } from "react";
import type { useWebcamPreviewOverlay } from "./hooks/useWebcamPreviewOverlay";
import styles from "./LaunchWindow.module.css";

/** Renders the circular floating camera and its docked recording controls. */
export function FloatingWebcamPreviewView({
	preview,
	hudBar,
	finishHudTransition,
	handleHudMouseEnter,
	handleHudMouseLeave,
	title,
}: {
	preview: ReturnType<typeof useWebcamPreviewOverlay>;
	hudBar: ReactNode;
	finishHudTransition: () => void;
	handleHudMouseEnter: () => void;
	handleHudMouseLeave: MouseEventHandler<HTMLDivElement>;
	title: string;
}) {
	const {
		recordingWebcamPreviewContainerRef,
		webcamPreviewOffset,
		handleWebcamPreviewPointerDown,
		handleWebcamPreviewPointerOver,
		handleWebcamPreviewPointerLeave,
		handleWebcamPreviewPointerMove,
		handleWebcamPreviewPointerUp,
		setRecordingWebcamPreviewNode,
	} = preview;

	return (
		<div
			ref={recordingWebcamPreviewContainerRef}
			onPointerDownCapture={finishHudTransition}
			data-floating-webcam-preview
			className={`${styles.recordingWebcamPreview} ${styles.electronNoDrag} pointer-events-auto`}
			data-hud-interactive
			title={title}
			style={{
				transform: `translate(${webcamPreviewOffset.x}px, ${webcamPreviewOffset.y}px)`,
			}}
			onMouseEnter={handleHudMouseEnter}
			onMouseLeave={handleHudMouseLeave}
			onPointerDown={handleWebcamPreviewPointerDown}
			onPointerOver={handleWebcamPreviewPointerOver}
			onPointerLeave={handleWebcamPreviewPointerLeave}
			onPointerMove={handleWebcamPreviewPointerMove}
			onPointerUp={handleWebcamPreviewPointerUp}
			onPointerCancel={handleWebcamPreviewPointerUp}
			onLostPointerCapture={handleWebcamPreviewPointerUp}
		>
			{hudBar}
			<div
				className="absolute inset-0"
				style={{ filter: "drop-shadow(0 3px 10px rgb(0 0 0 / 0.14))" }}
			>
				<video
					ref={setRecordingWebcamPreviewNode}
					className={styles.recordingWebcamPreviewVideo}
					muted
					playsInline
					style={{
						transform: "scaleX(-1)",

						clipPath: "circle(50%)",
					}}
				/>
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-0"
					style={{
						backgroundImage: getWebcamGlassRimImage(100, 100, 50, "circle"),
						backgroundSize: "100% 100%",
					}}
				/>
			</div>
		</div>
	);
}
