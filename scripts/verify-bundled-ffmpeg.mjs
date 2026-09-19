import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const ffmpegDir = path.join(projectRoot, "node_modules", "ffmpeg-static");

function relativePath(filePath) {
	return path.relative(projectRoot, filePath).replaceAll("\\", "/");
}

function fail(message) {
	console.error(`[verify-bundled-ffmpeg] ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const parsed = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--platform" || arg === "--arch") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				fail(`Missing value for ${arg}.`);
			}
			parsed[arg.slice(2)] = value;
			index += 1;
			continue;
		}
		fail(`Unknown argument: ${arg}`);
	}
	return parsed;
}

const args = parseArgs(process.argv.slice(2));
const targetPlatform = args.platform ?? process.platform;
// `--arch` accepts a comma-separated list because a single electron-builder
// invocation can emit several architectures (e.g. `--mac` builds x64 and
// arm64), while ffmpeg-static only ever has one binary staged.
const targetArches = (args.arch ?? process.arch).split(",").map((value) => value.trim());

// ffmpeg-static ships a single binary for whichever platform/arch was active
// at npm install time, so a cross-platform `npm run build:win` on macOS will
// silently package a Mach-O binary into a Windows app. Read the file's magic
// bytes and compare against the platform we are actually packaging for.
function readHeader(filePath, length) {
	const buffer = Buffer.alloc(length);
	const fd = openSync(filePath, "r");
	try {
		readSync(fd, buffer, 0, length, 0);
	} finally {
		closeSync(fd);
	}
	return buffer;
}

const MACHO_CPU_TYPES = new Map([
	[0x01000007, "x64"],
	[0x0100000c, "arm64"],
	[0x00000007, "ia32"],
]);

const ELF_MACHINES = new Map([
	[0x3e, "x64"],
	[0xb7, "arm64"],
	[0x03, "ia32"],
]);

const PE_MACHINES = new Map([
	[0x8664, "x64"],
	[0xaa64, "arm64"],
	[0x014c, "ia32"],
]);

function identifyBinary(header) {
	// ELF: 0x7F 'E' 'L' 'F'
	if (header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46) {
		const machine = header.readUInt16LE(0x12);
		return {
			platform: "linux",
			arch: ELF_MACHINES.get(machine) ?? `unknown(0x${machine.toString(16)})`,
		};
	}

	// PE: 'MZ', with the COFF header located at the offset stored in e_lfanew.
	if (header[0] === 0x4d && header[1] === 0x5a) {
		const peOffset = header.readUInt32LE(0x3c);
		if (peOffset + 6 <= header.length && header.readUInt32LE(peOffset) === 0x00004550) {
			const machine = header.readUInt16LE(peOffset + 4);
			return {
				platform: "win32",
				arch: PE_MACHINES.get(machine) ?? `unknown(0x${machine.toString(16)})`,
			};
		}
		return { platform: "win32", arch: "unknown" };
	}

	// Mach-O universal ("fat") binary.
	const fatMagic = header.readUInt32BE(0);
	if (fatMagic === 0xcafebabe || fatMagic === 0xcafebabf) {
		return { platform: "darwin", arch: "universal" };
	}

	// Mach-O thin binary, little-endian on every arch we ship.
	const machoMagic = header.readUInt32LE(0);
	if (machoMagic === 0xfeedface || machoMagic === 0xfeedfacf) {
		const cpuType = header.readUInt32LE(4);
		return {
			platform: "darwin",
			arch: MACHO_CPU_TYPES.get(cpuType) ?? `unknown(0x${cpuType.toString(16)})`,
		};
	}

	return null;
}

const installHint = (arch) =>
	`npm_config_platform=${targetPlatform} npm_config_arch=${arch} node scripts/install-ffmpeg-static.mjs`;

// ffmpeg-static names the binary "ffmpeg.exe" for win32 targets and "ffmpeg"
// everywhere else, so the file to check depends on the platform we package for.
const ffmpegPath = path.join(ffmpegDir, targetPlatform === "win32" ? "ffmpeg.exe" : "ffmpeg");

if (!existsSync(ffmpegPath) || !statSync(ffmpegPath).isFile()) {
	fail(
		`Bundled ffmpeg binary is missing at ${relativePath(ffmpegPath)}.\n` +
			`  Install it with:\n` +
			`    ${installHint(targetArches[0])}`,
	);
}

// asarUnpack globs node_modules/ffmpeg-static/**, so a binary left over from a
// previous target's install is packaged alongside the right one. Switching
// platforms writes a differently named file rather than replacing it.
const strayName = targetPlatform === "win32" ? "ffmpeg" : "ffmpeg.exe";
const strayPath = path.join(ffmpegDir, strayName);
if (existsSync(strayPath) && statSync(strayPath).isFile()) {
	fail(
		`A leftover ffmpeg binary from another target is still present.\n` +
			`  Packaging for: ${targetPlatform}\n` +
			`  Stray file:    ${relativePath(strayPath)}\n` +
			`\n` +
			`  node_modules/ffmpeg-static/** is unpacked wholesale, so this would ship\n` +
			`  inside the app alongside the correct binary. Remove it first:\n` +
			`    rm -f ${relativePath(strayPath)}`,
	);
}

const header = readHeader(ffmpegPath, 1024);
const detected = identifyBinary(header);

if (!detected) {
	fail(
		`Could not identify the format of the bundled ffmpeg binary at ${relativePath(ffmpegPath)}.\n` +
			`  It may be truncated or corrupt. Reinstall it with:\n` +
			`    ${installHint(targetArches[0])}`,
	);
}

// A universal Mach-O covers both macOS architectures, so only the platform
// needs to match for it.
const unsatisfied = targetArches.filter(
	(arch) =>
		detected.platform !== targetPlatform ||
		(detected.arch !== arch && detected.arch !== "universal"),
);

if (unsatisfied.length > 0) {
	const targetLabel = targetArches.map((arch) => `${targetPlatform}/${arch}`).join(", ");
	const multiArch = targetArches.length > 1;

	fail(
		`Bundled ffmpeg binary does not match the build target.\n` +
			`  Packaging for: ${targetLabel}\n` +
			`  Binary is:     ${detected.platform}/${detected.arch} (${relativePath(ffmpegPath)})\n` +
			`  Unsatisfied:   ${unsatisfied.map((arch) => `${targetPlatform}/${arch}`).join(", ")}\n` +
			`\n` +
			`  ffmpeg-static stages exactly one binary, chosen at npm install time, so a\n` +
			`  build cannot cover a platform or architecture other than that one.\n` +
			`  Shipping this would break every feature that shells out to ffmpeg.\n` +
			`\n` +
			(multiArch
				? `  This target spans ${targetArches.length} architectures, which one staged binary can\n` +
					`  never satisfy. Build one architecture at a time, reinstalling ffmpeg in\n` +
					`  between, for example:\n` +
					targetArches
						.map(
							(arch) =>
								`    ${installHint(arch)} && npx electron-builder --${targetPlatform === "darwin" ? "mac" : targetPlatform} --${arch}`,
						)
						.join("\n") +
					`\n`
				: `  Install the matching binary with:\n    ${installHint(targetArches[0])}\n`) +
			`\n` +
			`  A correct ffmpeg is still not sufficient for a shippable cross-platform build:\n` +
			`  native helpers and the whisper runtime are built for the host only. Prefer the\n` +
			`  platform-specific CI jobs in .github/workflows/release.yml.`,
	);
}

console.log(
	`[verify-bundled-ffmpeg] OK: ${detected.platform}/${detected.arch} satisfies build target ${targetArches.map((arch) => `${targetPlatform}/${arch}`).join(", ")} (${relativePath(ffmpegPath)})`,
);
