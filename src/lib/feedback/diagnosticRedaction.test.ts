import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { redactDiagnostic } from "./diagnosticRedaction";

describe("diagnostic token and email privacy", () => {
	it.each([
		["eyJpayload.signature.payload", "[token]"],
		["prefix-eyJpayload.signature.payload---", "prefix-[token]---"],
		["prefix_eyJpayload.signature.payload", "prefix_eyJpayload.signature.payload"],
		["eyJ-a.b.c eyJd.e.f", "[token] [token]"],
		["a.eyJpayload.signature.payload", "a.[token]"],
		["eyJpayload.signature.---", "eyJpayload.signature.---"],
		["eyJ.signature.payload", "eyJ.signature.payload"],
		["eyJpayload..signature.payload", "eyJpayload..signature.payload"],
		["person+private@example.com", "[email]"],
		["prefix-person@example.com", "[email]"],
		["x@........ invalid@host", "x@........ invalid@host"],
	])("preserves established redaction for %s", (input, expected) => {
		expect(redactDiagnostic(input)).toBe(expected);
	});

	it("redacts complete secrets crossing the eventual output limit", () => {
		const input = " ".repeat(1990) + "eyJ" + "a".repeat(8000) + ".signature.payload";
		const result = redactDiagnostic(input);
		expect(result).not.toContain("eyJ");
		expect(result.trim()).toBe("[token]");
		expect(result.length).toBeLessThanOrEqual(2000);
		expect(redactDiagnostic("a".repeat(8000) + "@example.com")).toBe("[email]");
	});

	it("removes OAuth callbacks, verifiers and one-time codes while keeping API error codes", () => {
		const output = redactDiagnostic(
			"recordly-dev://auth/callback?code=oauth-private code_verifier=verifier-private code_challenge=challenge-private authorization_code=auth-private otp=123456 captcha=captcha-private code: flow_state_expired status: 400",
		);
		for (const secret of [
			"oauth-private",
			"verifier-private",
			"challenge-private",
			"auth-private",
			"123456",
			"captcha-private",
		])
			expect(output).not.toContain(secret);
		expect(output).toContain("code: flow_state_expired status: 400");
	});

	it("matches the prior JWT semantics across a deterministic mixed corpus", () => {
		let seed = 0x5eed1234;
		const atoms = ["eyJ", "eyJx", "x", "-", "_", ".", "a", "B", "9", " "];
		for (let sample = 0; sample < 1000; sample++) {
			let input = "";
			for (let i = 0; i < 64; i++) {
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
				input += atoms[seed % atoms.length];
			}
			const expected = input
				.replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[token]")
				.slice(0, 2000);
			expect(redactDiagnostic(input), input).toBe(expected);
		}
	});

	it("processes adversarial diagnostics within a generous isolated watchdog", () => {
		const modulePath = fileURLToPath(new URL("./diagnosticRedaction.ts", import.meta.url));
		const script = `
			import { redactDiagnostic } from ${JSON.stringify(pathToFileURL(modulePath).href)};
			import assert from 'node:assert/strict';
			for (const input of [
				'x'.repeat(256000),
				'eyJ-'.repeat(64000),
				'a.b.c.'.repeat(40000) + 'eyJpayload.signature.payload',
			]) assert.ok(redactDiagnostic(input).length <= 2000);
			assert.equal(redactDiagnostic('eyJ-'.repeat(64000) + 'payload.signature.payload'), '[token]');
			assert.equal(redactDiagnostic('a'.repeat(256000) + '@example.com'), '[email]');
			console.log('complete');
		`;
		// A separate process can actually interrupt a synchronous regex stall;
		// Vitest's timer cannot interrupt code blocking its own event loop.
		const result = spawnSync(
			process.execPath,
			["--experimental-strip-types", "--input-type=module", "-e", script],
			{
				timeout: 10000,
				encoding: "utf8",
			},
		);
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout.trim()).toBe("complete");
	}, 15000);
});
