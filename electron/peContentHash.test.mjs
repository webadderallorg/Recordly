import { describe, expect, it } from "vitest";
import { peContentHash } from "../scripts/pe-content-hash.mjs";

const formats = [
	{ name: "PE32", magic: 0x10b, optionalSize: 224, certificateEntry: 280 },
	{ name: "PE32+", magic: 0x20b, optionalSize: 240, certificateEntry: 296 },
];

function executable(format) {
	const bytes = Buffer.alloc(512);
	bytes.write("MZ");
	bytes.writeUInt32LE(128, 0x3c);
	bytes.writeUInt32LE(0x4550, 128);
	bytes.writeUInt16LE(format.optionalSize, 148);
	bytes.writeUInt16LE(format.magic, 152);
	bytes.fill(0x90, 400);
	return bytes;
}
function signedExecutable(format) {
	const bytes = Buffer.concat([executable(format), Buffer.alloc(32, 0xaa)]);
	bytes.writeUInt32LE(12345, 152 + 64);
	bytes.writeUInt32LE(512, format.certificateEntry);
	bytes.writeUInt32LE(32, format.certificateEntry + 4);
	return bytes;
}
describe.each(formats)("Windows executable integrity across signing ($name)", (format) => {
	it("keeps the payload hash stable when Authenticode adds a certificate and checksum", () => {
		expect(peContentHash(signedExecutable(format))).toBe(peContentHash(executable(format)));
	});
	it("detects executable payload changes in a signed file", () => {
		const bytes = signedExecutable(format);
		bytes[400] ^= 1;
		expect(peContentHash(bytes)).not.toBe(peContentHash(executable(format)));
	});
	it("rejects certificate ranges that could omit arbitrary trailing data", () => {
		const bytes = signedExecutable(format);
		bytes.writeUInt32LE(8, format.certificateEntry + 4);
		expect(() => peContentHash(bytes)).toThrow("certificate table");
	});
	it("rejects malformed executable headers", () => {
		expect(() => peContentHash(Buffer.from("not a PE"))).toThrow("Invalid PE");
		const bytes = executable(format);
		bytes.writeUInt32LE(10000, 0x3c);
		expect(() => peContentHash(bytes)).toThrow("Invalid PE header");
	});
});
