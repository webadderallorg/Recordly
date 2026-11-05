import { createHash } from "node:crypto";

const MH_MAGIC_64 = 0xfeedfacf;
const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;
const ZERO_FILL_SECTION_TYPES = new Set([0x1, 0xc, 0x12]);

function fail(message) {
	throw new Error(`Cannot hash Mach-O content: ${message}`);
}

function fileInteger(bytes, offset) {
	const value = bytes.readBigUInt64LE(offset);
	if (value > BigInt(bytes.length)) fail("file range exceeds the binary");
	return Number(value);
}

function name(bytes, offset) {
	return bytes
		.subarray(offset, offset + 16)
		.toString("ascii")
		.replace(/\0.*$/, "");
}

/**
 * Hash a thin, little-endian 64-bit Mach-O executable independently of codesign.
 * All non-signature load commands and file payload bytes remain authenticated.
 * Only signing's load command/blob, zero header/alignment padding, and LINKEDIT
 * allocation sizes are omitted. This does not validate or replace a code signature.
 */
export function machoContentHash(input) {
	const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
	if (bytes.length < 32 || bytes.readUInt32LE(0) !== MH_MAGIC_64) {
		fail("expected a thin little-endian 64-bit Mach-O binary");
	}
	const commandCount = bytes.readUInt32LE(16);
	const commandBytes = bytes.readUInt32LE(20);
	const commandEnd = 32 + commandBytes;
	if (commandEnd > bytes.length || commandCount > Math.floor(commandBytes / 8)) {
		fail("invalid load-command table");
	}
	const commands = [];
	const fileSegments = [];
	let firstSectionOffset = bytes.length;
	let lastSectionEnd = 0;
	let signature = null;
	let linkedit = null;
	let offset = 32;
	for (let index = 0; index < commandCount; index++) {
		if (offset + 8 > commandEnd) fail("truncated load command");
		const command = bytes.readUInt32LE(offset);
		const size = bytes.readUInt32LE(offset + 4);
		if (size < 8 || size % 8 !== 0 || offset + size > commandEnd) {
			fail("invalid load-command size");
		}
		const normalized = Buffer.from(bytes.subarray(offset, offset + size));
		if (command === LC_CODE_SIGNATURE) {
			if (signature || size !== 16) fail("invalid or duplicate signature command");
			signature = {
				offset: bytes.readUInt32LE(offset + 8),
				size: bytes.readUInt32LE(offset + 12),
			};
		} else {
			if (command === LC_SEGMENT_64) {
				if (size < 72) fail("truncated segment command");
				const sectionCount = bytes.readUInt32LE(offset + 64);
				if (size !== 72 + sectionCount * 80) fail("invalid segment section table");
				const segmentName = name(bytes, offset + 8);
				const fileOffset = fileInteger(bytes, offset + 40);
				const fileSize = fileInteger(bytes, offset + 48);
				if (fileOffset + fileSize > bytes.length) fail("segment exceeds the binary");
				if (segmentName === "__LINKEDIT") {
					if (linkedit) fail("duplicate LINKEDIT segment");
					linkedit = { offset: fileOffset, size: fileSize };
					// codesign adjusts only this segment's allocated virtual/file size.
					normalized.fill(0, 32, 40);
					normalized.fill(0, 48, 56);
				} else if (fileSize) {
					fileSegments.push({ offset: fileOffset, size: fileSize });
				}
				for (let section = 0; section < sectionCount; section++) {
					const sectionOffset = offset + 72 + section * 80;
					const sectionType = bytes.readUInt32LE(sectionOffset + 64) & 0xff;
					if (ZERO_FILL_SECTION_TYPES.has(sectionType)) continue;
					const sectionSize = fileInteger(bytes, sectionOffset + 40);
					const sectionFileOffset = bytes.readUInt32LE(sectionOffset + 48);
					if (!sectionSize) continue;
					if (
						sectionFileOffset < commandEnd ||
						sectionFileOffset + sectionSize > bytes.length ||
						sectionFileOffset < fileOffset ||
						sectionFileOffset + sectionSize > fileOffset + fileSize
					)
						fail("section is outside its file-backed segment");
					firstSectionOffset = Math.min(firstSectionOffset, sectionFileOffset);
					lastSectionEnd = Math.max(lastSectionEnd, sectionFileOffset + sectionSize);
				}
			}
			commands.push(normalized);
		}
		offset += size;
	}
	if (offset !== commandEnd || firstSectionOffset === bytes.length) {
		fail("invalid command table or no file-backed sections");
	}
	if (bytes.subarray(commandEnd, firstSectionOffset).some((byte) => byte !== 0)) {
		fail("nonzero header padding cannot be excluded");
	}
	let payloadEnd = bytes.length;
	if (signature) {
		if (
			!signature.size ||
			!linkedit ||
			signature.offset < linkedit.offset ||
			signature.offset + signature.size !== bytes.length ||
			signature.offset + signature.size > linkedit.offset + linkedit.size ||
			signature.offset < lastSectionEnd ||
			fileSegments.some((segment) => segment.offset + segment.size > signature.offset)
		)
			fail("signature is not a terminal LINKEDIT blob outside executable/data segments");
		payloadEnd = signature.offset;
	}
	// Signing may add zero bytes to align the terminal signature. Zero file-tail
	// padding has no content; section/load-command sizes remain part of the digest.
	while (payloadEnd > firstSectionOffset && bytes[payloadEnd - 1] === 0) payloadEnd--;
	const header = Buffer.from(bytes.subarray(0, 32));
	header.writeUInt32LE(commands.length, 16);
	header.writeUInt32LE(
		commands.reduce((total, command) => total + command.length, 0),
		20,
	);
	const hash = createHash("sha256");
	hash.update("Recordly Mach-O content v1\0");
	hash.update(header);
	for (const command of commands) hash.update(command);
	hash.update(bytes.subarray(firstSectionOffset, payloadEnd));
	return hash.digest("hex");
}
