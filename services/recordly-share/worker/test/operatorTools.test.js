import { env } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { moderationSql, wranglerArguments } from "../scripts/cloud-moderation.mjs";
import { ensureSchema } from "../src/schema.js";

beforeAll(() => ensureSchema(env));
it("suspends and restores accounts without changing retained media", async () => {
	const owner = crypto.randomUUID();
	const sql = moderationSql("suspend-account", owner, "Investigate user's report");
	for (const query of sql.split(";").filter((s) => s.trim())) await env.DB.prepare(query).run();
	expect((await env.DB.prepare("SELECT suspended, reason FROM account_restrictions WHERE owner_id = ?").bind(owner).first())).toEqual({ suspended: 1, reason: "Investigate user's report" });
	for (const query of moderationSql("restore-account", owner, "Reviewed").split(";").filter((s) => s.trim())) await env.DB.prepare(query).run();
	expect((await env.DB.prepare("SELECT suspended FROM account_restrictions WHERE owner_id = ?").bind(owner).first()).suspended).toBe(0);
	expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM moderation_actions WHERE target = ?").bind(owner).first()).n).toBe(2);
});
it("operator restoration preserves the owner's independent pause and feedback controls", async () => {
	const code = crypto.randomUUID().replaceAll("-", "");
	await env.DB.prepare("INSERT INTO videos (share_code,title,expires_at) VALUES (?,'Moderation test','2099-01-01')").bind(code).run();
	await env.DB.prepare("INSERT INTO recording_controls (share_code,sharing_disabled,feedback_disabled) VALUES (?,1,1)").bind(code).run();
	for (const action of ["block-recording", "restore-recording"]) {
		for (const query of moderationSql(action, code, "Review").split(";").filter((s) => s.trim())) await env.DB.prepare(query).run();
	}
	expect(await env.DB.prepare("SELECT sharing_disabled,feedback_disabled,operator_blocked FROM recording_controls WHERE share_code = ?").bind(code).first()).toEqual({ sharing_disabled: 1, feedback_disabled: 1, operator_blocked: 0 });
});
it("rejects unsafe operator inputs and supports bounded read-only reports/stats", () => {
	expect(() => moderationSql("suspend-account", "x';DELETE FROM videos;--", "Reason")).toThrow();
	expect(() => moderationSql("suspend-account", "owner", "")).toThrow();
	expect(moderationSql("reports")).toContain("LIMIT 100");
	expect(moderationSql("stats")).toContain("admitted_bytes_today");
	const command = wranglerArguments("DB", "wrangler.jsonc", true, moderationSql("reports"));
	expect(command).toContain("--command");
	expect(command).not.toContain("--file");
});

it("rolls back the audit entry when its moderation mutation fails", async () => {
	await env.DB.prepare("CREATE TRIGGER fail_suspension BEFORE INSERT ON account_restrictions WHEN NEW.owner_id = 'rollback-test' BEGIN SELECT RAISE(ABORT,'simulated failure'); END").run();
	try {
		await expect(env.DB.prepare(moderationSql("suspend-account", "rollback-test", "Test rollback")).run()).rejects.toThrow();
		expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM moderation_actions WHERE target = 'rollback-test'").first()).n).toBe(0);
	} finally {
		await env.DB.prepare("DROP TRIGGER fail_suspension").run();
	}
});

it("rejects missing recording targets without recording a successful action", async () => {
 const target = crypto.randomUUID().replaceAll("-", "");
 await expect(env.DB.prepare(moderationSql("block-recording", target, "Review")).run()).rejects.toThrow("Recording not found");
 expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM moderation_actions WHERE target = ?").bind(target).first()).n).toBe(0);
});
