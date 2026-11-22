import { describe, expect, it } from "vitest";
// @ts-expect-error This release helper is plain JavaScript.
import { releaseCloudConfigErrors } from "../scripts/check-release-cloud-config.mjs";

const valid = {
	VITE_CLOUD_SHARE_ENDPOINT: "https://videos.recordly.dev/api/upload",
	VITE_SUPABASE_URL: "https://project.supabase.co",
	VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"a".repeat(24)}`,
};

describe("production release cloud configuration", () => {
	it("accepts explicit public production settings", () => {
		expect(releaseCloudConfigErrors(valid)).toEqual([]);
	});
	it.each([
		"",
		"http://localhost:8787/api/upload",
		"https://recordly-share-staging.youngchen3442.workers.dev/api/upload",
		"https://videos.recordly.dev.evil.test/api/upload",
		"https://videos.recordly.dev/api/upload?token=private",
		"https://user:secret@videos.recordly.dev/api/upload",
	])("rejects a missing, staging or unsafe endpoint: %s", (endpoint) => {
		expect(
			releaseCloudConfigErrors({ ...valid, VITE_CLOUD_SHARE_ENDPOINT: endpoint }),
		).not.toEqual([]);
	});
	it("rejects missing and secret auth keys without printing their values", () => {
		for (const key of [
			"",
			"sb_secret_do-not-print",
			"sb_publishable_YOUR_KEY",
			jwt("service_role"),
		]) {
			const errors = releaseCloudConfigErrors({
				...valid,
				VITE_SUPABASE_PUBLISHABLE_KEY: key,
			});
			expect(errors.length).toBeGreaterThan(0);
			if (key) expect(errors.join()).not.toContain(key);
		}
	});
	it("supports existing anon keys", () => {
		expect(
			releaseCloudConfigErrors({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: jwt("anon") }),
		).toEqual([]);
	});
	it.each([
		"http://localhost:54321",
		"https://YOUR_PROJECT_REF.supabase.co",
		"https://auth.test/path",
	])("rejects invalid production auth configuration: %s", (url) => {
		expect(releaseCloudConfigErrors({ ...valid, VITE_SUPABASE_URL: url })).not.toEqual([]);
	});
});

function jwt(role: string) {
	return `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
}
