import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { feedbackHandler } from "./handler.ts";

const client = createClient(
	Deno.env.get("SUPABASE_URL")!,
	Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
	{
		auth: { persistSession: false, autoRefreshToken: false },
	},
);
Deno.serve(
	feedbackHandler({
		async authenticate(token) {
			const { data, error } = await client.auth.getUser(token);
			return error ? null : (data.user?.id ?? null);
		},
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
			const { error } = await client.storage
				.from("feedback-attachments")
				.upload(path, file, { contentType: "application/octet-stream", upsert: false });
			if (error) throw error;
		},
		async insert(report) {
			const { error } = await client.from("feedback_reports").insert(report);
			if (error) throw error;
		},
		async remove(paths) {
			const { error } = await client.storage.from("feedback-attachments").remove(paths);
			if (error) throw error;
		},
	}),
);
