import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFfmpegSourceClearance } from "./ffmpeg-source-clearance.mjs";
import { assertNativeHelperManifest } from "./native-helper-manifest.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const legalName =
	/^(licen[cs]es?|copying|notices?|authors|copyright|thirdpartynotices)(?:[._-].*)?$/i;
const archNames = ["ia32", "x64", "armv7l", "arm64", "universal"];
const assetDirectories = [
	"src/assets/cursors/community",
	"src/assets/cursors/pixel-glove",
	"src/assets/fonts/dm-sans",
	"src/assets/fonts/tiktok-sans",
	"src/assets/liquid-glass",
];
const requiredLegalFiles = [
	"src/assets/cursors/community/README.md",
	"src/assets/cursors/community/bee/LICENSE",
	"src/assets/cursors/community/breezex/LICENSE",
	"src/assets/cursors/community/catppuccin-pink/LICENSE",
	"src/assets/cursors/community/catppuccin-pink/AUTHORS",
	"src/assets/cursors/pixel-glove/README.md",
	"src/assets/cursors/pixel-glove/COPYING",
	"src/assets/cursors/pixel-glove/LICENSE.GPL",
	"src/assets/cursors/pixel-glove/AUTHORS",
	"src/assets/fonts/dm-sans/OFL.txt",
	"src/assets/fonts/tiktok-sans/OFL.txt",
	"src/assets/liquid-glass/LICENSE",
	"build/legal/sherpa-onnx/LICENSE",
	"build/legal/onnxruntime/LICENSE",
	"build/legal/onnxruntime/ThirdPartyNotices.txt",
];

