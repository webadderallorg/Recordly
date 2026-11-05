import { describe, expect, it } from "vitest";
import { peContentHash } from "../scripts/pe-content-hash.mjs";

function executable() {
	const bytes = Buffer.alloc(512);
	bytes.write("MZ");
	bytes.writeUInt32LE(128, 0x3c);
	bytes.writeUInt32LE(0x4550, 128);
	bytes.writeUInt16LE(240, 148);
	bytes.writeUInt16LE(0x20b, 152);
	bytes.fill(0x90, 400);
	return bytes;
}
function signedExecutable() {
	const bytes = Buffer.concat([executable(), Buffer.alloc(32, 0xaa)]);
	bytes.writeUInt32LE(12345, 152 + 64);
	bytes.writeUInt32LE(512, 152 + 112 + 32);
	bytes.writeUInt32LE(32, 152 + 112 + 36);
	return bytes;
}
describe("Windows executable integrity across signing", () => {
	it("keeps the payload hash stable when Authenticode adds a certificate and checksum", () => {
		expect(peContentHash(signedExecutable())).toBe(peContentHash(executable()));
	});
	it("detects executable payload changes in a signed file", () => {
		const bytes = signedExecutable();
		bytes[400] ^= 1;
		expect(peContentHash(bytes)).not.toBe(peContentHash(executable()));
	});
	it("rejects certificate ranges that could omit arbitrary trailing data", () => {
		const bytes = signedExecutable();
		bytes.writeUInt32LE(8, 152 + 112 + 36);
		expect(() => peContentHash(bytes)).toThrow("certificate table");
	});
	it("rejects malformed executable headers", () => {
		expect(() => peContentHash(Buffer.from("not a PE"))).toThrow("Invalid PE");
		const bytes = executable();
		bytes.writeUInt32LE(10000, 0x3c);
		expect(() => peContentHash(bytes)).toThrow("Invalid PE header");
	});
});
