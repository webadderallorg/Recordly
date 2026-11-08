import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { auditSourceKeys } from "./i18n-source-check.mjs";

const root = process.cwd();
const localesDir = path.join(root, "src/i18n/locales");
const source = ts.createSourceFile(
	"config.ts",
	fs.readFileSync(path.join(root, "src/i18n/config.ts"), "utf8"),
	ts.ScriptTarget.Latest,
	true,
);
const arrays = {};
function readConfig(node) {
	if (ts.isVariableDeclaration(node) && node.initializer) {
		const value = ts.isAsExpression(node.initializer)
			? node.initializer.expression
			: node.initializer;
		if (ts.isArrayLiteralExpression(value))
			arrays[node.name.getText(source)] = value.elements.map((entry) => entry.text);
	}
	ts.forEachChild(node, readConfig);
}
readConfig(source);
const locales = arrays.SUPPORTED_LOCALES;
const namespaces = arrays.I18N_NAMESPACES;
if (!locales?.includes("en") || !namespaces?.length)
	throw Error("i18n-check: invalid runtime locale configuration");

function flatten(object, prefix = "", result = {}) {
	for (const [key, value] of Object.entries(object)) {
		const name = prefix ? `${prefix}.${key}` : key;
		if (value && typeof value === "object" && !Array.isArray(value))
			flatten(value, name, result);
		else result[name] = value;
	}
	return result;
}
function tokens(value) {
	return [...value.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)]
		.map((match) => match[1])
		.sort()
		.join(",");
}
let errors = 0;
const report = (message) => {
	console.error(`i18n-check: ${message}`);
	errors++;
};
const baseCatalogs = {};
for (const namespace of namespaces) {
	const load = (locale) => {
		const file = path.join(localesDir, locale, `${namespace}.json`);
		try {
			return flatten(JSON.parse(fs.readFileSync(file, "utf8")));
		} catch (error) {
			report(`cannot load ${locale}/${namespace}.json: ${error.message}`);
			return {};
		}
	};
	const base = load("en");
	baseCatalogs[namespace] = JSON.parse(
		fs.readFileSync(path.join(localesDir, "en", `${namespace}.json`), "utf8"),
	);
	for (const locale of locales) {
		const data = locale === "en" ? base : load(locale);
		for (const [key, value] of Object.entries(base)) {
			const translated = data[key];
			if (translated === undefined) {
				report(`missing key ${locale}/${namespace}.json:${key}`);
				continue;
			}
			if (typeof translated !== "string" || !translated.trim()) {
				report(`empty or non-string value ${locale}/${namespace}.json:${key}`);
				continue;
			}
			if (typeof value === "string" && tokens(value) !== tokens(translated))
				report(`placeholder mismatch ${locale}/${namespace}.json:${key}`);
			if (
				locale !== "en" &&
				value === translated &&
				value.trim().split(/\s+/).length >= 5 &&
				/[A-Za-z]/.test(value)
			)
				report(`untranslated English sentence ${locale}/${namespace}.json:${key}`);
		}
		for (const key of Object.keys(data)) {
			if (!Object.hasOwn(base, key)) report(`extra key ${locale}/${namespace}.json:${key}`);
		}
	}
}
const sourceAudit = auditSourceKeys(baseCatalogs);
for (const missing of sourceAudit.missing)
	report(`source key missing ${missing.file}:${missing.line} ${missing.key}`);
if (errors) process.exit(1);
console.log(
	`i18n-check: ${locales.length} supported languages × ${namespaces.length} namespaces have complete keys, nonempty strings and matching placeholders; ${sourceAudit.translatorCalls} source calls checked, no untranslated English sentences`,
);
