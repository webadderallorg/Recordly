import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { readPreviewFeather } from "./webcam-feather-probe";

for (const existing of [true, false]) {
	test(`uploaded webcam survives project switching and restart (${existing ? "saved" : "new"} project)`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "filmstrip.mp4");
		await installDesktopBridgeOverrides(
			page,
			({ existing }) => {
				const key = "test-webcam-project";
				const path = "/projects/Camera.recordly";
				const other = "/projects/Other.recordly";
				let activePath = path;
				const videoPath = `${location.origin}/tests/ui/fixtures/filmstrip.mp4`;
				const makeProject = () => ({
					version: 2,
					projectId: "camera-project",
					videoPath,
					editor: {
						webcam: { enabled: false, sourcePath: null, previewFrame: "soft-blur" },
						clipRegions: [
							{ id: "clip", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 },
						],
					},
				});
				if (!localStorage.getItem("test-webcam-seeded")) {
					localStorage.setItem("test-webcam-seeded", "true");
					if (existing) localStorage.setItem(key, JSON.stringify(makeProject()));
				}
				const read = () => JSON.parse(localStorage.getItem(key) || "null");
				const save = async (project: unknown) => {
					localStorage.setItem(
						activePath === path ? key : "test-webcam-other",
						JSON.stringify(project),
					);
					return { success: true, path: activePath, projectId: "camera-project" };
				};
				window.electronAPI.createProjectFile = save;
				window.electronAPI.saveProjectFile = save;
				window.electronAPI.loadCurrentProjectFile = async () => ({
					success: !!read(),
					path: read() ? path : null,
					project: read(),
				});
				window.electronAPI.openVideoFilePicker = async () => ({
					success: true,
					path: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				});
				// Session metadata is deliberately absent: reopen must use the saved project.
				window.electronAPI.getCurrentRecordingSession = async () => ({
					success: true,
					session: null,
				});
				window.electronAPI.listProjectFiles = async () => ({
					success: true,
					entries: [
						{
							path,
							name: "Camera",
							updatedAt: Date.now(),
							thumbnailPath: null,
							isCurrent: false,
							isInProjectsDirectory: true,
						},
						{
							path: other,
							name: "Other",
							updatedAt: Date.now(),
							thumbnailPath: null,
							isCurrent: false,
							isInProjectsDirectory: true,
						},
					],
				});
				window.electronAPI.openProjectFileAtPath = async (selected) => {
					activePath = selected;
					return {
						success: true,
						path: selected,
						project: selected === path ? read() : makeProject(),
					};
				};
			},
			{ existing },
		);
		await page.goto("/?windowType=editor");
		await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, { timeout: 30000 });
		// Let initial project creation finish so the upload is the only new edit.
		await expect
			.poll(() => page.evaluate(() => !!localStorage.getItem("test-webcam-project")))
			.toBe(true);
		await page.getByRole("radio", { name: "Webcam", exact: true }).click();
		await page.getByRole("button", { name: "Upload footage", exact: true }).click();
		await expect(page.locator("[data-webcam-overlay]")).toHaveAttribute(
			"data-webcam-ready",
			"true",
		);
		await expect
			.poll(() =>
				page.evaluate(() => {
					const webcam = JSON.parse(localStorage.getItem("test-webcam-project") || "null")
						?.editor?.webcam;
					return webcam?.enabled && webcam?.sourcePath?.endsWith("/preview.mp4");
				}),
			)
			.toBe(true);
		await page.getByRole("button", { name: "Home", exact: true }).click();
		const dashboard = page.getByRole("dialog", { name: "Projects dashboard" });
		await dashboard.getByRole("button", { name: "Other", exact: true }).click();
		await expect(page.locator("[data-webcam-overlay]")).toHaveCount(0);
		await page.getByRole("button", { name: "Home", exact: true }).click();
		await dashboard.getByRole("button", { name: "Camera", exact: true }).click();
		await expect(page.locator("[data-webcam-overlay] video")).toHaveAttribute(
			"src",
			/preview\.mp4/,
		);
		await expect(page.locator("[data-webcam-motion-blur]")).toBeVisible();
		await page.reload();
		await expect(page.locator("[data-webcam-overlay] video")).toHaveAttribute(
			"src",
			/preview\.mp4/,
		);
		await expect(page.locator("[data-webcam-overlay]")).toHaveAttribute(
			"data-webcam-ready",
			"true",
		);
		await expect
			.poll(() => page.evaluate(readPreviewFeather))
			.toEqual({ transparentEdge: true, opaqueCenter: true, gradualFade: true });
	});
}
