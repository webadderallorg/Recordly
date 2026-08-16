import fs from "node:fs/promises";

export interface Mp4Box {
	type: string;
	size: number;
}

export type Mp4Layout = "finalized" | "unfinalized" | "unknown";

/**
 * An MP4 written by AVAssetWriter (the macOS capture helper) or by the Windows
 * capture helper only becomes playable once the writer finalizes it: the `mdat`
 * gets its real size and a `moov` index is appended.  A helper that dies
 * mid-recording leaves `ftyp` + an open-ended `mdat` and no `moov` — bytes on
 * disk that no player can open.
 *
 * Classification is deliberately conservative: only the exact interrupted-writer
 * signature is reported as `unfinalized`.  Anything unexpected is `unknown`, so
 * callers keep their existing behaviour rather than rejecting a file that might
 * be perfectly fine.
 */
export function classifyMp4Layout(boxes: Mp4Box[], fileSize: number): Mp4Layout {
	if (boxes.length === 0 || fileSize <= 0) {
		return "unknown";
	}

	if (boxes.some((box) => box.type === "moov")) {
		return "finalized";
	}

	const lastBox = boxes[boxes.length - 1];
	if (lastBox.type === "mdat" && lastBox.size === 0) {
		// size 0 means "this box runs to the end of the file" — the placeholder a
		// writer patches on finish.
		return "unfinalized";
	}

	return "unknown";
}

/**
 * Reads the top-level box table without loading the file: each header is 8 bytes
 * and points at the next one, so even a multi-gigabyte capture costs a handful of
 * reads.
 */
export async function readMp4TopLevelBoxes(filePath: string, maxBoxes = 32): Promise<Mp4Box[]> {
	const handle = await fs.open(filePath, "r");
	try {
		const { size } = await handle.stat();
		const boxes: Mp4Box[] = [];
		const header = Buffer.alloc(16);
		let offset = 0;

		while (offset < size && boxes.length < maxBoxes) {
			const { bytesRead } = await handle.read(header, 0, 16, offset);
			if (bytesRead < 8) {
				break;
			}

			const declaredSize = header.readUInt32BE(0);
			const type = header.toString("latin1", 4, 8);
			boxes.push({ type, size: declaredSize });

			let boxSize = declaredSize;
			if (declaredSize === 1) {
				if (bytesRead < 16) {
					break;
				}
				boxSize = Number(header.readBigUInt64BE(8));
			} else if (declaredSize === 0) {
				// Runs to end of file — nothing can follow it.
				break;
			}

			if (boxSize < 8) {
				break;
			}
			offset += boxSize;
		}

		return boxes;
	} finally {
		await handle.close();
	}
}

/**
 * True only when the file is positively identified as a capture that was never
 * finalized. Unreadable or unusual files return false so callers fall back to
 * their previous behaviour.
 */
export async function isUnfinalizedMp4(filePath: string): Promise<boolean> {
	try {
		const boxes = await readMp4TopLevelBoxes(filePath);
		const { size } = await fs.stat(filePath);
		return classifyMp4Layout(boxes, size) === "unfinalized";
	} catch {
		return false;
	}
}
