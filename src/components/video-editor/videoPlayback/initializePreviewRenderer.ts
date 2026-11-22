import { Application } from "pixi.js";
import {
	destroyPixiApplication,
	initializePixiApplicationWithTimeout,
} from "@/lib/pixiApplicationLifecycle";

type PixiPreviewBackend = "webgpu" | "webgl";
type PixiRendererAttempt = {
	backend: PixiPreviewBackend;
	message: string;
};
const PIXI_RENDERER_INIT_TIMEOUT_MS = 8_000;
export function toRendererErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error ?? "Unknown renderer init error");
}
export function summarizeRendererAttempts(attempts: readonly PixiRendererAttempt[]): string {
	const details = attempts.map((attempt) => `${attempt.backend}: ${attempt.message}`).join(" | ");
	return `No supported Pixi preview renderer was available. Attempted: ${details}`;
}
export const initializePixiRenderer = async (container: HTMLDivElement): Promise<Application> => {
	const backendOrder: PixiPreviewBackend[] = ["webgl", "webgpu"];
	const attempts: PixiRendererAttempt[] = [];

	for (const backend of backendOrder) {
		if (backend === "webgpu" && !(typeof navigator !== "undefined" && "gpu" in navigator)) {
			attempts.push({
				backend,
				message: "WebGPU runtime is unavailable in this browser.",
			});
			continue;
		}

		const rendererApp = new Application();
		const initStarted = performance.now();
		try {
			await initializePixiApplicationWithTimeout(
				rendererApp,
				{
					width: container.clientWidth,
					height: container.clientHeight,
					backgroundAlpha: 0,
					antialias: true,
					failIfMajorPerformanceCaveat: false,
					resolution: window.devicePixelRatio || 1,
					autoDensity: true,
					preference: backend,
					autoStart: false,
					sharedTicker: false,
				},
				PIXI_RENDERER_INIT_TIMEOUT_MS,
				backend,
			);
			return rendererApp;
		} catch (error) {
			const elapsed = Math.round(performance.now() - initStarted);
			attempts.push({
				backend,
				message: `${toRendererErrorMessage(error)} (after ${elapsed}ms)`,
			});

			destroyPixiApplication(rendererApp, `${backend} preview renderer initialization`);
		}
	}

	throw new Error(summarizeRendererAttempts(attempts));
};
