import { useState } from "react";
import { createRoot } from "react-dom/client";
import GIF from "gif.js";
import { GifOptimizeSizeControl } from "@/components/video-editor/GifOptimizeSizeCheckbox";
import { GifOptimizationResult } from "@/components/video-editor/GifOptimizationResult";
import { I18nProvider } from "@/contexts/I18nContext";
import { optimizeGif, type GifOptimizationSummary } from "@/lib/exporter/gifOptimization";
import "@/index.css";

const workerScript = new URL("gif.js/dist/gif.worker.js", import.meta.url).toString();
function Fixture() {
	const [selected, setSelected] = useState(false);
	const [summary, setSummary] = useState<GifOptimizationSummary | null>(() => {
		const target = new URLSearchParams(location.search).get("summary");
		if (target !== "met" && target !== "missed" && target !== "failed") return null;
		const optimizedBytes = target === "met" ? 100 : target === "failed" ? 1000 : 200;
		return {
			originalBytes: 1000,
			optimizedBytes,
			savedBytes: 1000 - optimizedBytes,
			reductionPercent: (1000 - optimizedBytes) / 10,
			status: target === "failed" ? "failed" : "optimized",
			originalWidth: 800,
			originalHeight: 600,
			outputWidth: target === "failed" ? 800 : 320,
			outputHeight: target === "failed" ? 600 : 240,
			targetBytes: 100,
			targetReached: target === "met",
		};
	});
	const [verified, setVerified] = useState("");
	async function run() {
		const gif = new GIF({ workers: 1, width: 100, height: 100, repeat: 0, workerScript });
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 100;
		const ctx = canvas.getContext("2d")!;
		for (let i = 0; i < 8; i++) {
			ctx.fillStyle = "#112233";
			ctx.fillRect(0, 0, 100, 100);
			ctx.fillStyle = "#ffaa00";
			ctx.fillRect(i * 5, 20, 10, 10);
			gif.addFrame(canvas, { delay: 100, copy: true });
		}
		const original = await new Promise<Blob>((resolve) => {
			gif.on("finished", resolve);
			gif.render();
		});
		const result = await optimizeGif(original);
		setSummary(result);
		// Compression may reduce colors and dimensions; all frames and playback must match.
		const Decoder = (
			window as unknown as {
				ImageDecoder: new (
					config: object,
				) => {
					tracks: {
						ready: Promise<void>;
						selectedTrack: { frameCount: number; repetitionCount: number };
					};
					decode: (options: { frameIndex: number }) => Promise<{ image: VideoFrame }>;
					close: () => void;
				};
			}
		).ImageDecoder;
		const before = new Decoder({
			data: new Uint8Array(await original.arrayBuffer()),
			type: "image/gif",
		});
		const after = new Decoder({
			data: new Uint8Array(await result.blob.arrayBuffer()),
			type: "image/gif",
		});
		await Promise.all([before.tracks.ready, after.tracks.ready]);
		if (
			before.tracks.selectedTrack.frameCount !== after.tracks.selectedTrack.frameCount ||
			before.tracks.selectedTrack.repetitionCount !==
				after.tracks.selectedTrack.repetitionCount
		)
			throw new Error("GIF track changed");
		for (let i = 0; i < 8; i++) {
			const a = (await before.decode({ frameIndex: i })).image;
			const b = (await after.decode({ frameIndex: i })).image;
			if (a.duration !== b.duration) throw new Error("Timing changed");
			if (b.displayWidth > a.displayWidth || b.displayHeight > a.displayHeight)
				throw new Error("Dimensions increased");
			if (b.displayWidth !== result.outputWidth || b.displayHeight !== result.outputHeight)
				throw new Error("Reported dimensions differ from the GIF");
			a.close();
			b.close();
		}
		before.close();
		after.close();
		setVerified("Frames, timing and loop preserved");
	}
	return (
		<main className="m-8 w-80 rounded-xl bg-background p-5 text-foreground space-y-4">
			<GifOptimizeSizeControl selected={selected} onChange={setSelected} />
			<button onClick={() => void run().catch((error) => setVerified(String(error)))}>
				Optimize sample
			</button>
			{summary && <GifOptimizationResult summary={summary} />}
			<output>{verified}</output>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<Fixture />
	</I18nProvider>,
);
