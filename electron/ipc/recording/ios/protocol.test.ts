import { expect, it } from "vitest";
import { NDJSONDecoder } from "./protocol";

it("reassembles split multibyte UTF-8 without corrupting control messages", () => {
	const wire = Buffer.from('{"name":"📱"}\n{"ok":true}\n');
	const decoder = new NDJSONDecoder(JSON.parse);
	expect(decoder.push(wire.subarray(0, 11))).toEqual([]);
	expect(decoder.push(wire.subarray(11))).toEqual([{ name: "📱" }, { ok: true }]);
	decoder.finish();
});
it("rejects oversized, malformed and incomplete control messages", () => {
	expect(() => new NDJSONDecoder(JSON.parse).push(Buffer.alloc(65 * 1024, 97))).toThrow();
	expect(() => new NDJSONDecoder(JSON.parse).push(Buffer.from([0xff, 10]))).toThrow();
	expect(() => new NDJSONDecoder(JSON.parse).push(Buffer.from("oops\n"))).toThrow();
	const split = new NDJSONDecoder(JSON.parse);
	split.push(Buffer.from('{"ok":'));
	expect(() => split.finish()).toThrow("INCOMPLETE_PROTOCOL");
});
