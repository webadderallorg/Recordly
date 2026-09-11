// Verifies that a packaged Recordly build actually contains the fixes that a
// smoke run is supposed to validate. A stale dist/ (built from pre-commit
// sources) once invalidated an entire validation round: the smoke executed,
// crashed with the exact bug the fix targeted, and the report was mistaken
// for "the fix does not work".
//
// Usage:
//   node scripts/verify-smoke-build.mjs \
//     --asar release/linux-unpacked/resources/app.asar \
//     --expect "RECORDLY_LINUX_RENDER_BACKEND" \
//     --expect "[smoke-export] Export run started" \
//     --expect "[VideoExporter] Using" \
//     --expect "retrying with webgl fallback"
//
// Exit codes: 0 = all markers found, 1 = missing markers, 2 = asar unreadable.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const defaultAsarPath = "release/linux-unpacked/resources/app.asar";

export function parseVerifyArgs(argv) {
	const { values } = parseArgs({
		args: argv,
		options: {
			asar: { type: "string" },
			expect: { type: "string", multiple: true },
		},
	});
	const markers = (values.expect ?? []).filter((marker) => marker.length > 0);
	if (markers.length === 0) {
		throw new Error("At least one --expect <marker> is required.");
	}
	return { asarPath: values.asar ?? defaultAsarPath, markers };
}

// The asar payload mixes text bundles with native binaries, so read it as
// latin1 (byte-preserving) instead of utf8: invalid utf8 sequences would be
// replaced and could swallow ASCII markers at the boundary.
export function collectMissingMarkers(haystack, markers) {
	return markers.filter((marker) => !haystack.includes(marker));
}

function main() {
	const { asarPath, markers } = parseVerifyArgs(process.argv.slice(2));
	let payload;
	try {
		payload = readFileSync(asarPath, "latin1");
	} catch (error) {
		console.error(`[verify-smoke-build] Cannot read ${asarPath}: ${error.message}`);
		process.exit(2);
	}
	const missing = collectMissingMarkers(payload, markers);
	if (missing.length > 0) {
		console.error("[verify-smoke-build] FAIL — build is missing expected markers:");
		for (const marker of missing) {
			console.error(`  - ${JSON.stringify(marker)}`);
		}
		console.error(
			"The packaged build does not contain the expected fixes. Rebuild (npm run build) before validating.",
		);
		process.exit(1);
	}
	console.log(`[verify-smoke-build] OK — ${markers.length} marker(s) present in ${asarPath}`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
	main();
}
