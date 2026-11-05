import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAC_BUILD_ID = "recordly-ffmpeg-8.1.2-x264-31e19f9-v1";
export const MAC_SOURCE_ARCHIVES = Object.freeze([
	{
		name: "ffmpeg-8.1.2.tar.xz",
		url: "https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz",
		sha256: "464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c",
	},
	{
		name: "x264-31e19f92f00c7003fa115047ce50978bc98c3a0d.tar.gz",
		// This public mirror archive byte-matches VideoLAN's archive of this commit.
		url: "https://codeload.github.com/mirror/x264/tar.gz/31e19f92f00c7003fa115047ce50978bc98c3a0d",
		sha256: "d053c9d86988d6bc78237ca5205865c5ddf99c98ef4cd9927eec8f6d388f6dd9",
	},
	{
		name: "libvpx-1.16.0.tar.gz",
		url: "https://github.com/webmproject/libvpx/archive/refs/tags/v1.16.0.tar.gz",
		sha256: "7a479a3c66b9f5d5542a4c6a1b7d3768a983b1e5c14c60a9396edc9b649e015c",
	},
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function run(command, args, { cwd, env = process.env, log, timeout = 1_200_000 } = {}) {
	const output = [];
	const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
	const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
	const record = (chunk) => {
		output.push(chunk);
		// Retain the end of verbose build output without unbounded memory growth.
		while (output.length > 100) output.shift();
	};
	child.stdout.on("data", record);
	child.stderr.on("data", record);
	try {
		await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code, signal) => {
				if (code === 0) resolve();
				else
					reject(
						new Error(
							`${command} failed (${signal ?? code}):\n${Buffer.concat(output).toString().slice(-10_000)}`,
						),
					);
			});
		});
		return Buffer.concat(output).toString();
	} finally {
		clearTimeout(timer);
		if (log) await fs.writeFile(log, Buffer.concat(output));
	}
}

