import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("the existing Report Error button sends Home crash evidence without requiring sign-in", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await installDesktopBridge(page, undefined, { signedIn: false, onboarded: true });
	await installDesktopBridgeOverrides(page, () => {
		const loadLibrary = new Promise<void>((resolve) => {
			window.addEventListener("recordly-test-crash-home", () => resolve(), { once: true });
		});
		window.electronAPI.getCurrentVideoPath = async () => ({ success: false });
		window.electronAPI.getEditorStartupView = () => "home";
		let deviceReads = 0;
		window.electronAPI.getSupportDeviceInfo = async () => {
			document.documentElement.dataset.deviceReads = String(++deviceReads);
			return {
				success: true,
				device: {
					capturedAt: new Date().toISOString(),
					machineModel: "TestMac 1,1",
					hostArchitecture: "arm64",
					runningUnderArm64Translation: false,
					cpu: { model: "Fixture CPU", logicalProcessors: 8 },
					memory: { totalMiB: 16384, freeMiB: 4096 },
					graphics: {
						probeStatus: "available",
						adapters: [
							{
								name: "Fixture GPU",
								vendor: "Fixture",
								active: true,
								driverVersion: "12.3",
							},
						],
						features: {
							videoDecode: null,
							videoEncode: null,
							webgl: "enabled",
							webgpu: null,
						},
					},
					displays: undefined,
				},
			};
		};
		window.electronAPI.listProjectFiles = async () => {
			await loadLibrary;
			return {
				success: true,
				projectsDir: null,
				entries: [
					{ path: "/Users/tester/private.recordly", name: null!, updatedAt: Date.now() },
				],
			};
		};
	});
	let submissions = 0;
	await page.route("**/functions/v1/submit-export-error", (route) => {
		if (route.request().method() === "POST") submissions++;
		return route.fulfill({ json: { success: true } });
	});
	await page.goto("/?windowType=editor");
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await expect(home).toBeVisible({ timeout: 30_000 });
	await page.evaluate(() => window.dispatchEvent(new Event("recordly-test-crash-home")));
	await expect(page.getByRole("heading", { name: "Recordly ran into a problem" })).toBeVisible({
		timeout: 15_000,
	});
	expect(await page.locator("html").getAttribute("data-device-reads")).toBeNull();
	await page.getByText("Technical details", { exact: true }).click();
	const preview = page.getByRole("region", { name: "Technical details" });
	await expect(preview).toContainText("TestMac 1,1");
	await expect(preview).toContainText("home.open");
	await expect(preview).toContainText("useDashboardModel.ts:");
	expect(submissions).toBe(0);
	const previewed = JSON.parse(await preview.innerText());
	const submitted = page.waitForRequest(
		(request) =>
			request.url().endsWith("/functions/v1/submit-export-error") &&
			request.method() === "POST",
	);
	await page.getByRole("button", { name: "Report Error", exact: true }).click();
	const request = await submitted;
	await expect(page.getByRole("button", { name: "Report sent", exact: true })).toBeVisible();
	const report = request.postDataJSON();
	expect(request.headers().authorization).toBeUndefined();
	expect(report.context).toBe("application-crash");
	const diagnostics = JSON.parse(report.logs);
	expect(previewed).toEqual({ ...report, logs: diagnostics });
	await expect(page.locator("html")).toHaveAttribute("data-device-reads", "1");
	expect(diagnostics.device).toMatchObject({
		machineModel: "TestMac 1,1",
		cpu: { model: "Fixture CPU" },
		graphics: { adapters: [{ name: "Fixture GPU", driverVersion: "12.3" }] },
	});
	expect(diagnostics.viewport).toMatchObject({
		widthCssPx: expect.any(Number),
		devicePixelRatio: expect.any(Number),
	});
	const editorOpen = diagnostics.operationHistory.find(
		(event: { name: string; phase: string }) =>
			event.name === "editor.open" && event.phase === "start",
	);
	expect(editorOpen?.operationId).toBeTruthy();
	expect(diagnostics.operationHistory).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				name: "editor.open",
				stage: "open-home",
				phase: "finish",
				outcome: "succeeded",
			}),
			expect.objectContaining({
				name: "home.open",
				parentOperationId: editorOpen.operationId,
				phase: "finish",
			}),
			expect.objectContaining({
				name: "home.show-section",
				stage: "projects",
				phase: "finish",
				outcome: "succeeded",
			}),
			expect.objectContaining({
				name: "project.library-load",
				stage: "apply-entries",
				phase: "finish",
			}),
		]),
	);
	expect(diagnostics.crash).toMatchObject({ view: "home", errorName: "TypeError" });
	expect(diagnostics.crash.stack.join("\n")).toContain("useDashboardModel.ts:");
	expect(diagnostics.crash.componentStack.join("\n")).toContain("at Dashboard");
	expect(diagnostics.logs).toEqual(
		expect.arrayContaining([
			expect.stringContaining("[home] renderer started"),
			expect.stringContaining("project library loaded count=1"),
		]),
	);
	expect(report.logs).not.toContain("private.recordly");
});
