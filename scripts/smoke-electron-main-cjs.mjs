import fs from "node:fs/promises";

const mainBundleUrl = new URL("../dist-electron/main.cjs", import.meta.url);
const mainBundlePath = mainBundleUrl.pathname;

let source;
try {
	source = await fs.readFile(mainBundleUrl, "utf8");
} catch (error) {
	throw new Error(`Unable to read dist-electron/main.cjs: ${error}`);
}

const esmImportPattern = /^[ \t]*import\s+(?:(?:[\w*{][^\n;]*?)\s+from\s+)?["'][^"']+["'];?/gm;
const matches = [...source.matchAll(esmImportPattern)].map((match) => ({
	line: source.slice(0, match.index).split(/\r?\n/).length,
	text: match[0].trim(),
}));

if (matches.length > 0) {
	const details = matches.map((match) => `line ${match.line}: ${match.text}`).join("\n");
	throw new Error(`dist-electron/main.cjs contains ESM import syntax:\n${details}`);
}

if (/\bimport\.meta\b/.test(source)) {
	throw new Error("dist-electron/main.cjs contains import.meta syntax");
}

console.log(`Electron main CJS smoke passed: ${mainBundlePath}`);
