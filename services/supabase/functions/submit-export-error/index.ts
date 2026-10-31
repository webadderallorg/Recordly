import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { exportErrorHandler } from "./handler.ts";
const client = createClient(
	Deno.env.get("SUPABASE_URL")!,
	Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
	{
		auth: { persistSession: false, autoRefreshToken: false },
	},
);
Deno.serve(
	exportErrorHandler({
		async reserve() {
			const { data, error } = await client.rpc("reserve_export_error_quota");
			if (error) throw error;
			return data === true;
		},
		async insert(report) {
			const { error } = await client
				.from("export_error_reports")
				.insert({ cloud_plan: report.cloudPlan, diagnostics: report });
			if (error) throw error;
		},
	}),
);
