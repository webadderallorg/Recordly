#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertValidAppleTeamId,
	collectArchitectureErrors,
	collectCodeSigningMetadataErrors,
	collectEntitlementErrors,
} from "./macos-distribution-policy.mjs";

const projectRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const productName = packageJson.productName ?? packageJson.name ?? "Recordly";
const expectedBundleId = "dev.recordly.app";
const commandTimeoutMs = 5 * 60 * 1000;
const fileClassificationBatchSize = 100;
const maxReportDetailLength = 4_000;

function parseArguments(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!key?.startsWith("--") || value === undefined) {
			throw new Error(`Invalid argument near ${key ?? "end of input"}`);
		}
		options[key.slice(2)] = value;
	}

	const arch = options.arch;
	if (arch !== "x64" && arch !== "arm64") {
		throw new Error("--arch must be x64 or arm64");
	}

	if (!options["team-id"]) {
		throw new Error("--team-id is required");
	}
	assertValidAppleTeamId(options["team-id"]);

	return {
		arch,
		releaseDir: path.resolve(options["release-dir"] ?? "release"),
		reportPath: path.resolve(
			options.report ?? `release/macos-distribution-report-${arch}.json`,
		),
		summaryPath: options.summary ? path.resolve(options.summary) : null,
		teamId: options["team-id"],
	};
}

function formatCommand(command, args) {
	return [command, ...args]
		.map((part) => (/^[\w./:=@+-]+$/.test(part) ? part : JSON.stringify(part)))
		.join(" ");
}

function runProcess(command, args, { timeout = commandTimeoutMs } = {}) {
	const result = spawnSync(command, args, {
		cwd: projectRoot,
		encoding: "utf8",
		timeout,
	});
	const stdout = result.stdout?.trim() ?? "";
	const stderr = result.stderr?.trim() ?? "";
	const output = [stdout, stderr].filter(Boolean).join("\n");

	if (result.error) {
		throw new Error(`${formatCommand(command, args)} failed: ${result.error.message}`);
	}

	if (result.status !== 0) {
		throw new Error(
			`${formatCommand(command, args)} exited with ${result.status}${output ? `\n${output}` : ""}`,
		);
	}

	return { output, stderr, stdout };
}

function assertPolicy(errors, label) {
	if (errors.length > 0) {
		throw new Error(`${label}:\n- ${errors.join("\n- ")}`);
	}
}

function assertFile(filePath, label) {
	if (!existsSync(filePath) || !statSync(filePath).isFile()) {
		throw new Error(`${label} is missing: ${filePath}`);
	}

	if (statSync(filePath).size === 0) {
		throw new Error(`${label} is empty: ${filePath}`);
	}
}

function findAppBundles(rootPath) {
	if (!existsSync(rootPath)) {
		return [];
	}

	const matches = [];
	const queue = [rootPath];
	while (queue.length > 0) {
		const currentPath = queue.shift();
		if (!currentPath) {
			continue;
		}

		for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.isSymbolicLink()) {
				continue;
			}

			const childPath = path.join(currentPath, entry.name);
			if (entry.name === `${productName}.app`) {
				matches.push(childPath);
				continue;
			}

			queue.push(childPath);
		}
	}

	return matches;
}

function findSingleAppBundle(rootPath, label) {
	const appBundles = findAppBundles(rootPath);
	if (appBundles.length !== 1) {
		throw new Error(
			`${label} must contain exactly one ${productName}.app; found ${appBundles.length}`,
		);
	}
	return appBundles[0];
}

function walkRegularFiles(rootPath) {
	const files = [];
	const queue = [rootPath];
	while (queue.length > 0) {
		const currentPath = queue.shift();
		if (!currentPath) {
			continue;
		}

		for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
			const childPath = path.join(currentPath, entry.name);
			const childStats = lstatSync(childPath);
			if (childStats.isSymbolicLink()) {
				continue;
			}

			if (childStats.isDirectory()) {
				queue.push(childPath);
			} else if (childStats.isFile()) {
				files.push(childPath);
			}
		}
	}

	return files;
}

function extractPlist(commandResult) {
	const output = [commandResult.stdout, commandResult.stderr].filter(Boolean).join("\n");
	const xmlStart = output.indexOf("<?xml");
	const plistStart = output.indexOf("<plist");
	const start = xmlStart >= 0 ? xmlStart : plistStart;
	const end = output.lastIndexOf("</plist>");
	if (start < 0 || end < start) {
		throw new Error("codesign did not return an XML entitlement plist");
	}
	return output.slice(start, end + "</plist>".length);
}

function shortenDetail(value) {
	const detail = String(value ?? "").trim();
	if (detail.length <= maxReportDetailLength) {
		return detail;
	}
	return `${detail.slice(0, maxReportDetailLength)}\n[truncated]`;
}

