const RESEND_URL = "https://api.resend.com/emails";

export async function sendFeedbackNotification(
	reportId: string,
	apiKey: string | undefined,
	send: typeof fetch = fetch,
) {
	if (!apiKey?.trim()) throw new Error("FEEDBACK_RESEND_API_KEY is not configured");

	const headers = {
		Authorization: `Bearer ${apiKey.trim()}`,
		"Content-Type": "application/json",
		"Idempotency-Key": `recordly-feedback/${reportId}`,
	};
	const body = JSON.stringify({
		from: "Recordly Feedback <feedback@auth.recordly.dev>",
		to: ["support@recordly.dev"],
		subject: "New Recordly feedback",
		text: `New feedback was saved. Open public.feedback_reports in Supabase and look up report ${reportId}.`,
	});
	for (let attempt = 0; attempt < 2; attempt++) {
		let response: Response;
		try {
			response = await send(RESEND_URL, {
				method: "POST",
				headers,
				body,
				redirect: "error",
				signal: AbortSignal.timeout(2500),
			});
		} catch {
			if (attempt === 0) continue;
			throw new Error("Resend did not respond");
		}
		await response.body?.cancel().catch(() => undefined);
		if (response.ok) return;
		if (attempt === 0 && response.status >= 500) continue;
		throw new Error(`Resend returned HTTP ${response.status}`);
	}
}
