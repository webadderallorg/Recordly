import { useEffect, useRef } from "react";
import type { ExportSettings } from "@/lib/exporter";
import type { getSmokeExportConfig } from "../smokeExportConfig";
import { writeSmokeExportReport } from "./exportPersistence";

const SMOKE_EXPORT_READY_TIMEOUT_MS = 30_000;

type UseSmokeExportAutomationInput = {
	config: ReturnType<typeof getSmokeExportConfig>;
	cursorTelemetrySourcePath: string | null;
	duration: number;
	error: string | null;
	isPreviewReady: boolean;
	loading: boolean;
	videoPath: string | null;
	videoSourcePath: string | null;
	handleExport: (settings: ExportSettings) => void;
};

export function useSmokeExportAutomation({
	config,
	cursorTelemetrySourcePath,
	duration,
	error,
	isPreviewReady,
	loading,
	videoPath,
	videoSourcePath,
	handleExport,
}: UseSmokeExportAutomationInput) {
	const startedRef = useRef(false);
	const readyStateRef = useRef<Record<string, unknown>>({});

	useEffect(() => {
		readyStateRef.current = {
			cursorTelemetrySourcePath,
			duration,
			hasVideoPath: Boolean(videoPath),
			isPreviewReady,
			loading,
			projectPath: config.projectPath ?? null,
			videoSourcePath,
		};
	}, [
		cursorTelemetrySourcePath,
		duration,
		isPreviewReady,
		loading,
		config.projectPath,
		videoPath,
		videoSourcePath,
	]);

	useEffect(() => {
		if (!config.enabled) return;
		const timeoutId = window.setTimeout(() => {
			if (startedRef.current) return;
			startedRef.current = true;
			void writeSmokeExportReport(config.outputPath, {
				success: false,
				phase: "ready",
				error: `Smoke export did not become ready within ${SMOKE_EXPORT_READY_TIMEOUT_MS}ms.`,
				readyState: readyStateRef.current,
			}).finally(() => window.close());
		}, SMOKE_EXPORT_READY_TIMEOUT_MS);
		return () => window.clearTimeout(timeoutId);
	}, [config.enabled, config.outputPath]);

	useEffect(() => {
		if (!config.enabled || startedRef.current) return;
		if (error) {
			startedRef.current = true;
			console.error(`[smoke-export] ${error}`);
			void writeSmokeExportReport(config.outputPath, {
				success: false,
				phase: "load",
				error,
				readyState: readyStateRef.current,
			}).finally(() => window.close());
			return;
		}
		if (!videoPath || loading || !isPreviewReady || duration <= 0) return;
		if (
			config.projectPath &&
			videoSourcePath &&
			cursorTelemetrySourcePath !== videoSourcePath
		) {
			return;
		}

		startedRef.current = true;
		void handleExport({
			format: "mp4",
			quality: "good",
			encodingMode: config.encodingMode ?? "balanced",
		});
	}, [
		cursorTelemetrySourcePath,
		error,
		handleExport,
		isPreviewReady,
		loading,
		duration,
		config,
		videoPath,
		videoSourcePath,
	]);
}
