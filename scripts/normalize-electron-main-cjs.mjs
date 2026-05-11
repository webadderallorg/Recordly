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

function convertNamedExports(namedSpec, indent = "") {
	const statements = [];
	for (const rawSpecifier of namedSpec.split(",")) {
		const specifier = rawSpecifier.trim();
		if (!specifier) {
			continue;
		}

		const aliasMatch = specifier.match(
			/^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/,
		);
		const localName = aliasMatch ? aliasMatch[1] : specifier;
		const exportName = aliasMatch ? aliasMatch[2] : specifier;
		if (
			!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(localName) ||
			!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName)
		) {
			return null;
		}

		statements.push(`${indent}exports.${exportName} = ${localName};`);
	}

	return statements;
}

function convertExportLine(line) {
	const singleLineMatch = line.match(
		/^([ \t]*)export\s*\{\s*([^}]*)\s*\}\s*;?[ \t]*$/,
	);
	if (singleLineMatch) {
		const [, indent, namedSpec] = singleLineMatch;
		return convertNamedExports(namedSpec, indent);
	}

	const blockStartMatch = line.match(/^([ \t]*)export\s*\{\s*$/);
	if (blockStartMatch) {
		return { indent: blockStartMatch[1], specifiers: [], rawLines: [line] };
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

function hasTokenBoundary(line, startIndex, endIndex) {
	const before = line[startIndex - 1];
	const after = line[endIndex];
	const isIdentifier = (char) => Boolean(char && /[A-Za-z0-9_$]/.test(char));
	return !isIdentifier(before) && !isIdentifier(after);
}

function replaceImportMetaUrlInCode(line, state) {
	const token = "import.meta.url";
	let mode = state.mode;
	let escaped = false;
	let changed = false;
	let normalizedLine = "";

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		const next = line[index + 1];

		if (mode === "block-comment") {
			normalizedLine += char;
			if (char === "*" && next === "/") {
				normalizedLine += next;
				mode = null;
				index += 1;
			}
			continue;
		}

		if (mode === "single-quote" || mode === "double-quote" || mode === "template") {
			normalizedLine += char;
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
			normalizedLine += line.slice(index);
			break;
		}

		if (char === "/" && next === "*") {
			normalizedLine += char + next;
			mode = "block-comment";
			index += 1;
			continue;
		}

		if (char === "'") {
			normalizedLine += char;
			mode = "single-quote";
			continue;
		}

		if (char === '"') {
			normalizedLine += char;
			mode = "double-quote";
			continue;
		}

		if (char === "`") {
			normalizedLine += char;
			mode = "template";
			continue;
		}

		if (
			line.startsWith(token, index) &&
			hasTokenBoundary(line, index, index + token.length)
		) {
			normalizedLine += IMPORT_META_URL_CJS_REPLACEMENT;
			changed = true;
			index += token.length - 1;
			continue;
		}

		normalizedLine += char;
	}

	if (mode === "single-quote" || mode === "double-quote") {
		mode = null;
	}

	return {
		line: normalizedLine,
		state: { mode },
		changed,
	};
}

function containsImportMetaInCode(line, state) {
	const token = "import.meta";
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
			continue;
		}

		if (char === '"') {
			mode = "double-quote";
			continue;
		}

		if (char === "`") {
			mode = "template";
			continue;
		}

		if (
			line.startsWith(token, index) &&
			hasTokenBoundary(line, index, index + token.length)
		) {
			return true;
		}
	}

	return false;
}

export function normalizeElectronMainCjsSource(source) {
	let changed = false;
	const lineBreak = source.includes("\r\n") ? "\r\n" : "\n";
	const lines = source.split(/\r?\n/);
	const normalizedLines = [];
	let state = { mode: null };
	let exportBlock = null;

	for (const line of lines) {
		if (exportBlock) {
			if (/^[ \t]*\}\s*;?[ \t]*$/.test(line)) {
				const statements = convertNamedExports(
					exportBlock.specifiers.join(","),
					exportBlock.indent,
				);
				if (statements === null) {
					normalizedLines.push(...exportBlock.rawLines, line);
				} else {
					normalizedLines.push(...statements);
					changed = true;
				}
				exportBlock = null;
				continue;
			}

			exportBlock.specifiers.push(line.trim().replace(/,$/, ""));
			exportBlock.rawLines.push(line);
			continue;
		}

		if (state.mode === null) {
			const converted = convertImportLine(line);
			if (converted !== null) {
				normalizedLines.push(converted);
				changed = true;
				continue;
			}

			const convertedExport = convertExportLine(line);
			if (convertedExport !== null) {
				if (Array.isArray(convertedExport)) {
					normalizedLines.push(...convertedExport);
					changed = true;
				} else {
					exportBlock = convertedExport;
				}
				continue;
			}
		}

		const normalized = replaceImportMetaUrlInCode(line, state);
		if (normalized.changed) {
			changed = true;
		}

		normalizedLines.push(normalized.line);
		state = normalized.state;
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
			if (containsImportMetaInCode(line, state)) {
				matches.push({
					line: index + 1,
					text: line.trim(),
				});
				continue;
			}
			if (/^[ \t]*export\b/.test(line)) {
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
