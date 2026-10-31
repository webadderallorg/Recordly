import fs from "node:fs/promises";
import {
	PROJECT_THUMBNAIL_WIDTH,
	PROJECT_THUMBNAIL_HEIGHT,
} from "../../../src/lib/projectThumbnail";

// Older releases wrote 320px previews. Hide those and previews predating edits;
// the editor replaces them with a current-size render when returning home.
export async function hasFreshProjectThumbnail(thumbnailPath: string, projectModifiedAt: number) {
	let file: Awaited<ReturnType<typeof fs.open>> | undefined;
	try {
		file = await fs.open(thumbnailPath, "r");
		const stat = await file.stat();
		if (stat.mtimeMs < projectModifiedAt) return false;
		const header = Buffer.alloc(24);
		const { bytesRead } = await file.read(header, 0, 24, 0);
		return (
			bytesRead === 24 &&
			header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
			header.readUInt32BE(16) >= PROJECT_THUMBNAIL_WIDTH &&
			header.readUInt32BE(20) >= PROJECT_THUMBNAIL_HEIGHT
		);
	} catch {
		return false;
	} finally {
		await file?.close();
	}
}
