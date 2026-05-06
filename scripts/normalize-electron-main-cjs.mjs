import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const mainBundleUrl = new URL("../dist-electron/main.cjs", import.meta.url);

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

	const sideEffectImportMatch = line.match(
		/^([ \t]*)import\s+(["'][^"']+["'])\s*;?[ \t]*$/,
	);
	if (sideEffectImportMatch) {
		const [, indent, moduleLiteral] = sideEffectImportMatch;
		return `${indent}require(${moduleLiteral});`;
	}

	if (/^[ \t]*export\s*\{\s*\}\s*;?[ \t]*$/.test(line)) {
		return "";
	}

	return null;
}

export function normalizeElectronMainCjsSource(source) {
	let changed = false;
	const lineBreak = source.includes("\r\n") ? "\r\n" : "\n";
	const lines = source.split(/\r?\n/);
	const normalizedLines = [];
	let firstUnprocessedLine = 0;

	for (const line of lines) {
		if (/^[ \t]*$/.test(line)) {
			normalizedLines.push(line);
			firstUnprocessedLine += 1;
			continue;
		}

		const converted = convertImportLine(line);
		if (converted === null) {
			break;
		}

		normalizedLines.push(converted);
		firstUnprocessedLine += 1;
		changed = true;
	}

	if (!changed) {
		return { source, changed };
	}

	const normalized = [
		...normalizedLines,
		...lines.slice(firstUnprocessedLine),
	].join(lineBreak);

	return { source: normalized, changed };
}

export function findElectronMainCjsEsmSyntax(source) {
	const lines = source.split(/\r?\n/);
	const matches = [];

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (/^[ \t]*$/.test(line)) {
			continue;
		}

		const converted = convertImportLine(line);
		if (converted === null) {
			break;
		}

		matches.push({
			line: index + 1,
			text: line.trim(),
		});
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

const isDirectRun =
	process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

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
