import { expect, it } from "vitest";
import { matchesMediaSignature, validatedJpegStream } from "../src/mediaValidation.js";

const mp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109, 0, 0, 0, 0]);

it("peeks fragmented JPEG bytes without draining or changing the remaining stream", async () => {
	const bytes = new Uint8Array([255, 216, 255, 217, 1, 2, 3, 4]);
	let pulls = 0;
	const source = new ReadableStream(
		{
			pull(controller) {
				if (pulls === bytes.length) controller.close();
				else controller.enqueue(bytes.subarray(pulls, ++pulls));
			},
		},
		{ highWaterMark: 0 },
	);
	const validated = await validatedJpegStream(source);
	expect(pulls).toBe(3);
	expect(new Uint8Array(await new Response(validated).arrayBuffer())).toEqual(bytes);
});
it("rejects unknown types, missing prefixes, and invalid ftyp lengths", () => {
	expect(matchesMediaSignature(mp4, "application/octet-stream")).toBe(false);
	expect(matchesMediaSignature(new Uint8Array(), "image/gif")).toBe(false);
	const broken = mp4.slice();
	broken[3] = 8;
	expect(matchesMediaSignature(broken, "video/mp4")).toBe(false);
});

it("rejects MP4 boxes extending beyond the stored recording and accepts extended ftyp headers", () => {
	expect(matchesMediaSignature(mp4, "video/mp4", 16)).toBe(false);
	const extended = new Uint8Array(24);
	extended.set([0, 0, 0, 1, 102, 116, 121, 112]);
	new DataView(extended.buffer).setBigUint64(8, 24n);
	expect(matchesMediaSignature(extended, "video/quicktime", 24)).toBe(true);
	expect(matchesMediaSignature(extended, "video/quicktime", 23)).toBe(false);
});
it("cancels a stalled JPEG prefix read on timeout", async () => {
	const abort = new AbortController();
	let waiting,
		cancelled = false;
	const started = new Promise((resolve) => {
		waiting = resolve;
	});
	const source = new ReadableStream(
		{
			pull() {
				waiting();
			},
			cancel() {
				cancelled = true;
			},
		},
		{ highWaterMark: 0 },
	);
	const result = validatedJpegStream(source, abort.signal);
	await started;
	abort.abort(new DOMException("Prefix read timed out", "TimeoutError"));
	await expect(result).rejects.toMatchObject({ name: "TimeoutError" });
	expect(cancelled).toBe(true);
});
