import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditSourceKeys } from "../../scripts/i18n-source-check.mjs";

describe("source translation coverage guard", () => {
	it("finds missing keys even with English fallbacks, scoped aliases and passed translators", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recordly-i18n-check-"));
		try {
			fs.writeFileSync(
				path.join(directory, "controls.tsx"),
				`
import { useI18n as useLocale, useScopedT as useText, translate as text } from "./I18nContext";
function Controls() {
 const { t: label } = useLocale();
 const editorText = useText("editor");
 label("actions.cancel"); editorText("missing", "English fallback");
 text("common.missing", "Also missing"); helper(editorText);
}
function helper(t) { t("alsoMissing", "Fallback"); }
function Passed({t}) { t("editor.fromProps", "Fallback"); }
function Indirect(props) { const {t} = props; t("editor.indirect", "Fallback"); }
function Property(input) { input.t("editor.property", "Fallback"); }
`,
			);
			const result = auditSourceKeys(
				{ common: { actions: { cancel: "Cancel" } }, editor: {} },
				directory,
			);
			expect(result.missing.map((entry: { key: string }) => entry.key).sort()).toEqual([
				"common.missing",
				"editor.alsoMissing",
				"editor.fromProps",
				"editor.indirect",
				"editor.missing",
				"editor.property",
			]);
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});
	it("recognizes plural families without requiring a redundant base key", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recordly-i18n-plural-"));
		try {
			fs.writeFileSync(
				path.join(directory, "counts.ts"),
				`import { translate } from "./I18nContext"; translate("ui.count", undefined, {count: 2});`,
			);
			expect(
				auditSourceKeys(
					{ common: {}, ui: { count_one: "one", count_other: "many" } },
					directory,
				).missing,
			).toEqual([]);
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});
});