async function exists(file) {
	try {
		await stat(file);
		return true;
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}

async function copy(source, destination) {
	await mkdir(path.dirname(destination), { recursive: true });
	await copyFile(source, destination);
}

async function walk(directory, visit) {
	for (const item of await readdir(directory, { withFileTypes: true })) {
		if (item.isSymbolicLink() || item.name === "node_modules" || item.name === ".git") continue;
		const file = path.join(directory, item.name);
		if (item.isDirectory()) await walk(file, visit);
		else if (item.isFile()) await visit(file);
	}
}

function packageName(specifier) {
	if (
		!specifier ||
		specifier.startsWith(".") ||
		specifier.startsWith("/") ||
		specifier.startsWith("@/") ||
		specifier.startsWith("node:")
	)
		return null;
	return specifier.startsWith("@")
		? specifier.split("/").slice(0, 2).join("/")
		: specifier.split("/")[0];
}

async function findPackage(name, from) {
	let current = from;
	while (true) {
		const candidate = path.join(current, "node_modules", name);
		if (await exists(path.join(candidate, "package.json"))) return realpath(candidate);
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

async function importedPackages(projectDir, metadata) {
	const declared = new Set([
		...Object.keys(metadata.dependencies ?? {}),
		...Object.keys(metadata.devDependencies ?? {}),
	]);
	const names = new Set(Object.keys(metadata.dependencies ?? {}));
	for (const directory of ["src", "electron"]) {
		if (!(await exists(path.join(projectDir, directory)))) continue;
		await walk(path.join(projectDir, directory), async (file) => {
			if (!/(?:\.[cm]?[jt]sx?|\.css)$/.test(file) || /\.(test|spec)\./.test(file)) return;
			const text = await readFile(file, "utf8");
			for (const match of text.matchAll(
				/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bnodeRequire\s*\(\s*|@plugin\s*)["']([^"']+)["']/g,
			)) {
				const name = packageName(match[1]);
				if (name && declared.has(name)) names.add(name);
			}
		});
	}
	return [...names].sort();
}

async function packageNotices(projectDir, outputDir, metadata) {
	const queue = [];
	for (const name of await importedPackages(projectDir, metadata)) {
		const directory = await findPackage(name, projectDir);
		if (!directory)
			throw new Error(
				`Cannot prepare distribution notices: package ${name} is not installed.`,
			);
		queue.push(directory);
	}
	const visited = new Set();
	const records = [];
	while (queue.length) {
		const directory = queue.shift();
		if (visited.has(directory)) continue;
		visited.add(directory);
		const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
		// Hash the package's relative install location to distinguish nested versions
		// without putting a developer's absolute filesystem path in the installer.
		const location = path.relative(projectDir, directory).split(path.sep).join("/");
		const suffix = createHash("sha256").update(location).digest("hex").slice(0, 8);
		const target = path.join(
			"npm",
			`${pkg.name.replaceAll("/", "__")}@${pkg.version}-${suffix}`,
		);
		const files = [];
		await walk(directory, async (file) => {
			if (!legalName.test(path.basename(file))) return;
			const relative = path.relative(directory, file);
			await copy(file, path.join(outputDir, target, relative));
			files.push(relative.split(path.sep).join("/"));
		});
		const supplement = path.join(
			projectDir,
			"build/legal/packages",
			`${pkg.name.replaceAll("/", "__")}@${pkg.version}`,
		);
		if (await exists(supplement)) {
			await walk(supplement, async (file) => {
				const relative = path.join("upstream", path.relative(supplement, file));
				await copy(file, path.join(outputDir, target, relative));
				if (legalName.test(path.basename(file)))
					files.push(relative.split(path.sep).join("/"));
			});
		}
		if (!files.length) {
			for (const name of await readdir(directory)) {
				if (
					/^readme(?:\..*)?$/i.test(name) &&
					(await stat(path.join(directory, name))).isFile()
				) {
					await copy(path.join(directory, name), path.join(outputDir, target, name));
				}
			}
		}
		const record = {
			name: pkg.name,
			version: pkg.version,
			license: pkg.license ?? pkg.licenses ?? "UNSPECIFIED",
			repository: pkg.repository ?? null,
			noticeDirectory: target.split(path.sep).join("/"),
			legalFiles: files.sort(),
		};
		await mkdir(path.join(outputDir, target), { recursive: true });
		await writeFile(
			path.join(outputDir, target, "package-notice.json"),
			`${JSON.stringify(record, null, 2)}\n`,
		);
		records.push(record);
		for (const name of new Set([
			...Object.keys(pkg.dependencies ?? {}),
			...Object.keys(pkg.optionalDependencies ?? {}),
			...Object.keys(pkg.peerDependencies ?? {}),
		])) {
			const dependency = await findPackage(name, directory);
			if (dependency) queue.push(dependency);
		}
	}
	return records.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

export async function prepareDistributionNotices({
	projectDir = root,
	outputDir,
	platform = process.platform,
	arch = process.arch,
}) {
	const os = { darwin: "mac", win32: "win", linux: "linux" }[platform];
	if (!os) throw new Error(`Unsupported distribution platform: ${platform}`);
	for (const file of requiredLegalFiles) {
		if (!(await exists(path.join(projectDir, file))))
			throw new Error(`Missing required distribution notice: ${file}`);
	}
	outputDir ??= path.join(projectDir, ".tmp", "distribution-notices", `${os}-${arch}`);
	await rm(outputDir, { recursive: true, force: true });
	await mkdir(outputDir, { recursive: true });
	for (const name of ["LICENSE.md", "THIRD_PARTY_NOTICES.md"]) {
		await copy(path.join(projectDir, name), path.join(outputDir, name));
	}
	for (const directory of assetDirectories) {
		const source = path.join(projectDir, directory);
		if (!(await exists(source)))
			throw new Error(`Missing distribution asset source/notices: ${directory}`);
		await walk(source, async (file) => {
			// Preserve GPL cursor editable source and runtime renders together. Font
			// binaries are already in the app; their OFL text/provenance belongs here.
			if (
				directory.includes("cursors/") ||
				legalName.test(path.basename(file)) ||
				/^OFL\./i.test(path.basename(file)) ||
				/^README/i.test(path.basename(file))
			) {
				await copy(
					file,
					path.join(
						outputDir,
						"assets",
						path.relative(path.join(projectDir, "src/assets"), file),
					),
				);
			}
		});
	}
	const nativeNotices = path.join(projectDir, "build/legal");
	if (await exists(nativeNotices))
		await walk(nativeNotices, (file) =>
			copy(file, path.join(outputDir, "native", path.relative(nativeNotices, file))),
		);
	const metadata = JSON.parse(await readFile(path.join(projectDir, "package.json"), "utf8"));
	const packages = await packageNotices(projectDir, outputDir, metadata);
	const ffmpeg = path.join(
		projectDir,
		"node_modules/ffmpeg-static",
		platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
	);
	for (const extension of [".distribution.json", ".LICENSE", ".README"]) {
		await copy(`${ffmpeg}${extension}`, path.join(outputDir, "ffmpeg", `ffmpeg${extension}`));
	}
	const ffmpegSources = `${ffmpeg}.sources`;
	if (await exists(ffmpegSources))
		await walk(ffmpegSources, (file) =>
			copy(file, path.join(outputDir, "ffmpeg/sources", path.relative(ffmpegSources, file))),
		);
	if (platform === "win32") {
		const ffprobe = path.join(
			projectDir,
			"node_modules/ffprobe-static/bin/win32",
			arch,
			"ffprobe.exe",
		);
		for (const extension of [".distribution.json", ".LICENSE", ".README"]) {
			await copy(
				`${ffprobe}${extension}`,
				path.join(outputDir, "ffprobe", `ffprobe${extension}`),
			);
		}
	}
	let revision = "unavailable";
	let dirty = true;
	try {
		revision = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: projectDir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		dirty = Boolean(
			execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
				cwd: projectDir,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim(),
		);
	} catch {
		/* Source archives can be built without Git metadata. */
	}
	await writeFile(
		path.join(outputDir, "SOURCE_CODE.txt"),
		`Recordly ${metadata.version}\nSource repository: https://github.com/webadderallorg/Recordly\nRecorded checkout revision: ${revision}\nCheckout includes uncommitted changes: ${dirty}\n\nThe recorded revision identifies the checkout base; when changes are present it is not the complete source for this binary. Distributors must provide the corresponding source for the actual build alongside the release. Previous release source: https://github.com/webadderallorg/Recordly/releases\n\nCursor source and its original licenses/provenance are included under assets/cursors. Third-party licenses remain applicable to their respective components, independently of any Recordly commercial terms. Caption model weights are downloaded separately; see THIRD_PARTY_NOTICES.md for model attribution and license links.\n`,
	);
	const manifest = {
		formatVersion: 1,
		product: metadata.name,
		version: metadata.version,
		platform,
		arch,
		revision,
		dirty,
		packages,
		packagesWithoutLegalFiles: packages
			.filter((pkg) => !pkg.legalFiles.length)
			.map((pkg) => `${pkg.name}@${pkg.version}`),
	};
	await writeFile(
		path.join(outputDir, "manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	return { outputDir, manifest };
}

export default async function beforePack(context) {
	const projectDir = context.packager.projectDir;
	const arch = typeof context.arch === "number" ? archNames[context.arch] : context.arch;
	if (!arch) throw new Error(`Unsupported packaging architecture: ${context.arch}`);
	const platform = context.electronPlatformName;
	// Direct and cross-target packaging can bypass the Windows build script.
	// Never ship a cached capture executable after its source has changed.
	if (platform === "win32") {
		assertNativeHelperManifest({
			projectRoot: projectDir,
			helperId: "wgc-capture",
			sourceDir: path.join(projectDir, "electron/native/wgc-capture"),
			binaryPath: path.join(
				projectDir,
				"electron/native/bin",
				`win32-${arch}`,
				"wgc-capture.exe",
			),
			binaryName: "wgc-capture.exe",
			platform,
			arch,
		});
	}
	assertFfmpegSourceClearance({ platform, arch });
	const { ensureRedistributableFfmpeg, verifyFfmpegDistribution, verifyFfprobeDistribution } =
		await import("./ffmpeg-distribution.mjs");
	const binary = path.join(
		projectDir,
		"node_modules/ffmpeg-static",
		platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
	);
	await ensureRedistributableFfmpeg({ root: projectDir, platform, arch });
	verifyFfmpegDistribution(binary, { platform, arch });
	if (platform === "win32") {
		const ffprobe = path.join(
			projectDir,
			"node_modules/ffprobe-static/bin/win32",
			arch,
			"ffprobe.exe",
		);
		verifyFfprobeDistribution(ffprobe, { platform, arch });
	}
	const { outputDir, manifest } = await prepareDistributionNotices({
		projectDir,
		platform,
		arch,
	});
	console.log(
		`[licenses] Prepared notices for ${manifest.packages.length} packages in ${path.relative(projectDir, outputDir)}.`,
	);
	if (manifest.packagesWithoutLegalFiles.length)
		console.warn(
			`[licenses] Packages with no separate legal file (metadata/README included): ${manifest.packagesWithoutLegalFiles.join(", ")}`,
		);
}
