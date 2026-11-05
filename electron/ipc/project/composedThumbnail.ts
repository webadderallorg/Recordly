import fs from "node:fs/promises";
import { crc32 } from "node:zlib";
import {
	PROJECT_THUMBNAIL_WIDTH,
	PROJECT_THUMBNAIL_HEIGHT,
	PROJECT_THUMBNAIL_RENDER_VERSION,
} from "../../../src/lib/projectThumbnail";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const marker = Buffer.from(`RecordlyThumbnail\0${PROJECT_THUMBNAIL_RENDER_VERSION}`);

/** A PNG text chunk distinguishes composed caches from legacy source-only posters. */
export function encodeComposedThumbnail(dataUrl: string): Buffer {
	if (
		typeof dataUrl !== "string" ||
		dataUrl.length > 6 * 1024 * 1024 ||
		!dataUrl.startsWith("data:image/png;base64,")
	)
		throw new Error("Invalid project thumbnail");
	const png = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
	if (
		png.length < 45 ||
		!png.subarray(0, 8).equals(signature) ||
		png.toString("ascii", 12, 16) !== "IHDR" ||
		png.readUInt32BE(16) !== PROJECT_THUMBNAIL_WIDTH ||
		png.readUInt32BE(20) !== PROJECT_THUMBNAIL_HEIGHT
	)
		throw new Error("Invalid project thumbnail dimensions");
	const chunk = Buffer.alloc(marker.length + 12);
	chunk.writeUInt32BE(marker.length, 0);
	chunk.write("tEXt", 4);
	marker.copy(chunk, 8);
	chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
	return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

export async function isComposedThumbnail(filePath: string) {
	let file: Awaited<ReturnType<typeof fs.open>> | undefined;
	try {
		file = await fs.open(filePath, "r");
		const header = Buffer.alloc(96);
		await file.read(header, 0, header.length, 0);
		return header.subarray(41, 41 + marker.length).equals(marker);
	} catch {
		return false;
	} finally {
		await file?.close();
	}
}
