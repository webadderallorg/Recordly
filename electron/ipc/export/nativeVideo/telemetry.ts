import fs from "node:fs/promises";
import { formatCliNumber } from "./layout";
import { type NativeStaticLayoutExportOptions } from "./types";

export async function prepareWindowsGpuCursorTelemetry(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
) {
	const telemetry = options.cursorTelemetry;
	if (!telemetry || telemetry.length === 0) {
		return null;
	}

	const lines = telemetry
		.filter((sample) => {
			return (
				Number.isFinite(sample.timeMs) &&
				Number.isFinite(sample.cx) &&
				Number.isFinite(sample.cy)
			);
		})
		.map((sample) => {
			const timeMs = Math.max(0, sample.timeMs);
			const cx = Math.min(1, Math.max(0, sample.cx));
			const cy = Math.min(1, Math.max(0, sample.cy));
			const cursorTypeIndex = Math.max(
				0,
				Math.min(8, Math.round(sample.cursorTypeIndex ?? 0)),
			);
			const bounceScale = Math.min(2, Math.max(0.1, sample.bounceScale ?? 1));
			const visible = sample.visible !== false ? 1 : 0;
			return [
				formatCliNumber(timeMs),
				formatCliNumber(cx),
				formatCliNumber(cy),
				String(cursorTypeIndex),
				formatCliNumber(bounceScale),
				String(visible),
			].join(",");
		});

	if (lines.length === 0) {
		return null;
	}

	await fs.writeFile(outputPath, lines.join("\n"), "utf8");
	return outputPath;
}

export async function prepareWindowsGpuCursorAtlas(
	options: NativeStaticLayoutExportOptions,
	atlasPath: string,
	metadataPath: string,
) {
	const dataUrl = options.cursorAtlasPngDataUrl;
	const entries = options.cursorAtlasEntries;
	if (!dataUrl || !entries?.length) {
		return null;
	}

	const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
	if (!match) {
		return null;
	}

	const metadataLines = entries
		.filter((entry) => {
			return (
				Number.isInteger(entry.index) &&
				Number.isFinite(entry.x) &&
				Number.isFinite(entry.y) &&
				Number.isFinite(entry.width) &&
				Number.isFinite(entry.height) &&
				Number.isFinite(entry.anchorX) &&
				Number.isFinite(entry.anchorY) &&
				Number.isFinite(entry.aspectRatio) &&
				entry.width > 0 &&
				entry.height > 0
			);
		})
		.map((entry) =>
			[
				String(Math.max(0, Math.min(8, entry.index))),
				formatCliNumber(Math.max(0, entry.x)),
				formatCliNumber(Math.max(0, entry.y)),
				formatCliNumber(Math.max(1, entry.width)),
				formatCliNumber(Math.max(1, entry.height)),
				formatCliNumber(Math.min(1, Math.max(0, entry.anchorX))),
				formatCliNumber(Math.min(1, Math.max(0, entry.anchorY))),
				formatCliNumber(Math.max(0.01, entry.aspectRatio)),
			].join(","),
		);
	if (metadataLines.length === 0) {
		return null;
	}

	await fs.writeFile(atlasPath, Buffer.from(match[1], "base64"));
	await fs.writeFile(metadataPath, metadataLines.join("\n"), "utf8");
	return { atlasPath, metadataPath };
}

export async function prepareNvidiaCudaCursorTelemetry(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
) {
	const telemetry = options.cursorTelemetry;
	if (!telemetry || telemetry.length === 0) {
		return null;
	}

	const samples = telemetry
		.filter((sample) => {
			return (
				Number.isFinite(sample.timeMs) &&
				Number.isFinite(sample.cx) &&
				Number.isFinite(sample.cy)
			);
		})
		.map((sample) => ({
			timeMs: Math.max(0, sample.timeMs),
			cx: Math.min(1, Math.max(0, sample.cx)),
			cy: Math.min(1, Math.max(0, sample.cy)),
			cursorTypeIndex: Math.max(0, Math.min(8, Math.round(sample.cursorTypeIndex ?? 0))),
			bounceScale: Math.min(2, Math.max(0.1, sample.bounceScale ?? 1)),
			visible: sample.visible !== false,
		}));
	if (samples.length === 0) {
		return null;
	}

	await fs.writeFile(outputPath, JSON.stringify({ samples }), "utf8");
	return outputPath;
}

export async function prepareNvidiaCudaCursorAtlas(
	options: NativeStaticLayoutExportOptions,
	atlasPath: string,
	metadataPath: string,
) {
	const dataUrl = options.cursorAtlasPngDataUrl;
	const entries = options.cursorAtlasEntries;
	if (!dataUrl || !entries?.length) {
		return null;
	}

	const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
	if (!match) {
		return null;
	}

	const metadataLines = entries
		.filter((entry) => {
			return (
				Number.isInteger(entry.index) &&
				Number.isFinite(entry.x) &&
				Number.isFinite(entry.y) &&
				Number.isFinite(entry.width) &&
				Number.isFinite(entry.height) &&
				Number.isFinite(entry.anchorX) &&
				Number.isFinite(entry.anchorY) &&
				Number.isFinite(entry.aspectRatio) &&
				entry.width > 0 &&
				entry.height > 0
			);
		})
		.map((entry) =>
			[
				String(Math.max(0, Math.min(8, entry.index))),
				formatCliNumber(Math.max(0, entry.x)),
				formatCliNumber(Math.max(0, entry.y)),
				formatCliNumber(Math.max(1, entry.width)),
				formatCliNumber(Math.max(1, entry.height)),
				formatCliNumber(Math.min(1, Math.max(0, entry.anchorX))),
				formatCliNumber(Math.min(1, Math.max(0, entry.anchorY))),
				formatCliNumber(Math.max(0.01, entry.aspectRatio)),
			].join("\t"),
		);
	if (metadataLines.length === 0) {
		return null;
	}

	await fs.writeFile(atlasPath, Buffer.from(match[1], "base64"));
	await fs.writeFile(metadataPath, `${metadataLines.join("\n")}\n`, "utf8");
	return { atlasPath, metadataPath };
}

export async function prepareWindowsGpuZoomTelemetry(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
) {
	const telemetry = options.zoomTelemetry;
	if (!telemetry || telemetry.length === 0) {
		return null;
	}

	const lines = telemetry
		.filter((sample) => {
			return (
				Number.isFinite(sample.timeMs) &&
				Number.isFinite(sample.scale) &&
				Number.isFinite(sample.x) &&
				Number.isFinite(sample.y)
			);
		})
		.map((sample) => {
			const timeMs = Math.max(0, sample.timeMs);
			const scale = Math.max(0.01, sample.scale);
			return [
				formatCliNumber(timeMs),
				formatCliNumber(scale),
				formatCliNumber(sample.x),
				formatCliNumber(sample.y),
			].join(",");
		});

	if (lines.length === 0) {
		return null;
	}

	await fs.writeFile(outputPath, lines.join("\n"), "utf8");
	return outputPath;
}
