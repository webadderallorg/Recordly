import { useCallback, useEffect, useState } from "react";
import { MockupScene } from "@/scene/MockupScene";
import { useAnimationTimeline } from "@/hooks/engine/useAnimationTimeline";
import { useVideoUpload } from "@/hooks/engine/useVideoUpload";
import { generateAnimation } from "@/engine/claudeBridge";

// ─── Placeholder shell ────────────────────────────────────────────────────────
// Minimal wiring harness — not the final UI.
// Replace this render when the HTML design arrives from Claude design tool.
// All engine hooks stay exactly as-is; only this JSX changes.

export default function App() {
	const [timeline, controls] = useAnimationTimeline(5);
	const [videoState, videoControls] = useVideoUpload();
	const [isGenerating, setIsGenerating] = useState(false);
	const [log, setLog] = useState<string[]>([]);
	const [apiKey, setApiKey] = useState("");

	// Sync video currentTime to timeline scrub position
	useEffect(() => {
		videoControls.seekTo(timeline.position);
	}, [timeline.position, videoControls]);

	useEffect(() => {
		if (timeline.isPlaying) {
			videoControls.play();
		} else {
			videoControls.pause();
		}
	}, [timeline.isPlaying, videoControls]);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			const file = e.dataTransfer.files[0];
			if (file?.type.startsWith("video/")) {
				videoControls.loadFile(file);
			}
		},
		[videoControls],
	);

	const handleGenerate = useCallback(async () => {
		if (!apiKey) {
			alert("Enter your Anthropic API key first");
			return;
		}
		setIsGenerating(true);
		setLog([]);
		try {
			await generateAnimation({
				apiKey,
				style: "apple",
				duration: timeline.duration,
				fps: 30,
				deviceType: "phone",
				onProgress: (msg) => setLog((prev) => [...prev, msg]),
				onFinalize: (summary) => setLog((prev) => [...prev, `✓ ${summary}`]),
			});
		} finally {
			setIsGenerating(false);
		}
	}, [apiKey, timeline.duration]);

	return (
		<div
			style={{
				display: "flex",
				height: "100vh",
				background: "#0f0f12",
				color: "#fff",
				fontFamily: "monospace",
			}}
		>
			{/* LEFT: controls placeholder */}
			<div
				style={{
					width: 280,
					padding: 16,
					borderRight: "1px solid #222",
					display: "flex",
					flexDirection: "column",
					gap: 12,
					overflow: "auto",
				}}
			>
				<div style={{ fontSize: 13, fontWeight: 600, color: "#888" }}>MOCKLY STUDIO</div>
				<div style={{ fontSize: 11, color: "#555" }}>engine wiring — UI coming from design</div>

				<label style={{ fontSize: 11, color: "#888" }}>
					Anthropic API Key
					<input
						type="password"
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
						style={{
							display: "block",
							width: "100%",
							marginTop: 4,
							padding: "4px 8px",
							background: "#1a1a20",
							border: "1px solid #333",
							borderRadius: 4,
							color: "#fff",
							fontSize: 11,
						}}
						placeholder="sk-ant-..."
					/>
				</label>

				<button
					type="button"
					onClick={handleGenerate}
					disabled={isGenerating}
					style={{
						padding: "8px 12px",
						background: isGenerating ? "#333" : "#2563eb",
						border: "none",
						borderRadius: 6,
						color: "#fff",
						cursor: "pointer",
						fontSize: 12,
					}}
				>
					{isGenerating ? "Generating…" : "✦ Generate Animation"}
				</button>

				<button
					type="button"
					onClick={timeline.isPlaying ? controls.pause : controls.play}
					style={{
						padding: "8px 12px",
						background: "#1a1a20",
						border: "1px solid #333",
						borderRadius: 6,
						color: "#fff",
						cursor: "pointer",
						fontSize: 12,
					}}
				>
					{timeline.isPlaying ? "⏸ Pause" : "▶ Play"}
				</button>

				<div style={{ fontSize: 11, color: "#555" }}>
					{timeline.position.toFixed(2)}s / {timeline.duration}s
				</div>

				<div
					style={{
						maxHeight: 200,
						overflow: "auto",
						fontSize: 10,
						color: "#666",
						lineHeight: 1.6,
					}}
				>
					{log.map((l, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: stable log lines
						<div key={i}>{l}</div>
					))}
				</div>

				<div style={{ fontSize: 11, color: "#555", marginTop: "auto" }}>
					Drop a video file on the canvas →
				</div>
			</div>

			{/* CENTER: 3D canvas */}
			<div
				style={{ flex: 1, position: "relative" }}
				onDrop={handleDrop}
				onDragOver={(e) => e.preventDefault()}
			>
				<MockupScene
					cameraValues={timeline.cameraValues}
					deviceValues={timeline.deviceValues}
					screenTexture={videoState.videoTexture}
					deviceType="phone"
					hdri="studio"
					background={null}
					depthOfField={false}
					bloom={false}
				/>

				{!videoState.isReady && (
					<div
						style={{
							position: "absolute",
							inset: 0,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: "#333",
							pointerEvents: "none",
							fontSize: 13,
						}}
					>
						Drop a video file here
					</div>
				)}
			</div>
		</div>
	);
}
