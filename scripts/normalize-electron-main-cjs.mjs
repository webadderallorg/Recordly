import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const mainBundleUrl = new URL("../dist-electron/main.cjs", import.meta.url);
const IMPORT_META_URL_CJS_REPLACEMENT = 'require("node:url").pathToFileURL(__filename).href';

function convertNamedImports(namedSpec) {
	return namedSpec.replace(/\s+as\s+/g, ": ");
}

function convertImportLine(line) {
	const importFromMatch = line.match(
		/^([ \t]*)import\s+([^;\n]+?)\s+from\s+(["'][^"']+["'])\s*;?[ \t]*$/,
	);
	if (importFromMatch) {
		const [, indent, rawSpec, moduleLiteral] = importFromMatch;
		const spec = rawSpec.trim();
		if (spec.startsWith("* as ")) {
			return `${indent}const ${spec.slice(5).trim()} = require(${moduleLiteral});`;
		}

		if (spec.startsWith("{")) {
			return `${indent}const ${convertNamedImports(spec)} = require(${moduleLiteral});`;
		}

		const commaIndex = spec.indexOf(",");
		if (commaIndex >= 0) {
			const defaultName = spec.slice(0, commaIndex).trim();
			const namedSpec = spec.slice(commaIndex + 1).trim();
			return [
				`${indent}const ${defaultName} = require(${moduleLiteral});`,
				`${indent}const ${convertNamedImports(namedSpec)} = ${defaultName};`,
			].join("\n");
		}

		return `${indent}const ${spec} = require(${moduleLiteral});`;
	}

	const sideEffectImportMatch = line.match(/^([ \t]*)import\s+(["'][^"']+["'])\s*;?[ \t]*$/);
	if (sideEffectImportMatch) {
		const [, indent, moduleLiteral] = sideEffectImportMatch;
		return `${indent}require(${moduleLiteral});`;
	}

	if (/^[ \t]*export\s*\{\s*\}\s*;?[ \t]*$/.test(line)) {
		return "";
	}

	return null;
}

function updateLexicalState(line, state) {
	let mode = state.mode;
	let escaped = false;

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		const next = line[index + 1];

		if (mode === "block-comment") {
			if (char === "*" && next === "/") {
				mode = null;
				index += 1;
			}
			continue;
		}

		if (mode === "single-quote" || mode === "double-quote" || mode === "template") {
			if (escaped) {
				escaped = false;
				continue;
			}

			if (char === "\\") {
				escaped = true;
				continue;
			}

			if (
				(mode === "single-quote" && char === "'") ||
				(mode === "double-quote" && char === '"') ||
				(mode === "template" && char === "`")
			) {
				mode = null;
			}
			continue;
		}

		if (char === "/" && next === "/") {
			break;
		}

		if (char === "/" && next === "*") {
			mode = "block-comment";
			index += 1;
			continue;
		}

		if (char === "'") {
			mode = "single-quote";
		} else if (char === '"') {
			mode = "double-quote";
		} else if (char === "`") {
			mode = "template";
		}
	}

	if (mode === "single-quote" || mode === "double-quote") {
		mode = null;
	}

	return { mode };
}

export function normalizeElectronMainCjsSource(source) {
	let changed = false;
	const lineBreak = source.includes("\r\n") ? "\r\n" : "\n";
	const lines = source.split(/\r?\n/);
	const normalizedLines = [];
	let state = { mode: null };

	for (const line of lines) {
		if (state.mode === null) {
			const converted = convertImportLine(line);
			if (converted !== null) {
				normalizedLines.push(converted);
				changed = true;
				continue;
			}
		}

		const normalizedLine = line.replace(
			/\bimport\.meta\.url\b/g,
			IMPORT_META_URL_CJS_REPLACEMENT,
		);
		if (normalizedLine !== line) {
			changed = true;
		}

		normalizedLines.push(normalizedLine);
		state = updateLexicalState(normalizedLine, state);
	}

	if (!changed) {
		return { source, changed };
	}

	const normalized = normalizedLines.join(lineBreak);

	return { source: normalized, changed };
}

export function findElectronMainCjsEsmSyntax(source) {
	const lines = source.split(/\r?\n/);
	const matches = [];
	let state = { mode: null };

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (state.mode === null) {
			const converted = convertImportLine(line);
			if (converted !== null) {
				matches.push({
					line: index + 1,
					text: line.trim(),
				});
				continue;
			}
			if (/\bimport\.meta\b/.test(line)) {
				matches.push({
					line: index + 1,
					text: line.trim(),
				});
				continue;
			}
		}

		state = updateLexicalState(line, state);
	}

	return matches;
}

export async function normalizeElectronMainCjs(bundleUrl = mainBundleUrl) {
	let source;
	try {
		source = await fs.readFile(bundleUrl, "utf8");
	} catch (error) {
		throw new Error(`Unable to read dist-electron/main.cjs: ${error}`);
	}

	const normalized = normalizeElectronMainCjsSource(source);
	if (normalized.changed) {
		await fs.writeFile(bundleUrl, normalized.source, "utf8");
	}

	return normalized;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
	const result = await normalizeElectronMainCjs();
	const remainingImports = findElectronMainCjsEsmSyntax(result.source);
	if (remainingImports.length > 0) {
		const details = remainingImports
			.map((match) => `line ${match.line}: ${match.text}`)
			.join("\n");
		throw new Error(`dist-electron/main.cjs still contains ESM import syntax:\n${details}`);
	}

	console.log(
		result.changed
			? "Electron main CJS normalized: dist-electron/main.cjs"
			: "Electron main CJS already normalized: dist-electron/main.cjs",
	);
}
