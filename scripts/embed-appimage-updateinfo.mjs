import { execFileSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	openSync,
	readdirSync,
	readSync,
	statSync,
	writeSync,
} from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const releaseRoot = path.join(projectRoot, "release");

const DEFAULT_OWNER = "webadderallorg";
const DEFAULT_REPO = "Recordly";

function findElfUpdInfoSection(filePath) {
	let fd;
	try {
		fd = openSync(filePath, "r");
		const headerBuf = Buffer.alloc(64);
		readSync(fd, headerBuf, 0, 64, 0);

		if (headerBuf.toString("utf8", 0, 4) !== "\x7fELF") {
			return null;
		}

		const is64Bit = headerBuf[4] === 2;
		if (!is64Bit) {
			return null;
		}

		const e_shoff = Number(headerBuf.readBigUInt64LE(40));
		const e_shentsize = headerBuf.readUInt16LE(58);
		const e_shnum = headerBuf.readUInt16LE(60);
		const e_shstrndx = headerBuf.readUInt16LE(62);

		if (e_shnum === 0 || e_shentsize === 0) {
			return null;
		}

		const shTableBuf = Buffer.alloc(e_shentsize * e_shnum);
		readSync(fd, shTableBuf, 0, shTableBuf.length, e_shoff);

		const strtabHeaderOffset = e_shstrndx * e_shentsize;
		const strtabOffset = Number(shTableBuf.readBigUInt64LE(strtabHeaderOffset + 24));
		const strtabSize = Number(shTableBuf.readBigUInt64LE(strtabHeaderOffset + 32));

		const strtabBuf = Buffer.alloc(strtabSize);
		readSync(fd, strtabBuf, 0, strtabSize, strtabOffset);

		for (let i = 0; i < e_shnum; i++) {
			const off = i * e_shentsize;
			const nameIdx = shTableBuf.readUInt32LE(off);
			const nameEnd = strtabBuf.indexOf(0, nameIdx);
			const name = strtabBuf.toString("utf8", nameIdx, nameEnd === -1 ? undefined : nameEnd);

			if (name === ".upd_info") {
				return {
					offset: Number(shTableBuf.readBigUInt64LE(off + 24)),
					size: Number(shTableBuf.readBigUInt64LE(off + 32)),
				};
			}
		}

		return null;
	} finally {
		if (fd !== undefined) {
			closeSync(fd);
		}
	}
}

export function embedUpdateInfoInAppImage(filePath, updateInfoString) {
	const section = findElfUpdInfoSection(filePath);
	if (!section) {
		console.warn(`[appimage-updateinfo] Warning: .upd_info section not found in ${filePath}`);
		return false;
	}

	const updateInfoBuffer = Buffer.from(updateInfoString, "utf8");
	if (updateInfoBuffer.length >= section.size) {
		throw new Error(
			`Update info string too long (${updateInfoBuffer.length} bytes, max ${section.size - 1} bytes)`,
		);
	}

	const padded = Buffer.alloc(section.size);
	updateInfoBuffer.copy(padded, 0);

	let fd;
	try {
		fd = openSync(filePath, "r+");
		writeSync(fd, padded, 0, padded.length, section.offset);
		console.log(
			`[appimage-updateinfo] Embedded update information into ${path.basename(filePath)} (${updateInfoString})`,
		);
		return true;
	} finally {
		if (fd !== undefined) {
			closeSync(fd);
		}
	}
}

export function generateZsyncFile(appImagePath, zsyncOutputPath) {
	const appImageFileName = path.basename(appImagePath);
	try {
		execFileSync(
			"zsyncmake",
			["-u", appImageFileName, "-o", zsyncOutputPath, appImagePath],
			{ stdio: "inherit" },
		);
		console.log(`[appimage-updateinfo] Generated zsync control file: ${zsyncOutputPath}`);
		return true;
	} catch (err) {
		console.warn(
			`[appimage-updateinfo] zsyncmake failed or is not available. Please install 'zsync' to generate delta files: ${err.message}`,
		);
		return false;
	}
}

function processReleaseAppImages() {
	if (!existsSync(releaseRoot)) {
		console.log("[appimage-updateinfo] Release directory does not exist. Skipping.");
		return;
	}

	const appImageFiles = readdirSync(releaseRoot)
		.filter((f) => f.endsWith(".AppImage"))
		.map((f) => path.join(releaseRoot, f))
		.filter((f) => statSync(f).isFile());

	if (appImageFiles.length === 0) {
		console.log("[appimage-updateinfo] No .AppImage files found in release directory.");
		return;
	}

	const owner = process.env.GITHUB_REPOSITORY_OWNER || DEFAULT_OWNER;
	const repo = process.env.GITHUB_REPOSITORY?.split("/")[1] || DEFAULT_REPO;

	for (const appImagePath of appImageFiles) {
		const fileName = path.basename(appImagePath);
		const zsyncFileName = `${fileName}.zsync`;
		const zsyncOutputPath = path.join(releaseRoot, zsyncFileName);

		const updateInfoString =
			process.env.APPIMAGE_UPDATE_INFO ||
			`gh-releases-zsync|${owner}|${repo}|latest|${zsyncFileName}`;

		embedUpdateInfoInAppImage(appImagePath, updateInfoString);
		generateZsyncFile(appImagePath, zsyncOutputPath);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
	processReleaseAppImages();
}
