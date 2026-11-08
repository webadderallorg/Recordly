import {
	type AppLocale,
	DEFAULT_LOCALE,
	I18N_NAMESPACES,
	type I18nNamespace,
	SUPPORTED_LOCALES,
} from "./config";

type MessageObject = Record<string, unknown>;
type LocaleBundle = Partial<Record<I18nNamespace, MessageObject>>;

const catalogs = import.meta.glob<MessageObject>("./locales/*/*.json", {
	eager: true,
	import: "default",
});
const messages = Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, {}])) as Record<
	AppLocale,
	LocaleBundle
>;
for (const [file, catalog] of Object.entries(catalogs)) {
	const [, locale, namespace] = file.match(/\/locales\/([^/]+)\/([^/]+)\.json$/) ?? [];
	if (
		SUPPORTED_LOCALES.includes(locale as AppLocale) &&
		I18N_NAMESPACES.includes(namespace as I18nNamespace)
	) {
		messages[locale as AppLocale][namespace as I18nNamespace] = catalog;
	}
}

export function getMessageValue(source: unknown, key: string): string | undefined {
	let current: unknown = source;
	for (const part of key.split(".")) {
		if (
			!current ||
			typeof current !== "object" ||
			!Object.getOwnPropertyDescriptor(current, part)
		)
			return undefined;
		current = (current as MessageObject)[part];
	}
	return typeof current === "string" ? current : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
	return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
		const value = vars?.[key];
		// Keep a missing token visible instead of silently removing meaningful text.
		return value === undefined ? match : String(value);
	});
}

export function translateForLocale(
	locale: AppLocale,
	key: string,
	fallback?: string,
	vars?: Record<string, string | number>,
): string {
	const [first, ...rest] = key.split(".");
	const namespace =
		I18N_NAMESPACES.includes(first as I18nNamespace) && rest.length
			? (first as I18nNamespace)
			: "common";
	const path = namespace === first ? rest.join(".") : key;
	const lookup = (candidateLocale: AppLocale) => {
		const source = messages[candidateLocale][namespace];
		if (typeof vars?.count === "number") {
			const category = new Intl.PluralRules(candidateLocale).select(vars.count);
			const plural =
				getMessageValue(source, `${path}_${category}`) ??
				getMessageValue(source, `${path}_other`);
			if (plural !== undefined) return plural;
		}
		return getMessageValue(source, path);
	};
	return interpolate(lookup(locale) ?? lookup(DEFAULT_LOCALE) ?? fallback ?? key, vars);
}
