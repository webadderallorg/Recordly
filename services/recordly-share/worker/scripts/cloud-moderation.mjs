import path from "node:path";
import { fileURLToPath } from "node:url";

const READS = new Set(["reports", "stats"]);
const MUTATIONS = new Set([
	"suspend-account",
	"restore-account",
	"block-recording",
	"restore-recording",
]);
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`;

export function moderationSql(action, target, reason = "") {
	if (action === "reports")
		return `SELECT id, share_code, reason, details, created_at FROM abuse_reports ORDER BY id DESC LIMIT 100;`;
	if (action === "stats")
		return `SELECT 'pending_uploads' AS metric, COUNT(*) AS value FROM videos WHERE owner_id IS NOT NULL AND upload_completed = 0
 UNION ALL SELECT 'admitted_uploads_today', COUNT(*) FROM upload_admissions WHERE created_at >= datetime('now','start of day')
 UNION ALL SELECT 'admitted_bytes_today', COALESCE(SUM(reserved_bytes),0) FROM upload_admissions WHERE created_at >= datetime('now','start of day')
 UNION ALL SELECT 'reports_last_hour', COUNT(*) FROM abuse_reports WHERE created_at > datetime('now','-1 hour')
 UNION ALL SELECT 'suspended_accounts', COUNT(*) FROM account_restrictions WHERE suspended = 1;`;
	if (!MUTATIONS.has(action)) throw new Error("Unknown moderation action");
	if (typeof target !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(target))
		throw new Error("Provide an exact account ID or recording code");
	if (typeof reason !== "string" || !reason.trim() || reason.length > 500)
		throw new Error("Provide a reason of 1–500 characters for the audit trail");
	const id = sqlString(target);
	const note = sqlString(reason.trim());
	// A database trigger applies the restriction in the same statement as its audit
	// entry. Query execution never needs D1's disruptive bulk-import path.
	return `INSERT INTO moderation_actions (action,target,reason) VALUES (${sqlString(action)},${id},${note});`;
}

export function wranglerArguments(database, config, remote, sql) {
	return [
		"d1",
		"execute",
		database,
		"--config",
		path.resolve(config),
		remote ? "--remote" : "--local",
		"--command",
		sql,
		"--json",
	];
}

export async function main(argv) {
	const { spawnSync } = await import("node:child_process");
	const [action, ...args] = argv;
	const value = (flag) => args[args.indexOf(flag) + 1];
	const hasValue = (flag) =>
		args.includes(flag) && typeof value(flag) === "string" && !value(flag).startsWith("--");
	if (
		(!READS.has(action) && !MUTATIONS.has(action)) ||
		!hasValue("--config") ||
		!hasValue("--database")
	)
		throw new Error(
			"Usage: node scripts/cloud-moderation.mjs reports|stats|suspend-account|restore-account|block-recording|restore-recording --config PATH --database NAME [--remote] [--target ID --reason TEXT --confirm]",
		);
	if (MUTATIONS.has(action) && !args.includes("--confirm"))
		throw new Error(
			"Review the target and reason, then pass --confirm for a moderation mutation",
		);
	const sql = moderationSql(
		action,
		hasValue("--target") ? value("--target") : undefined,
		hasValue("--reason") ? value("--reason") : "",
	);
	const workerRoot = fileURLToPath(new URL("../", import.meta.url));
	const result = spawnSync(
		path.join(workerRoot, "node_modules/.bin/wrangler"),
		wranglerArguments(value("--database"), value("--config"), args.includes("--remote"), sql),
		{ cwd: workerRoot, stdio: "inherit" },
	);
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error("Moderation command failed; inspect the provider output before retrying");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		await main(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
