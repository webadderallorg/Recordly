import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAC_SOURCE_ARCHIVES, sourceArchive } from "./build-redistributable-ffmpeg.mjs";

export const PINNED_BUILD_ID = "recordly-ffmpeg-8.1.2-x264-libvpx-zlib-v2";
export const PINNED_SOURCE_ARCHIVES = Object.freeze([
	...MAC_SOURCE_ARCHIVES,
	{
		name: "zlib-1.4.tar.gz",
		url: "https://zlib.net/fossils/zlib-1.4.tar.gz",
		sha256: "02dd159783677a749c04adbdd02b55b8a2bcc7e054f51b76b549199a916ad584",
	},
]);
export const PINNED_BUILD_FILES = [
	"build-pinned-ffmpeg.sh",
	"build-pinned-ffmpeg.mjs",
	"build-redistributable-ffmpeg.mjs",
	"build.json",
	"ffmpeg-config.mak",
	"COPYING.GPLv3",
	"FFmpeg-LICENSE.md",
	"x264-COPYING",
	"libvpx-LICENSE",
	"zlib-LICENSE",
	"ffmpeg-license.txt",
	"ffprobe-license.txt",
];

const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function supportsPinnedBuild(platform, arch) {
	return arch === "x64" && (platform === "win32" || platform === "linux");
}

function run(command, args, options, log) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { ...options, windowsHide: true });
		const output = [];
		const file = log && createWriteStream(log);
		file?.on("error", reject);
		for (const stream of [child.stdout, child.stderr]) {
			stream.on("data", (chunk) => {
				file?.write(chunk);
				output.push(chunk);
				if (log && output.length > 64) output.shift();
			});
		}
		child.once("error", reject);
		child.once("close", (code) => {
			const finish = () => {
				const tail = Buffer.concat(output).toString();
				if (code === 0) resolve(tail);
				else
					reject(
						new Error(
							`${command} exited with ${code}.${log ? ` Full log: ${log}.` : ""}\n${tail.slice(-8000)}`,
						),
					);
			};
			if (file) file.end(finish);
			else finish();
		});
	});
}

function nativeTools(platform) {
	if (platform === "linux")
		return { bash: "/bin/bash", objdump: "/usr/bin/objdump", env: { PATH: "/usr/bin:/bin" } };
	const msys = path.resolve(process.env.RECORDLY_MSYS2_ROOT || "C:/msys64");
	const bash = path.join(msys, "usr/bin/bash.exe");
	const objdump = path.join(msys, "ucrt64/bin/objdump.exe");
	if (!existsSync(bash) || !existsSync(objdump)) {
		throw new Error(
			"Set RECORDLY_MSYS2_ROOT to MSYS2 with UCRT64 GCC, NASM, pkgconf and MSYS make installed.",
		);
	}
	const systemRoot = process.env.SystemRoot || "C:/Windows";
	return {
		bash,
		objdump,
		env: {
			Path: [
				path.join(msys, "ucrt64/bin"),
				path.join(msys, "usr/bin"),
				path.join(systemRoot, "System32"),
			].join(";"),
			SystemRoot: systemRoot,
			ComSpec: path.join(systemRoot, "System32", "cmd.exe"),
			MSYSTEM: "UCRT64",
		},
	};
}

async function inspectBinary(binary, tools, platform) {
	const license = await run(binary, ["-L"], { env: tools.env });
	if (
		!/GNU General Public License/i.test(license) ||
		/--enable-nonfree(?:\s|$)|not legally redistributable|unredistributable/i.test(license)
	) {
		throw new Error(`Compiled license check failed for ${path.basename(binary)}.`);
	}
	const output = await run(tools.objdump, ["-p", binary], { env: tools.env });
	const pattern = platform === "win32" ? /DLL Name:\s*(\S+)/gi : /^\s*NEEDED\s+(\S+)/gm;
	const libraries = [...new Set([...output.matchAll(pattern)].map((match) => match[1]))].sort();
	if (!libraries.length) throw new Error(`Could not inspect dependencies of ${binary}.`);
	for (const library of libraries) {
		const systemLibrary =
			platform === "win32"
				? /^[\w.-]+\.dll$/i.test(library) &&
					(/^(?:api|ext)-ms-win-/i.test(library) ||
						existsSync(path.join(tools.env.SystemRoot, "System32", library)))
				: /^(?:libc|libm|libpthread|libdl|librt)\.so\.\d+$/.test(library);
		if (!systemLibrary)
			throw new Error(`Non-system dynamic dependency in ${binary}: ${library}`);
	}
	return { license, libraries };
}

