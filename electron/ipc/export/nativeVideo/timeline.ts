import fs from "node:fs/promises";
import { type NativeVideoExportEditedTrackSegment } from "../../nativeVideoExport";
import { formatCliNumber } from "./layout";
import {
	type NativeStaticLayoutExportOptions,
	type NativeStaticLayoutTimelineSegment,
} from "./types";

export function buildNativeStaticLayoutTimelineSegments(
	segments: NativeVideoExportEditedTrackSegment[],
): NativeStaticLayoutTimelineSegment[] {
	const timelineSegments: NativeStaticLayoutTimelineSegment[] = [];
	let outputCursorMs = 0;

	for (const segment of segments) {
		const sourceStartMs = Math.max(0, segment.startMs);
		const sourceEndMs = Math.max(sourceStartMs, segment.endMs);
		const speed = segment.speed;
		if (
			!Number.isFinite(sourceStartMs) ||
			!Number.isFinite(sourceEndMs) ||
			!Number.isFinite(speed) ||
			sourceEndMs - sourceStartMs <= 0.5 ||
			speed <= 0
		) {
			return [];
		}

		const outputDurationMs = (sourceEndMs - sourceStartMs) / speed;
		if (!Number.isFinite(outputDurationMs) || outputDurationMs <= 0.5) {
			return [];
		}

		const outputStartMs = outputCursorMs;
		const outputEndMs = outputStartMs + outputDurationMs;
		timelineSegments.push({
			sourceStartMs,
			sourceEndMs,
			outputStartMs,
			outputEndMs,
			speed,
		});
		outputCursorMs = outputEndMs;
	}

	return timelineSegments;
}

export function validateNativeStaticLayoutTimelineSegments(
	segments: NativeStaticLayoutTimelineSegment[] | undefined,
	durationSec: number,
) {
	if (!segments?.length) {
		return [];
	}

	const normalized: NativeStaticLayoutTimelineSegment[] = [];
	let expectedOutputStartMs = 0;
	for (const segment of segments) {
		const sourceStartMs = Math.max(0, segment.sourceStartMs);
		const sourceEndMs = Math.max(sourceStartMs, segment.sourceEndMs);
		const outputStartMs = Math.max(0, segment.outputStartMs);
		const outputEndMs = Math.max(outputStartMs, segment.outputEndMs);
		const speed = segment.speed;
		if (
			!Number.isFinite(sourceStartMs) ||
			!Number.isFinite(sourceEndMs) ||
			!Number.isFinite(outputStartMs) ||
			!Number.isFinite(outputEndMs) ||
			!Number.isFinite(speed) ||
			sourceEndMs - sourceStartMs <= 0.5 ||
			outputEndMs - outputStartMs <= 0.5 ||
			speed <= 0
		) {
			throw new Error("Native timeline map contains an invalid segment");
		}

		if (Math.abs(outputStartMs - expectedOutputStartMs) > 2) {
			throw new Error("Native timeline map output ranges must be contiguous");
		}

		const expectedOutputDurationMs = (sourceEndMs - sourceStartMs) / speed;
		if (Math.abs(expectedOutputDurationMs - (outputEndMs - outputStartMs)) > 2) {
			throw new Error("Native timeline map segment speed does not match its output duration");
		}

		normalized.push({
			sourceStartMs,
			sourceEndMs,
			outputStartMs,
			outputEndMs,
			speed,
		});
		expectedOutputStartMs = outputEndMs;
	}

	if (Math.abs(expectedOutputStartMs / 1000 - durationSec) > 0.05) {
		throw new Error("Native timeline map duration does not match the export duration");
	}

	return normalized;
}

export async function prepareNativeStaticLayoutTimelineMap(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
) {
	const segments = validateNativeStaticLayoutTimelineSegments(
		options.timelineSegments,
		options.durationSec,
	);
	if (segments.length === 0) {
		return null;
	}

	const lines = segments.map((segment) =>
		[
			segment.sourceStartMs,
			segment.sourceEndMs,
			segment.outputStartMs,
			segment.outputEndMs,
			segment.speed,
		]
			.map(formatCliNumber)
			.join(","),
	);
	await fs.writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
	return outputPath;
}