function createRecorder(report) {
	return function check(name, operation) {
		const startedAt = Date.now();
		try {
			const detail = operation();
			report.checks.push({
				durationMs: Date.now() - startedAt,
				name,
				status: "passed",
				...(detail ? { detail: shortenDetail(detail) } : {}),
			});
			console.log(`[macos-distribution] PASS ${name}`);
			return detail;
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			report.checks.push({
				detail: shortenDetail(detail),
				durationMs: Date.now() - startedAt,
				name,
				status: "failed",
			});
			console.error(`[macos-distribution] FAIL ${name}: ${detail}`);
			throw error;
		}
	};
}

function verifyInfoPlist(appPath, label, check) {
	const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
	check(`${label}: Info.plist policy`, () => {
		assertFile(infoPlistPath, "Info.plist");
		const plistJson = runProcess("plutil", [
			"-convert",
			"json",
			"-o",
			"-",
			infoPlistPath,
		]).stdout;
		const info = JSON.parse(plistJson);
		const errors = [];
		if (info.CFBundleIdentifier !== expectedBundleId) {
			errors.push(`unexpected CFBundleIdentifier: ${info.CFBundleIdentifier ?? "missing"}`);
		}
		if (info.CFBundleShortVersionString !== packageJson.version) {
			errors.push(
				`unexpected CFBundleShortVersionString: ${info.CFBundleShortVersionString ?? "missing"}`,
			);
		}
		for (const usageKey of [
			"NSAudioCaptureUsageDescription",
			"NSCameraUsageDescription",
			"NSMicrophoneUsageDescription",
		]) {
			if (typeof info[usageKey] !== "string" || info[usageKey].trim().length === 0) {
				errors.push(`${usageKey} is missing or empty`);
			}
		}
		assertPolicy(errors, `${label} Info.plist policy failed`);
		return `${info.CFBundleIdentifier} ${info.CFBundleShortVersionString}`;
	});
}

function verifyEntitlements(appPath, label, tempRoot, check) {
	check(`${label}: signed entitlements`, () => {
		const result = runProcess("codesign", [
			"--display",
			"--entitlements",
			"-",
			"--xml",
			appPath,
		]);
		const entitlementsPath = path.join(
			tempRoot,
			`${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-entitlements.plist`,
		);
		writeFileSync(entitlementsPath, extractPlist(result));
		runProcess("plutil", ["-lint", entitlementsPath]);
		const entitlements = JSON.parse(
			runProcess("plutil", ["-convert", "json", "-o", "-", entitlementsPath]).stdout,
		);
		assertPolicy(collectEntitlementErrors(entitlements), `${label} entitlement policy failed`);
		return "required runtime, camera, and audio entitlements are present; get-task-allow is absent";
	});
}

function verifyMachOBinaries(appPath, arch, check) {
	check("packaged app: nested Mach-O signatures and architectures", () => {
		const machOBinaries = [];
		const regularFiles = walkRegularFiles(appPath);
		for (let index = 0; index < regularFiles.length; index += fileClassificationBatchSize) {
			const batch = regularFiles.slice(index, index + fileClassificationBatchSize);
			const fileTypes = runProcess("file", ["-b", ...batch]).stdout.split(/\r?\n/);
			if (fileTypes.length !== batch.length) {
				throw new Error(
					`file classification returned ${fileTypes.length} rows for ${batch.length} paths`,
				);
			}

			for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
				if (fileTypes[batchIndex].includes("Mach-O")) {
					machOBinaries.push(batch[batchIndex]);
				}
			}
		}

		if (machOBinaries.length === 0) {
			throw new Error("no Mach-O binaries were found in the app bundle");
		}

		for (const binaryPath of machOBinaries) {
			runProcess("codesign", ["--verify", "--strict", "--verbose=2", binaryPath]);
			const lipoOutput = runProcess("lipo", ["-info", binaryPath]).output;
			assertPolicy(
				collectArchitectureErrors(path.relative(appPath, binaryPath), lipoOutput, arch),
				"Mach-O architecture policy failed",
			);
		}

		return `${machOBinaries.length} Mach-O binaries verified`;
	});
}

