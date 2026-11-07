import { afterEach, expect, it, vi } from "vitest";
import { isSupportErrorReport } from "../../../services/supabase/functions/_shared/appErrorReport";
import { feedbackDiagnostics } from "../feedback/diagnostics";
import { buildErrorReport } from "../feedback/errorReporting";
import { captureAuthFailure, describeAuthFailure, traceAuthOperation } from "./authDiagnostics";

afterEach(() => vi.unstubAllGlobals());

it("keeps the original SDK failure and callback stage in a valid redacted support report", async () => {
	vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "test" });
	const original = Object.assign(
		new Error("Expired for person@example.test code_verifier=private-verifier"),
		{
			name: "AuthApiError",
			code: "flow_state_expired",
			status: 400,
			access_token: "must-not-serialize",
			request: { password: "must-not-serialize" },
		},
	);
	await expect(
		traceAuthOperation("callback-token-exchange", async () => {
			throw original;
		}),
	).rejects.toBe(original);
	const report = await buildErrorReport(
		captureAuthFailure("callback-delivery", original),
		"sign-in",
	);
	expect(isSupportErrorReport(report)).toBe(true);
	expect(report.error).toContain("AuthApiError");
	expect(report.error).toContain("flow_state_expired");
	expect(report.error).toContain("status: 400");
	const logs = JSON.parse(report.logs).logs.join("\n");
	expect(logs).toContain("[auth] callback-token-exchange: started");
	expect(logs).toContain("[auth] callback-token-exchange: failed");
	for (const secret of ["person@example.test", "private-verifier", "must-not-serialize"])
		expect(JSON.stringify(report)).not.toContain(secret);
});

it("records successful stages so a later failure can be located after the token exchange", async () => {
	vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "test" });
	await expect(traceAuthOperation("callback-token-exchange", async () => "ok")).resolves.toBe(
		"ok",
	);
	const logs = JSON.parse(feedbackDiagnostics()).logs.join("\n");
	expect(logs).toContain("[auth] callback-token-exchange: succeeded");
});

it("does not replace the original failure when a thrown object has an inaccessible property", async () => {
	const original = Object.defineProperty({}, "message", {
		get() {
			throw new Error("Getter failed");
		},
	});
	await expect(
		traceAuthOperation("callback-completion", async () => {
			throw original;
		}),
	).rejects.toBe(original);
	expect(describeAuthFailure("callback-completion", original)).toContain(
		"Error details unavailable",
	);
});

it("includes the SDK's originalError without serializing unrelated nested data", () => {
	const diagnostic = describeAuthFailure("callback-completion", {
		name: "AuthUnknownError",
		message: "Unexpected failure",
		originalError: {
			name: "TypeError",
			message: "Session write failed",
			session: "private-session",
		},
	});
	expect(diagnostic).toContain("TypeError");
	expect(diagnostic).toContain("Session write failed");
	expect(diagnostic).not.toContain("private-session");
});

it("retains bounded causal errors and strips private stack paths and callback codes", () => {
	const cause = Object.assign(new Error("recordly://auth/callback?code=private-oauth-code"), {
		stack: "Error\n at sessionSave (/Users/someone/private.ts:4)",
	});
	const error = new Error("Storage write failed", { cause });
	const diagnostic = describeAuthFailure("callback-completion", error);
	expect(diagnostic).toContain("Storage write failed");
	expect(diagnostic).toContain("Caused by:");
	expect(diagnostic).toContain("[auth callback]");
	expect(diagnostic).not.toContain("private-oauth-code");
	expect(diagnostic).not.toContain("someone");
	expect(
		describeAuthFailure("callback-completion", "x".repeat(10000)).length,
	).toBeLessThanOrEqual(2000);
});

it("retains nested SDK causes before long outer messages and stacks exhaust the report budget", () => {
	const error = {
		name: "AuthUnknownError",
		message: `Outer storage failure ${"x".repeat(5000)}`,
		stack: `Error\n${" at save (/Users/private/account.ts:4)\n".repeat(1000)}`,
		cause: {
			name: "AuthApiError",
			code: "flow_state_expired",
			status: 400,
			message: "SDK cause person@example.test token=private-token",
			stack: "at https://auth.example.test/callback?code=private-code",
			cause: {
				name: "TypeError",
				message: "Final storage cause code_verifier=private-verifier",
				access_token: "must-not-serialize",
			},
		},
	};
	const diagnostic = describeAuthFailure("callback-completion", error);
	expect(diagnostic.length).toBeLessThanOrEqual(2000);
	for (const detail of ["AuthUnknownError", "AuthApiError", "flow_state_expired", "status: 400", "Final storage cause"])
		expect(diagnostic).toContain(detail);
	expect(diagnostic.indexOf("Final storage cause")).toBeLessThan(diagnostic.indexOf("stack:"));
	for (const secret of ["person@example.test", "private-token", "private-code", "private-verifier", "must-not-serialize", "/Users/private"])
		expect(diagnostic).not.toContain(secret);
});