export async function withPinnedFfmpegWorkspace(use) {
	const parent = await fs.realpath(os.tmpdir());
	const prefix = "recordly-ffmpeg-";
	const work = await fs.mkdtemp(path.join(parent, prefix));
	const removeWorkspace = async () => {
		const target = await fs.realpath(work);
		if (path.dirname(target) !== parent || !path.basename(target).startsWith(prefix)) {
			throw new Error("Refusing to clean up an unexpected FFmpeg build directory.");
		}
		await fs.rm(target, { recursive: true, force: true, maxRetries: 3 });
	};
	let result;
	try {
		result = await use(work);
	} catch (error) {
		await removeWorkspace().catch((cleanupError) => {
			console.warn(`[ffmpeg-source] Could not clean up ${work}: ${cleanupError.message}`);
		});
		throw error;
	}
	await removeWorkspace();
	return result;
}

/** Build and inspect both binaries before handing either to the packaging workflow. */
export async function buildPinnedFfmpeg({ root, platform, arch, work }) {
	if (
		!supportsPinnedBuild(platform, arch) ||
		platform !== process.platform ||
		arch !== process.arch
	) {
		throw new Error(`The pinned FFmpeg build requires a native ${platform}/${arch} host.`);
	}
	const tools = nativeTools(platform);
	const cache = path.join(root, ".tmp", "ffmpeg-source-cache");
	await fs.mkdir(cache, { recursive: true });
	const logDirectory = path.join(root, ".tmp", "ffmpeg-source-logs");
	await fs.mkdir(logDirectory, { recursive: true });
	const log = path.join(logDirectory, `${path.basename(work)}.log`);
	const evidence = path.join(work, "evidence");
	await fs.mkdir(evidence);
	for (const [index, source] of PINNED_SOURCE_ARCHIVES.entries()) {
		const archive = await sourceArchive(source, cache);
		const directory = path.join(work, ["ffmpeg", "x264", "libvpx", "zlib"][index]);
		await fs.mkdir(directory);
		await run("tar", ["-xf", archive, "--strip-components=1", "-C", directory], {});
		await fs.copyFile(archive, path.join(evidence, source.name));
	}
	for (const name of PINNED_BUILD_FILES.slice(0, 3)) {
		await fs.copyFile(path.join(here, name), path.join(evidence, name));
	}
	const env = { ...tools.env, HOME: work, TMPDIR: work, TEMP: work, TMP: work, LANG: "C" };
	const target = `${platform}-${arch}`;
	const jobs = String(Math.max(1, Math.min(8, os.availableParallelism())));
	const args = ["evidence/build-pinned-ffmpeg.sh", target, jobs];
	console.log(`[ffmpeg-source] Building ${target}. Log: ${log}`);
	await run(tools.bash, args, { cwd: work, env }, log);

	const binaries = {};
	const binaryHashes = {};
	const dependencies = {};
	for (const tool of ["ffmpeg", "ffprobe"]) {
		const filename = tool + (platform === "win32" ? ".exe" : "");
		const binary = path.join(work, "ffmpeg", filename);
		const { license, libraries } = await inspectBinary(binary, tools, platform);
		binaries[tool] = binary;
		binaryHashes[tool] = sha256(await fs.readFile(binary));
		dependencies[tool] = libraries;
		await fs.writeFile(path.join(evidence, `${tool}-license.txt`), license);
	}
	for (const [from, to] of [
		["ffmpeg/ffbuild/config.mak", "ffmpeg-config.mak"],
		["ffmpeg/COPYING.GPLv3", "COPYING.GPLv3"],
		["ffmpeg/LICENSE.md", "FFmpeg-LICENSE.md"],
		["x264/COPYING", "x264-COPYING"],
		["libvpx/LICENSE", "libvpx-LICENSE"],
		["zlib/LICENSE", "zlib-LICENSE"],
	]) {
		await fs.copyFile(path.join(work, from), path.join(evidence, to));
	}
	const record = {
		buildId: PINNED_BUILD_ID,
		platform,
		arch,
		sources: PINNED_SOURCE_ARCHIVES,
		args,
		binaryHashes,
		dependencies,
	};
	await fs.writeFile(path.join(evidence, "build.json"), `${JSON.stringify(record, null, 2)}\n`);
	const files = Object.fromEntries(
		await Promise.all(
			PINNED_BUILD_FILES.map(async (name) => [
				name,
				sha256(await fs.readFile(path.join(evidence, name))),
			]),
		),
	);
	return { evidence, binaries, provenance: { ...record, files } };
}
