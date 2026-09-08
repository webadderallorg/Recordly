import { describe, expect, it } from "vitest";
import { PreviewFrameDecoder } from "./preview";

function frame(sequence = 1, generation = 2, jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])) {
	const header = Buffer.alloc(24);
	header.write("RLIP");
	header.writeUInt16BE(1, 4);
	header.writeUInt32BE(generation, 8);
	header.writeUInt32BE(sequence, 12);
	header.writeUInt32BE(jpeg.length, 16);
	return Buffer.concat([header, jpeg]);
}

describe("RLIP preview boundary", () => {
	it("decodes split headers and payloads", () => {
		const decoder = new PreviewFrameDecoder();
		const wire = frame();
		expect(decoder.push(wire.subarray(0, 11))).toEqual([]);
		expect(decoder.push(wire.subarray(11, 25))).toEqual([]);
		expect(decoder.push(wire.subarray(25))).toEqual([
			{ generation: 2, sequence: 1, jpeg: wire.subarray(24) },
		]);
	});
	it("retains only the latest frame from a blocked consumer's batch", () => {
		const decoder = new PreviewFrameDecoder();
		expect(decoder.push(Buffer.concat([frame(1), frame(2)])).map((f) => f.sequence)).toEqual([
			2,
		]);
	});
	it.each([0, 4, 6, 20])("permanently closes malformed headers at byte %i", (offset) => {
		const decoder = new PreviewFrameDecoder();
		const wire = frame();
		wire[offset] = 99;
		expect(() => decoder.push(wire)).toThrow("INVALID_PREVIEW");
		expect(decoder.push(frame())).toEqual([]);
	});
	it("rejects oversized payloads before buffering their body", () => {
		const wire = frame();
		wire.writeUInt32BE(128 * 1024 + 1, 16);
		expect(() => new PreviewFrameDecoder().push(wire)).toThrow("INVALID_PREVIEW");
	});
});
