import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { feedbackHandler, feedbackJson } from "./handler.ts";
import { sendFeedbackNotification } from "./notification.ts";
import { FEEDBACK_BUCKET, feedbackUploads, storageTus } from "./uploads.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const client = createClient(supabaseUrl, serviceKey, {
	auth: { persistSession: false, autoRefreshToken: false },
});
const bucket = client.storage.from(FEEDBACK_BUCKET);
async function authenticate(token: string) {
	const { data, error } = await client.auth.getUser(token);
	return error ? null : (data.user?.id ?? null);
}
async function notify(id: string) {
	const { data, error } = await client.rpc("take_feedback_notification");
	if (error) throw error;
	if (data === true) await sendFeedbackNotification(id, Deno.env.get("FEEDBACK_RESEND_API_KEY"));
}
const legacy = feedbackHandler({
	authenticate,
	async reserve(userId, files, bytes) {
		const { data, error } = await client.rpc("reserve_feedback_quota", {
			account_id: userId,
			file_count: files,
			byte_count: bytes,
		});
		if (error) throw error;
		return data === true;
	},
	async upload(path, file) {
		const { error } = await bucket.upload(path, file, {
			contentType: "application/octet-stream",
			upsert: false,
		});
		if (error) throw error;
	},
	async insert(report) {
		const { error } = await client.from("feedback_reports").insert(report);
		if (error) throw error;
	},
	async remove(paths) {
		const { error } = await bucket.remove(paths);
		if (error) throw error;
	},
	notify,
});
const uploads = feedbackUploads({
	...storageTus(supabaseUrl, serviceKey),
	authenticate,
	notify,
	async prepare(user, id, files) {
		const { data, error } = await client.rpc("prepare_feedback_upload", {
			account_id: user,
			report_id: id,
			manifest: files,
		});
		if (error) throw error;
		return data;
	},
	async find(user, id) {
		const { data, error } = await client
			.from("feedback_uploads")
			.select("files, urls")
			.eq("id", id)
			.eq("user_id", user)
			.eq("finalized", false)
			.gt("expires_at", new Date().toISOString())
			.maybeSingle();
		if (error) throw error;
		return data;
	},
	async saveUrl(user, id, slot, url) {
		const { data, error } = await client.rpc("set_feedback_upload_url", {
			account_id: user,
			report_id: id,
			slot,
			candidate: url,
		});
		if (error) throw error;
		return data;
	},
	async finish(user, id, payload) {
		const { data, error } = await client.rpc("finish_feedback_upload", {
			account_id: user,
			report_id: id,
			payload,
		});
		if (error) throw error;
		return data;
	},
});

Deno.serve(async (request) => {
	const url = new URL(request.url);
	if (request.method === "OPTIONS") return legacy(request);
	if (url.searchParams.get("upload") === "cleanup") {
		const secret = Deno.env.get("FEEDBACK_CLEANUP_SECRET");
		if (
			request.method !== "POST" ||
			!secret ||
			request.headers.get("Authorization") !== `Bearer ${secret}`
		)
			return feedbackJson(401, { code: "UNAUTHORIZED" });
		const expired = await client.rpc("expired_feedback_objects");
		if (expired.error) {
			console.error("Feedback cleanup could not list files", expired.error.message);
			return feedbackJson(500, { code: "CLEANUP_FAILED" });
		}
		const paths = (expired.data as { path: string }[]).map(({ path }) => path);
		if (paths.length > 0) {
			const { error } = await bucket.remove(paths);
			if (error) {
				console.error("Feedback cleanup could not remove files", error.message);
				return feedbackJson(500, { code: "CLEANUP_FAILED" });
			}
		}
		return feedbackJson(200, { success: true, removed: paths.length });
	}
	return url.searchParams.has("upload") ? uploads(request, url) : legacy(request);
});
