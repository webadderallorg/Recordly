import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "./config";
import { translateForLocale } from "./messages";

const dynamicKeys = [
	...["fast", "balanced", "quality"].map((key) => `settings.export.encoding.${key}`),
	"settings.export.customWidth",
	"settings.export.customHeight",
	...["auto", "en", "es", "fr", "de", "it", "pt", "zh", "ja", "ko"].map(
		(key) => `editing.captionLanguage${key}`,
	),
	...["none", "fade", "rise", "pop"].map((key) => `editing.captionAnimation${key}`),
	...["n", "s", "e", "w", "nw", "ne", "sw", "se"].map((key) => `editing.crop${key}`),
	...["move", "nw", "ne", "sw", "se"].map((key) => `editing.webcamCrop${key}`),
	...["classic", "editor", "strong", "typewriter", "deco", "simple", "modern", "clean"].map(
		(key) => `editor.fontStyles.${key}`,
	),
	...["loving", "neutral", "angry"].map((key) => `common.feedback.${key}`),
];

describe("computed translation keys", () => {
	it.each(SUPPORTED_LOCALES)("resolves dynamic control labels in %s", (locale) => {
		for (const key of dynamicKeys) expect(translateForLocale(locale, key), key).not.toBe(key);
	});
});
