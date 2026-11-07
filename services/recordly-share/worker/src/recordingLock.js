import { errorResponse } from "./http.js";

// Serialize owner moderation for a recording across Worker isolates. A crash
// leaves a lock rather than admitting a second writer. See the README maintenance
// procedure: lock age alone is never proof that the previous action has ended.
export async function withRecordingLock(env, code, action) {
	const token = crypto.randomUUID();
	const result = await env.DB.prepare(
		"INSERT OR IGNORE INTO recording_locks (share_code, token) VALUES (?, ?)",
	)
		.bind(code, token)
		.run();
	if (!result.meta.changes) return errorResponse("Recording is busy. Try again shortly.", 409);
	try {
		return await action();
	} finally {
		await env.DB.prepare("DELETE FROM recording_locks WHERE share_code = ? AND token = ?")
			.bind(code, token)
			.run();
	}
}