function verifyAppBundle(appPath, label, { arch, check, full, teamId, tempRoot }) {
	check(`${label}: strict deep code signature`, () => {
		runProcess("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
	});

	check(`${label}: Developer ID metadata`, () => {
		const details = runProcess("codesign", ["--display", "--verbose=4", appPath]).output;
		assertPolicy(
			collectCodeSigningMetadataErrors(details, teamId),
			`${label} code-signing policy failed`,
		);
		return `Developer ID Application; TeamIdentifier=${teamId}; hardened runtime; secure timestamp`;
	});

	verifyInfoPlist(appPath, label, check);
	verifyEntitlements(appPath, label, tempRoot, check);

	if (full) {
		verifyMachOBinaries(appPath, arch, check);
	}

	check(`${label}: stapled notarization ticket`, () => {
		runProcess("xcrun", ["stapler", "validate", appPath]);
	});

	check(`${label}: Gatekeeper execution assessment`, () => {
		return runProcess("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath])
			.output;
	});

	check(`${label}: distribution policy assessment`, () => {
		return runProcess("syspolicy_check", ["distribution", appPath], {
			timeout: 10 * 60 * 1000,
		}).output;
	});
}

function writeReport(report, reportPath, summaryPath) {
	report.completedAt = new Date().toISOString();
	report.result = report.checks.some((item) => item.status === "failed") ? "failed" : "passed";
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

	if (!summaryPath) {
		return;
	}

	const lines = [
		`## macOS ${report.arch} distribution verification`,
		"",
		`Result: **${report.result.toUpperCase()}**`,
		"",
		"| Check | Result |",
		"| --- | --- |",
		...report.checks.map(
			(item) =>
				`| ${item.name.replaceAll("|", "\\|")} | ${item.status === "passed" ? "PASS" : "FAIL"} |`,
		),
		"",
	];
	writeFileSync(summaryPath, `${lines.join("\n")}\n`, { flag: "a" });
}

export function verifyMacOSDistribution(argv = process.argv.slice(2)) {
	if (process.platform !== "darwin") {
		throw new Error("macOS distribution verification must run on macOS");
	}

	const options = parseArguments(argv);
	const report = {
		arch: options.arch,
		checks: [],
		packageVersion: packageJson.version,
		schemaVersion: 1,
		sourceCommit: process.env.GITHUB_SHA ?? null,
		startedAt: new Date().toISOString(),
	};
	const check = createRecorder(report);
	const tempRoot = mkdtempSync(path.join(os.tmpdir(), "recordly-macos-distribution-"));
	let mountedDmgPath = null;

	try {
		const artifactSuffix = options.arch === "arm64" ? "arm64" : "x64";
		const dmgPath = path.join(options.releaseDir, `${productName}-${artifactSuffix}.dmg`);
		const zipPath = path.join(options.releaseDir, `${productName}-${artifactSuffix}.zip`);

		check("release artifacts exist", () => {
			assertFile(dmgPath, "DMG artifact");
			assertFile(zipPath, "ZIP artifact");
			return `${path.basename(dmgPath)}, ${path.basename(zipPath)}`;
		});

		const packagedAppPath = check("packaged app bundle exists", () =>
			findSingleAppBundle(options.releaseDir, "release directory"),
		);
		verifyAppBundle(packagedAppPath, "packaged app", {
			...options,
			check,
			full: true,
			tempRoot,
		});

		check("DMG filesystem integrity", () => runProcess("hdiutil", ["verify", dmgPath]).output);
		const dmgMountPath = path.join(tempRoot, "dmg");
		check("DMG attaches read-only for inspection", () => {
			runProcess("mkdir", ["-p", dmgMountPath]);
			runProcess("hdiutil", [
				"attach",
				"-nobrowse",
				"-readonly",
				"-mountpoint",
				dmgMountPath,
				dmgPath,
			]);
			mountedDmgPath = dmgMountPath;
		});
		const dmgAppPath = check("DMG contains one app bundle", () =>
			findSingleAppBundle(dmgMountPath, "DMG"),
		);
		verifyAppBundle(dmgAppPath, "DMG app", {
			...options,
			check,
			full: false,
			tempRoot,
		});
		check("DMG detaches cleanly", () => {
			runProcess("hdiutil", ["detach", dmgMountPath]);
			mountedDmgPath = null;
		});

		const zipExtractPath = path.join(tempRoot, "zip");
		check("ZIP extracts cleanly", () => {
			runProcess("mkdir", ["-p", zipExtractPath]);
			runProcess("ditto", ["-x", "-k", "--sequesterRsrc", zipPath, zipExtractPath]);
		});
		const zipAppPath = check("ZIP contains one app bundle", () =>
			findSingleAppBundle(zipExtractPath, "ZIP"),
		);
		verifyAppBundle(zipAppPath, "ZIP app", {
			...options,
			check,
			full: false,
			tempRoot,
		});

		writeReport(report, options.reportPath, options.summaryPath);
		console.log(`[macos-distribution] verification report: ${options.reportPath}`);
		return report;
	} catch (error) {
		try {
			writeReport(report, options.reportPath, options.summaryPath);
		} catch (reportError) {
			console.error(
				`[macos-distribution] failed to write report: ${
					reportError instanceof Error ? reportError.message : String(reportError)
				}`,
			);
		}
		throw error;
	} finally {
		if (mountedDmgPath) {
			spawnSync("hdiutil", ["detach", "-force", mountedDmgPath], { encoding: "utf8" });
		}
		rmSync(tempRoot, { force: true, recursive: true });
	}
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
	try {
		verifyMacOSDistribution();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
