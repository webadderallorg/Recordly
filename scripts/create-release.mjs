import { execFileSync } from "node:child_process";
import fs from "node:fs";

function printUsage() {
	console.error(`Usage:
  node scripts/create-release.mjs --tag <tag> [--title <title>] [--notes <text> | --notes-file <path>] [--prerelease] [--draft]

Examples:
  node scripts/create-release.mjs --tag v1.2.0-beta.2 --title "v1.2.0 beta-2" --prerelease --notes-file ./release-notes.md
  node scripts/create-release.mjs --tag v1.2.0 --notes "Stable release summary"
`);
}

function parseArgs(argv) {
	const parsed = {
		tag: "",
		title: "",
		notes: "",
		notesFile: "",
		prerelease: false,
		draft: false,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		switch (arg) {
			case "--tag":
				parsed.tag = argv[++i] ?? "";
				break;
			case "--title":
				parsed.title = argv[++i] ?? "";
				break;
			case "--notes":
				parsed.notes = argv[++i] ?? "";
				break;
			case "--notes-file":
				parsed.notesFile = argv[++i] ?? "";
				break;
			case "--prerelease":
				parsed.prerelease = true;
				break;
			case "--draft":
				parsed.draft = true;
				break;
			case "--help":
			case "-h":
				printUsage();
				process.exit(0);
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (!parsed.tag) {
		throw new Error("Missing required --tag argument");
	}

	if (parsed.notes && parsed.notesFile) {
		throw new Error("Use either --notes or --notes-file, not both");
	}

	return parsed;
}

function loadNotes({ notes, notesFile }) {
	if (notesFile) {
		return fs.readFileSync(notesFile, "utf8");
	}

	return notes;
}

function resolveGhBinary() {
	const candidates = [
		process.env.GH_BIN,
		"gh",
		"/opt/homebrew/bin/gh",
		"/usr/local/bin/gh",
	].filter(Boolean);

	for (const candidate of candidates) {
		try {
			execFileSync(candidate, ["--version"], { stdio: "ignore" });
			return candidate;
		} catch {
			continue;
		}
	}

	throw new Error(
		"Could not find the GitHub CLI. Install `gh`, add it to PATH, or set GH_BIN to its full path.",
	);
}

try {
	const options = parseArgs(process.argv.slice(2));
	const notes = loadNotes(options).trim();
	const ghBinary = resolveGhBinary();
	const commandArgs = ["release", "create", options.tag, "--verify-tag", "--generate-notes"];

	if (options.title) {
		commandArgs.push("--title", options.title);
	}

	if (notes) {
		commandArgs.push("--notes", notes);
	}

	if (options.prerelease) {
		commandArgs.push("--prerelease");
	}

	if (options.draft) {
		commandArgs.push("--draft");
	}

	execFileSync(ghBinary, commandArgs, { stdio: "inherit" });
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	printUsage();
	process.exit(1);
}
