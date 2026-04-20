function formatTableCell(value) {
	if (Array.isArray(value)) {
		return value.length > 0 ? value.join(", ") : "-";
	}

	if (value === null || value === undefined || value === "") {
		return "-";
	}

	return String(value).replace(/\s+/g, " ").trim();
}

function printTable(title, columns, rows) {
	if (!Array.isArray(rows) || rows.length === 0) {
		return;
	}

	const formattedRows = rows.map((row) =>
		columns.map((column) => formatTableCell(column.getValue(row))),
	);
	const widths = columns.map((column, columnIndex) => {
		const headerWidth = column.header.length;
		const rowWidth = Math.max(...formattedRows.map((row) => row[columnIndex].length));
		return Math.max(headerWidth, rowWidth);
	});
	const divider = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;

	console.log(`[benchmark-export-queues] ${title}`);
	console.log(
		`| ${columns
			.map((column, columnIndex) => column.header.padEnd(widths[columnIndex]))
			.join(" | ")} |`,
	);
	console.log(divider);
	for (const row of formattedRows) {
		console.log(
			`| ${row.map((value, columnIndex) => value.padEnd(widths[columnIndex])).join(" | ")} |`,
		);
	}
}

function formatMs(value) {
	return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} ms` : "-";
}

function formatDeltaMs(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return "-";
	}

	const roundedValue = Math.round(value);
	return `${roundedValue > 0 ? "+" : ""}${roundedValue} ms`;
}

function formatPercent(value) {
	return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "-";
}

function formatSeconds(value) {
	return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)} s` : "-";
}

function formatMegabytes(value) {
	return typeof value === "number" && Number.isFinite(value)
		? `${(value / (1024 * 1024)).toFixed(2)} MB`
		: "-";
}

function formatBoolean(value) {
	return value ? "Yes" : "No";
}

export function calculateDelta(referenceValue, nextValue) {
	if (
		typeof referenceValue !== "number" ||
		!Number.isFinite(referenceValue) ||
		typeof nextValue !== "number" ||
		!Number.isFinite(nextValue)
	) {
		return { deltaMs: null, deltaPercent: null };
	}

	return {
		deltaMs: nextValue - referenceValue,
		deltaPercent:
			referenceValue > 0 ? ((nextValue - referenceValue) / referenceValue) * 100 : null,
	};
}

function buildRequestedConfigRows(config, benchmarkRequests) {
	const rows = [
		{ key: "Width", value: config.width },
		{ key: "Height", value: config.height },
		{ key: "Frame rate", value: `${config.frameRate} FPS` },
		{ key: "Duration", value: `${config.durationSeconds} s` },
		{ key: "Timeout", value: formatMs(config.timeoutMs) },
		{ key: "Runs per variant", value: config.runsPerVariant },
		{ key: "Pipeline", value: config.exportPipeline ?? "default" },
		{ key: "Requested backends", value: benchmarkRequests.map((request) => request.label) },
		{ key: "Backend sweep", value: formatBoolean(benchmarkRequests.length > 1) },
		{ key: "Encoding mode", value: config.exportEncodingMode ?? "default" },
		{ key: "Shadow intensity", value: config.exportShadowIntensity ?? "default" },
		{ key: "Webcam enabled", value: formatBoolean(config.useWebcamOverlay) },
		{ key: "Experimental native override", value: formatBoolean(config.useNativeExport) },
	];

	if (config.useWebcamOverlay) {
		rows.push(
			{ key: "Webcam width", value: config.webcamWidth },
			{ key: "Webcam height", value: config.webcamHeight },
			{ key: "Webcam shadow", value: config.webcamShadowIntensity ?? "default" },
			{ key: "Webcam size", value: config.webcamSize ?? "default" },
		);
	}

	return rows;
}

export function printRequestedConfigTable(config, benchmarkRequests) {
	printTable(
		"Requested config",
		[
			{ header: "Setting", getValue: (row) => row.key },
			{ header: "Value", getValue: (row) => row.value },
		],
		buildRequestedConfigRows(config, benchmarkRequests),
	);
}

function buildTimingTableRows(benchmarkResults) {
	return benchmarkResults.flatMap((result) =>
		result.summaries.map((summary) => ({
			backend: result.request.backend ?? "default",
			pipeline: result.request.pipeline ?? "default",
			variant: summary.variant.name,
			averageElapsedMs: summary.averageElapsedMs,
			medianElapsedMs: summary.medianElapsedMs,
			averageSmokeElapsedMs: summary.averageSmokeElapsedMs,
			minElapsedMs: summary.minElapsedMs,
			maxElapsedMs: summary.maxElapsedMs,
			averageOutputDurationSeconds: summary.averageOutputDurationSeconds,
			averageSizeBytes: summary.averageSizeBytes,
			webcamEnabled: summary.webcamEnabled,
		})),
	);
}

