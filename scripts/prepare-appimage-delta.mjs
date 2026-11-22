import { execFile } from "node:child_process";
import { chmod, copyFile, mkdtemp, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

async function embedUpdateInformation(file, originalInfo, updateInformation) {
	const { stdout } = await run("readelf", ["-SW", file]);
	const section = stdout.match(
		/^\s*\[\s*\d+\]\s+\.upd_info\s+PROGBITS\s+[\da-f]+\s+([\da-f]+)\s+([\da-f]+)\s/m,
	);
	if (!section) throw new Error("AppImage runtime is missing its .upd_info section");
	const offset = Number.parseInt(section[1], 16);
	const length = Number.parseInt(section[2], 16);

	const handle = await open(file, "r+");
	try {
		const { size } = await handle.stat();
		const footer = Buffer.alloc(4);
		await handle.read(footer, 0, footer.length, size - footer.length);
		const mapSize = footer.readUInt32BE();
		const payloadSize = size - mapSize - footer.length;
		if (
			size !== originalInfo?.size ||
			mapSize === 0 ||
			mapSize !== originalInfo.blockMapSize ||
			offset < 64 ||
			offset + length > payloadSize ||
			Buffer.byteLength(updateInformation) >= length
		) {
			throw new Error(
				"AppImage update section or blockmap does not match the build metadata",
			);
		}
		const bytes = Buffer.alloc(length);
		bytes.write(updateInformation);
		const { bytesWritten } = await handle.write(bytes, 0, bytes.length, offset);
		if (bytesWritten !== bytes.length)
			throw new Error("Could not write AppImage update metadata");
		await handle.truncate(payloadSize);
	} finally {
		await handle.close();
	}
}

export default async function prepareAppImageDelta(event) {
	if (process.env.RECORDLY_APPIMAGE_DELTA !== "1" || !event.file?.endsWith(".AppImage")) return;
	const publish = [event.packager.config.publish]
		.flat()
		.find((configuration) => configuration?.provider === "github");
	if (!publish?.owner || !publish.repo)
		throw new Error("AppImage delta updates need a GitHub publisher");

	const artifact = path.basename(event.file);
	const zsyncName = `${artifact}.zsync`;
	const updateInformation = `gh-releases-zsync|${publish.owner}|${publish.repo}|latest|${zsyncName}`;
	const tempDir = await mkdtemp(path.join(path.dirname(event.file), ".appimage-update-"));
	try {
		const image = path.join(tempDir, artifact);
		await copyFile(event.file, image);
		await embedUpdateInformation(image, event.updateInfo, updateInformation);

		// electron-builder emits artifactCreated after this hook, using this
		// metadata to write the Electron updater's YAML for the finished image.
		const { appendBlockmap } = await import(
			"app-builder-lib/out/targets/differentialUpdateInfoBuilder.js"
		);
		const updateInfo = await appendBlockmap(image);
		await run("zsyncmake", ["-u", artifact, "-o", zsyncName, artifact], { cwd: tempDir });
		await chmod(image, (await stat(event.file)).mode);
		await rename(image, event.file);
		await rename(path.join(tempDir, zsyncName), `${event.file}.zsync`);
		event.updateInfo = updateInfo;
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}
