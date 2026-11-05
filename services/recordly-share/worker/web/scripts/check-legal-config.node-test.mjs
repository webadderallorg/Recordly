import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const cwd = mkdtempSync(join(tmpdir(), "recordly-legal-check-"));
after(() => rmSync(cwd, { recursive: true, force: true }));
const script = fileURLToPath(new URL("./check-legal-config.mjs", import.meta.url));
const base = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !key.startsWith("PUBLIC_LEGAL_")),
);
const reviewed = {
	PUBLIC_LEGAL_SUPPORT_EMAIL: "support@recordly.dev",
	PUBLIC_LEGAL_PROCESSING_LOCATIONS: "Australia and international provider locations",
	PUBLIC_LEGAL_EFFECTIVE_DATE: "2026-10-19",
	PUBLIC_LEGAL_APPROVED: "true",
};
const run = (fields) =>
	spawnSync(process.execPath, [script], { cwd, env: { ...base, ...fields }, encoding: "utf8" });
test("unreviewed drafts cannot pass the publication check", () => {
	assert.equal(run({ ...reviewed, PUBLIC_LEGAL_APPROVED: "false" }).status, 1);
});
test("publication requires real contact and processing details", () => {
	for (const fields of [
		{ PUBLIC_LEGAL_SUPPORT_EMAIL: "invalid" },
		{ PUBLIC_LEGAL_PROCESSING_LOCATIONS: "" },
		{ PUBLIC_LEGAL_PROCESSING_LOCATIONS: "TBD" },
	]) {
		assert.equal(run({ ...reviewed, ...fields }).status, 1);
	}
});
test("reviewed publication config does not require a public personal name", () => {
	const result = run(reviewed);
	assert.equal(result.status, 0, result.stderr);
});