export function printTimingSummaryTable(benchmarkResults) {
	printTable(
		"Timing summary",
		[
			{ header: "Pipeline", getValue: (row) => row.pipeline },
			{ header: "Backend", getValue: (row) => row.backend },
			{ header: "Variant", getValue: (row) => row.variant },
			{ header: "Avg total", getValue: (row) => formatMs(row.averageElapsedMs) },
			{ header: "Median total", getValue: (row) => formatMs(row.medianElapsedMs) },
			{ header: "Avg export", getValue: (row) => formatMs(row.averageSmokeElapsedMs) },
			{ header: "Min", getValue: (row) => formatMs(row.minElapsedMs) },
			{ header: "Max", getValue: (row) => formatMs(row.maxElapsedMs) },
			{
				header: "Avg output",
				getValue: (row) => formatSeconds(row.averageOutputDurationSeconds),
			},
			{ header: "Avg size", getValue: (row) => formatMegabytes(row.averageSizeBytes) },
			{ header: "Webcam", getValue: (row) => formatBoolean(row.webcamEnabled) },
		],
		buildTimingTableRows(benchmarkResults),
	);
}

function buildBackendDetailTableRows(benchmarkResults) {
	return benchmarkResults.flatMap((result) =>
		result.summaries.map((summary) => ({
			backend: result.request.backend ?? "default",
			pipeline: result.request.pipeline ?? "default",
			variant: summary.variant.name,
			encodeQueue: summary.variant.maxEncodeQueue,
			decodeQueue: summary.variant.maxDecodeQueue,
			pendingFrames: summary.variant.maxPendingFrames,
			observedRenderBackends: summary.observedRenderBackends,
			observedEncodeBackends: summary.observedEncodeBackends,
			observedEncoders: summary.observedEncoders,
		})),
	);
}

export function printBackendDetailTable(benchmarkResults) {
	printTable(
		"Observed backends",
		[
			{ header: "Pipeline", getValue: (row) => row.pipeline },
			{ header: "Backend", getValue: (row) => row.backend },
			{ header: "Variant", getValue: (row) => row.variant },
			{ header: "Encode Q", getValue: (row) => row.encodeQueue },
			{ header: "Decode Q", getValue: (row) => row.decodeQueue },
			{ header: "Pending", getValue: (row) => row.pendingFrames },
			{ header: "Render", getValue: (row) => row.observedRenderBackends },
			{ header: "Encode", getValue: (row) => row.observedEncodeBackends },
			{ header: "Encoder", getValue: (row) => row.observedEncoders },
		],
		buildBackendDetailTableRows(benchmarkResults),
	);
}

function buildDeltaTableRows(benchmarkResults) {
	return benchmarkResults
		.map((result) => {
			const baseline = result.summaries.find((summary) => summary.variant.name === "baseline");
			const tuned = result.summaries.find((summary) => summary.variant.name === "tuned");
			if (!baseline || !tuned) {
				return null;
			}

			const averageDelta = calculateDelta(baseline.averageElapsedMs, tuned.averageElapsedMs);
			const medianDelta = calculateDelta(baseline.medianElapsedMs, tuned.medianElapsedMs);
			const exportDelta = calculateDelta(
				baseline.averageSmokeElapsedMs,
				tuned.averageSmokeElapsedMs,
			);

			return {
				pipeline: result.request.pipeline ?? "default",
				backend: result.request.backend ?? "default",
				averageDeltaMs: averageDelta.deltaMs,
				averageDeltaPercent: averageDelta.deltaPercent,
				medianDeltaMs: medianDelta.deltaMs,
				medianDeltaPercent: medianDelta.deltaPercent,
				exportDeltaMs: exportDelta.deltaMs,
				exportDeltaPercent: exportDelta.deltaPercent,
			};
		})
		.filter(Boolean);
}

export function printDeltaTable(benchmarkResults) {
	printTable(
		"Tuned vs baseline",
		[
			{ header: "Pipeline", getValue: (row) => row.pipeline },
			{ header: "Backend", getValue: (row) => row.backend },
			{
				header: "Avg delta",
				getValue: (row) =>
					`${formatDeltaMs(row.averageDeltaMs)} (${formatPercent(row.averageDeltaPercent)})`,
			},
			{
				header: "Median delta",
				getValue: (row) =>
					`${formatDeltaMs(row.medianDeltaMs)} (${formatPercent(row.medianDeltaPercent)})`,
			},
			{
				header: "Export delta",
				getValue: (row) =>
					`${formatDeltaMs(row.exportDeltaMs)} (${formatPercent(row.exportDeltaPercent)})`,
			},
		],
		buildDeltaTableRows(benchmarkResults),
	);
}