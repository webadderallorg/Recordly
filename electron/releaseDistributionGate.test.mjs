import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// js-yaml is included by the repository's existing Electron build toolchain.
const { load } = createRequire(import.meta.url)("js-yaml");
const workflow = load(
	readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
);

function matchingStep(steps, command) {
	return steps.findIndex((step) => step.run?.includes(command));
}

describe("macOS published distribution gate", () => {
	for (const arch of ["x64", "arm64"]) {
		it(`requires verified signing and notarization before ${arch} artifacts reach publication`, () => {
			const jobName = `build-macos-${arch}`;
			const job = workflow.jobs[jobName];
			const steps = job.steps;
			const build = matchingStep(steps, "electron-builder --mac");
			const verify = matchingStep(steps, "npm run verify:macos-distribution");
			const checksums = matchingStep(steps, "npm run checksums:release");
			const upload = steps.findIndex((step) => step.with?.name === `macos-${arch}-release`);

			expect(build).toBeGreaterThan(-1);
			expect(steps[build].run).toContain("-c.mac.forceCodeSigning=true");
			expect(steps[build].run).toContain("-c.mac.notarize=true");
			expect(steps[build].run).toContain("--publish never");
			expect(verify).toBeGreaterThan(build);
			expect(verify).toBeLessThan(checksums);
			expect(verify).toBeLessThan(upload);
			expect(steps[verify].if).toBeUndefined();
			expect(steps[verify]["continue-on-error"]).not.toBe(true);
			expect(steps[verify].run).toContain(`--arch ${arch}`);
			expect(steps[verify].run).toContain('--team-id "$APPLE_TEAM_ID"');
			expect(job.env.APPLE_TEAM_ID).toContain("secrets.APPLE_TEAM_ID");
			expect(steps[upload].with.path).toContain(
				`release/macos-distribution-report-${arch}.json`,
			);

			const publish = workflow.jobs["publish-release-assets"];
			expect(publish.needs).toContain(jobName);
			expect(publish.if).toContain(`needs.${jobName}.result == 'success'`);
		});
	}
});