async function sourceArchive(source, cache) {
	const target = path.join(cache, `${source.sha256}-${source.name}`);
	try {
		if (sha256(await fs.readFile(target)) === source.sha256) return target;
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const response = await fetch(source.url, { signal: AbortSignal.timeout(120_000) });
	if (!response.ok) throw new Error(`Source download failed: ${source.url} (${response.status})`);
	const chunks = [];
	let length = 0;
	for await (const chunk of response.body) {
		length += chunk.length;
		if (length > 40 * 1024 * 1024) throw new Error(`Source archive too large: ${source.name}`);
		chunks.push(chunk);
	}
	const bytes = Buffer.concat(chunks);
	if (sha256(bytes) !== source.sha256)
		throw new Error(`Source checksum mismatch: ${source.name}`);
	const temporary = `${target}.${process.pid}.tmp`;
	await fs.writeFile(temporary, bytes, { flag: "wx" });
	await fs.rename(temporary, target);
	return target;
}

/** Build a standalone GPL FFmpeg; importing this module never starts a build. */
export async function buildMacFfmpeg({ root, arch, destination }) {
	if (process.platform !== "darwin" || !["arm64", "x64"].includes(arch)) {
		throw new Error("The redistributable macOS FFmpeg build requires macOS and arm64/x64.");
	}
	if (!path.isAbsolute(root) || !path.isAbsolute(destination))
		throw new Error("Build paths must be absolute.");
	const cache = path.join(
		os.homedir(),
		"Library",
		"Caches",
		"Recordly",
		"ffmpeg-source",
		MAC_BUILD_ID,
	);
	await fs.mkdir(cache, { recursive: true });
	// Build configuration is embedded in FFmpeg. Avoid embedding the user's home path.
	const work = await fs.mkdtemp(path.join("/tmp", `recordly-ffmpeg-${arch}-`));
	const prefix = path.join(work, "prefix");
	const evidence = path.join(work, "evidence");
	await fs.mkdir(evidence);
	const archives = await Promise.all(
		MAC_SOURCE_ARCHIVES.map((source) => sourceArchive(source, cache)),
	);
	const sdk = (await run("xcrun", ["--show-sdk-path"])).trim();
	const targetArch = arch === "x64" ? "x86_64" : "arm64";
	const cflags = `-arch ${targetArch} -isysroot ${sdk} -mmacosx-version-min=11.0`;
	const env = {
		// FFmpeg's config.log dumps its environment. Do not pass credentials,
		// agent session identifiers, or personal shell settings into its build.
		PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
		HOME: work,
		TMPDIR: work,
		LANG: "C",
		LC_ALL: "C",
		CC: "clang",
		CXX: "clang++",
		CFLAGS: cflags,
		CXXFLAGS: cflags,
		LDFLAGS: cflags,
		MACOSX_DEPLOYMENT_TARGET: "11.0",
		PKG_CONFIG_PATH: path.join(prefix, "lib", "pkgconfig"),
		PKG_CONFIG_LIBDIR: path.join(prefix, "lib", "pkgconfig"),
	};
	const jobs = String(Math.max(1, Math.min(8, os.availableParallelism())));
	const commands = [];
	const execute = async (command, args, cwd, label) => {
		commands.push({ command, args, directory: path.relative(work, cwd) });
		console.log(`[ffmpeg-source] ${label}`);
		return run(command, args, { cwd, env, log: path.join(evidence, `${label}.log`) });
	};
	for (let i = 0; i < MAC_SOURCE_ARCHIVES.length; i++) {
		const source = MAC_SOURCE_ARCHIVES[i];
		await fs.copyFile(archives[i], path.join(evidence, source.name));
		const directory = path.join(work, ["ffmpeg", "x264", "libvpx"][i]);
		await fs.mkdir(directory);
		await run("tar", ["-xf", archives[i], "--strip-components=1", "-C", directory]);
	}
	const x264 = path.join(work, "x264");
	const ffmpeg = path.join(work, "ffmpeg");
	const x264Args = [
		`--prefix=${prefix}`,
		"--enable-static",
		"--disable-shared",
		"--disable-cli",
		"--enable-pic",
		`--host=${arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`,
		`--extra-cflags=${cflags}`,
		`--extra-ldflags=${cflags}`,
	];
	if (arch === "x64") {
		try {
			await run("nasm", ["-v"], { env });
		} catch {
			x264Args.push("--disable-asm");
		}
	}
	await execute("./configure", x264Args, x264, "configure-x264");
	await execute("make", ["-j", jobs], x264, "make-x264");
	await execute("make", ["install"], x264, "install-x264");
	const libvpx = path.join(work, "libvpx");
	const vpxArgs = [
		`--prefix=${prefix}`,
		`--target=${arch === "arm64" ? "arm64-darwin20-gcc" : "x86_64-darwin20-gcc"}`,
		"--enable-static",
		"--disable-shared",
		"--enable-pic",
		"--disable-examples",
		"--disable-tools",
		"--disable-unit-tests",
		"--disable-docs",
		"--disable-debug",
	];
	if (arch === "x64") {
		try {
			await run("nasm", ["-v"], { env });
		} catch {
			// libvpx has no --disable-assembly switch. Its generic target retains
			// portable C implementations; CFLAGS still select the x86_64 slice.
			vpxArgs[1] = "--target=generic-gnu";
		}
	}
	await execute("./configure", vpxArgs, libvpx, "configure-libvpx");
	await execute("make", ["-j", jobs], libvpx, "make-libvpx");
	await execute("make", ["install"], libvpx, "install-libvpx");
	const configureArgs = [
		`--prefix=${prefix}`,
		`--arch=${targetArch}`,
		"--target-os=darwin",
		"--cc=clang",
		"--cxx=clang++",
		`--sysroot=${sdk}`,
		`--extra-cflags=${cflags}`,
		`--extra-ldflags=${cflags}`,
		"--pkg-config-flags=--static",
		"--disable-autodetect",
		"--disable-nonfree",
		"--enable-gpl",
		"--enable-version3",
		"--enable-static",
		"--disable-shared",
		"--enable-libx264",
		"--enable-libvpx",
		"--enable-videotoolbox",
		"--enable-audiotoolbox",
		"--enable-avfoundation",
		"--enable-securetransport",
		"--enable-zlib",
		"--enable-pthreads",
		"--disable-ffplay",
		"--disable-doc",
		"--disable-debug",
	];
	if (arch !== process.arch) configureArgs.push("--enable-cross-compile");
	if (arch === "x64") {
		try {
			await run("nasm", ["-v"], { env });
		} catch {
			configureArgs.push("--disable-x86asm");
		}
	}
	await execute("./configure", configureArgs, ffmpeg, "configure-ffmpeg");
	await execute("make", ["-j", jobs, "ffmpeg", "ffprobe"], ffmpeg, "make-ffmpeg");
	const built = path.join(ffmpeg, "ffmpeg");
	const links = await run("otool", ["-L", built]);
	for (const line of links.split("\n").slice(1)) {
		const dependency = line.trim().split(" ")[0];
		if (
			dependency &&
			!dependency.startsWith("/usr/lib/") &&
			!dependency.startsWith("/System/Library/")
		) {
			throw new Error(`FFmpeg has a non-system dependency: ${dependency}`);
		}
	}
	if (arch === process.arch) {
		const license = await run(built, ["-L"]);
		if (
			/--enable-nonfree(?:\s|$)|not legally redistributable|unredistributable/i.test(
				license,
			) ||
			!/GNU General Public License/i.test(license)
		) {
			throw new Error("FFmpeg did not pass its compiled GPL redistribution check.");
		}
		await fs.writeFile(path.join(evidence, "compiled-license.txt"), license);
	}
	await fs.copyFile(path.join(ffmpeg, "COPYING.GPLv3"), path.join(evidence, "COPYING.GPLv3"));
	await fs.copyFile(path.join(ffmpeg, "LICENSE.md"), path.join(evidence, "FFmpeg-LICENSE.md"));
	await fs.copyFile(path.join(x264, "COPYING"), path.join(evidence, "x264-COPYING"));
	await fs.copyFile(path.join(libvpx, "LICENSE"), path.join(evidence, "libvpx-LICENSE"));
	// Raw config.log contains a shell environment dump. The generated make
	// configuration records build settings without publishing that environment.
	await fs.copyFile(
		path.join(ffmpeg, "ffbuild", "config.mak"),
		path.join(evidence, "ffmpeg-config.mak"),
	);
	await fs.copyFile(
		fileURLToPath(import.meta.url),
		path.join(evidence, "build-redistributable-ffmpeg.mjs"),
	);
	const provenance = { buildId: MAC_BUILD_ID, sources: MAC_SOURCE_ARCHIVES, configureArgs };
	await fs.writeFile(
		path.join(evidence, "build.json"),
		`${JSON.stringify({ ...provenance, commands, links }, null, 2)}\n`,
	);
	await fs.mkdir(path.dirname(destination), { recursive: true });
	await fs.copyFile(built, destination);
	await fs.chmod(destination, 0o755);
	await fs.copyFile(path.join(ffmpeg, "ffprobe"), `${destination}.ffprobe`);
	await fs.chmod(`${destination}.ffprobe`, 0o755);
	await fs.writeFile(
		`${destination}.LICENSE`,
		[
			"FFmpeg 8.1.2 — Copyright (c) 2000–2026 the FFmpeg developers. GPL version 3 or later.",
			await fs.readFile(path.join(ffmpeg, "COPYING.GPLv3"), "utf8"),
			"FFmpeg component licensing details:",
			await fs.readFile(path.join(ffmpeg, "LICENSE.md"), "utf8"),
			"x264 — VideoLAN and the x264 authors. GPL version 2 or later; combined under GPL version 3 or later.",
			await fs.readFile(path.join(x264, "COPYING"), "utf8"),
			"libvpx 1.16.0 — The WebM Project authors:",
			await fs.readFile(path.join(libvpx, "LICENSE"), "utf8"),
		].join("\n\n"),
	);
	await fs.writeFile(
		`${destination}.README`,
		`Recordly FFmpeg 8.1.2 (${arch})\n${MAC_BUILD_ID}\nGPL version 3 or later; NO WARRANTY.\nBuilt with x264; no nonfree components.\nComplete corresponding sources and build instructions: ${path.basename(destination)}.sources/\nDistributors must publish that complete source directory alongside downloads.\n`,
	);
	// This destination belongs to this builder; preserve other cached builds.
	await fs.rm(`${destination}.sources`, { recursive: true, force: true });
	await fs.cp(evidence, `${destination}.sources`, { recursive: true });
	console.log(`[ffmpeg-source] Built ${destination}; build evidence retained at ${work}`);
	return provenance;
}
