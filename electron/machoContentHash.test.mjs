import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { machoContentHash } from "../scripts/macho-content-hash.mjs";

const directories = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

function unsignedFixture() {
	const bytes = Buffer.alloc(0x320);
	bytes.writeUInt32LE(0xfeedfacf, 0);
	bytes.writeUInt32LE(0x100000c, 4);
	bytes.writeUInt32LE(2, 12);
	bytes.writeUInt32LE(2, 16);
	bytes.writeUInt32LE(152 + 72, 20);
	let offset = 32;
	bytes.writeUInt32LE(0x19, offset);
	bytes.writeUInt32LE(152, offset + 4);
	bytes.write("__TEXT", offset + 8);
	bytes.writeBigUInt64LE(0x100000000n, offset + 24);
	bytes.writeBigUInt64LE(0x300n, offset + 32);
	bytes.writeBigUInt64LE(0x300n, offset + 48);
	bytes.writeUInt32LE(5, offset + 56);
	bytes.writeUInt32LE(5, offset + 60);
	bytes.writeUInt32LE(1, offset + 64);
	bytes.write("__text", offset + 72);
	bytes.write("__TEXT", offset + 88);
	bytes.writeBigUInt64LE(0x100000200n, offset + 104);
	bytes.writeBigUInt64LE(8n, offset + 112);
	bytes.writeUInt32LE(0x200, offset + 120);
	offset += 152;
	bytes.writeUInt32LE(0x19, offset);
	bytes.writeUInt32LE(72, offset + 4);
	bytes.write("__LINKEDIT", offset + 8);
	bytes.writeBigUInt64LE(0x100000300n, offset + 24);
	bytes.writeBigUInt64LE(0x20n, offset + 32);
	bytes.writeBigUInt64LE(0x300n, offset + 40);
	bytes.writeBigUInt64LE(0x20n, offset + 48);
	bytes.writeUInt32LE(1, offset + 56);
	bytes.writeUInt32LE(1, offset + 60);
	bytes.write("codebyte", 0x200);
	bytes.write("linkedit-data", 0x300);
	return bytes;
}

function signedFixture(unsigned) {
	const bytes = Buffer.concat([unsigned, Buffer.alloc(0x40, 0xab)]);
	bytes.writeUInt32LE(3, 16);
	bytes.writeUInt32LE(152 + 72 + 16, 20);
	const signature = 32 + 152 + 72;
	bytes.writeUInt32LE(0x1d, signature);
	bytes.writeUInt32LE(16, signature + 4);
	bytes.writeUInt32LE(0x320, signature + 8);
	bytes.writeUInt32LE(0x40, signature + 12);
	bytes.writeBigUInt64LE(0x1000n, 32 + 152 + 32);
	bytes.writeBigUInt64LE(0x60n, 32 + 152 + 48);
	return bytes;
}

describe("Mach-O content hash", () => {
	it("ignores only signature storage/header changes and retains non-code file content", () => {
		const original = unsignedFixture();
		const signed = signedFixture(original);
		expect(machoContentHash(signed)).toBe(machoContentHash(original));
		const changedCode = Buffer.from(signed);
		changedCode[0x200] ^= 1;
		expect(machoContentHash(changedCode)).not.toBe(machoContentHash(original));
		const changedLinkedit = Buffer.from(signed);
		changedLinkedit[0x300] ^= 1;
		expect(machoContentHash(changedLinkedit)).not.toBe(machoContentHash(original));
	});
	it("rejects malformed ranges, executable overlap, nonterminal signatures and nonzero header padding", () => {
		const signed = signedFixture(unsignedFixture());
		const overlap = Buffer.from(signed);
		overlap.writeUInt32LE(0x200, 32 + 152 + 72 + 8);
		overlap.writeUInt32LE(overlap.length - 0x200, 32 + 152 + 72 + 12);
		expect(() => machoContentHash(overlap)).toThrow("terminal LINKEDIT blob");
		const nonterminal = Buffer.concat([signed, Buffer.from([1])]);
		expect(() => machoContentHash(nonterminal)).toThrow("terminal LINKEDIT blob");
		const padding = Buffer.from(signed);
		padding[0x180] = 1;
		expect(() => machoContentHash(padding)).toThrow("nonzero header padding");
		const malformed = Buffer.from(signed);
		malformed.writeUInt32LE(7, 36);
		expect(() => machoContentHash(malformed)).toThrow("load-command size");
		expect(() => machoContentHash(Buffer.alloc(32))).toThrow("thin little-endian");
	});
});

describe.skipIf(process.platform !== "darwin")("real macOS code signing", () => {
	it("preserves the digest through ad-hoc signing/re-signing while detecting code and dylib changes", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "recordly-macho-"));
		directories.push(directory);
		const source = path.join(directory, "fixture.c");
		const executable = path.join(directory, "fixture");
		await writeFile(source, "int main(int argc, char **argv) { return argc == 17 ? 3 : 0; }\n");
		execFileSync("xcrun", ["clang", "-Wl,-no_adhoc_codesign", source, "-o", executable]);
		const unsigned = await readFile(executable);
		const original = machoContentHash(unsigned);
		execFileSync(
			"codesign",
			["--force", "--sign", "-", "--identifier", "recordly.fixture", executable],
			{ stdio: "pipe" },
		);
		execFileSync("codesign", ["--verify", "--strict", executable], { stdio: "pipe" });
		const signed = await readFile(executable);
		expect(signed.equals(unsigned)).toBe(false);
		expect(machoContentHash(signed)).toBe(original);
		execFileSync(
			"codesign",
			[
				"--force",
				"--sign",
				"-",
				"--identifier",
				"recordly.fixture.a.longer.identifier.to.resize.signature",
				executable,
			],
			{ stdio: "pipe" },
		);
		expect(machoContentHash(await readFile(executable))).toBe(original);
		const commands = execFileSync("xcrun", ["otool", "-l", executable], { encoding: "utf8" });
		const textOffset = Number(commands.match(/sectname __text[\s\S]*?\boffset (\d+)/)?.[1]);
		expect(textOffset).toBeGreaterThan(0);
		const changedCode = Buffer.from(signed);
		changedCode[textOffset] ^= 1;
		expect(machoContentHash(changedCode)).not.toBe(original);
		const dylibOffset = signed.indexOf("/usr/lib/libSystem.B.dylib");
		expect(dylibOffset).toBeGreaterThan(0);
		const changedDylib = Buffer.from(signed);
		changedDylib[dylibOffset + 9] ^= 1;
		expect(machoContentHash(changedDylib)).not.toBe(original);
	}, 20000);
});
