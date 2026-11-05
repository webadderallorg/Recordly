import { createHash } from "node:crypto";

// Authenticode changes the checksum, certificate directory and appended certificate.
// Hash all remaining bytes so signing cannot hide a change to the executable payload.
export function peContentHash(bytes) {
	if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ")
		throw new Error("Invalid PE executable.");
	const pe = bytes.readUInt32LE(0x3c);
	if (pe + 24 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550)
		throw new Error("Invalid PE header.");
	const optional = pe + 24;
	const optionalSize = bytes.readUInt16LE(pe + 20);
	const magic = bytes.readUInt16LE(optional);
	if (magic !== 0x20b && magic !== 0x10b) throw new Error("Unsupported PE optional header.");
	const checksum = optional + 64;
	const certificateEntry = optional + (magic === 0x20b ? 112 : 96) + 4 * 8;
	if (certificateEntry + 8 > optional + optionalSize || optional + optionalSize > bytes.length)
		throw new Error("Truncated PE header.");
	const certificateOffset = bytes.readUInt32LE(certificateEntry);
	const certificateSize = bytes.readUInt32LE(certificateEntry + 4);
	if (
		(certificateOffset === 0) !== (certificateSize === 0) ||
		(certificateSize &&
			(certificateOffset < optional + optionalSize ||
				certificateOffset + certificateSize !== bytes.length))
	) {
		throw new Error("Invalid PE certificate table.");
	}
	const end = certificateSize ? certificateOffset : bytes.length;
	return createHash("sha256")
		.update(bytes.subarray(0, checksum))
		.update(bytes.subarray(checksum + 4, certificateEntry))
		.update(bytes.subarray(certificateEntry + 8, end))
		.digest("hex");
}
