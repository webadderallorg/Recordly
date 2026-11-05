import type { ReactElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() =>
	Object.assign(
		vi.fn(() => "toast-key"),
		{
			success: vi.fn(),
			danger: vi.fn(),
			update: vi.fn(() => "toast-key"),
			clear: vi.fn(),
			close: vi.fn(),
		},
	),
);
vi.mock("@heroui/react", () => ({ Toast: { Provider: () => null }, toast: native }));

import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { toast } from "./toast";

function errorPresentation() {
	const [, options] = native.mock.calls[0] as unknown as [
		unknown,
		{
			variant: string;
			timeout: number;
			actionProps?: unknown;
			description: ReactElement<{
				children: [
					ReactElement<{
						children: [
							ReactElement<{ error: string }>,
							ReactElement<{ children: string; onPress: () => void }> | undefined,
						];
					}>,
					ReactElement<{ children: string; className: string; tabIndex: number }>,
				];
			}>;
		},
	];
	const [actions, diagnostic] = options.description.props.children;
	const [report, action] = actions.props.children;
	return { options, report, action, diagnostic };
}

afterEach(() => {
	toast.dismiss();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});
it("copies the error title and details from the shared action row", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	toast.error("Export failed", { description: "Encoder unavailable" });
	const { options, report, action } = errorPresentation();
	expect(options.variant).toBe("danger");
	expect(options.actionProps).toBeUndefined();
	expect(report.type).toBe(ErrorReportButton);
	expect(action?.props.children).toBe("Copy");
	action?.props.onPress();
	await vi.waitFor(() => expect(native.success).toHaveBeenCalledWith("Error copied"));
	expect(writeText).toHaveBeenCalledWith("Export failed\n\nEncoder unavailable");
});
it("preserves explicit actions and updates named notifications", () => {
	const onClick = vi.fn();
	toast.error("Retry", { id: "job", action: { label: "Retry", onClick } });
	const { action } = errorPresentation();
	expect(action?.props.children).toBe("Retry");
	action?.props.onPress();
	expect(onClick).toHaveBeenCalledOnce();
	toast.success("Done", { id: "job" });
	expect(native.update).toHaveBeenCalledWith(
		"toast-key",
		"Done",
		expect.objectContaining({ variant: "success" }),
	);
});

it("does not offer error copying when the message is a manual-copy fallback", () => {
	toast.error("Select the link and copy it manually.", { copyable: false });
	const { report, action } = errorPresentation();
	expect(report.type).toBe(ErrorReportButton);
	expect(action).toBeUndefined();
});

it("localizes copy notifications using the saved language", async () => {
	vi.stubGlobal("window", { localStorage: { getItem: () => "es" } });
	vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => undefined) } });
	toast.error("Error");
	const { action } = errorPresentation();
	expect(action?.props.children).toBe("Copiar");
	action?.props.onPress();
	await vi.waitFor(() => expect(native.success).toHaveBeenCalledWith("Error copiado"));
});

it("offers reporting even when an error has its own retry action", () => {
	toast.error("Disk failed", {
		description: "EIO",
		action: { label: "Retry", onClick: () => {} },
	});
	const { report } = errorPresentation();
	expect(report.type).toBe(ErrorReportButton);
	expect(report.props.error).toBe("Disk failed\n\nEIO");
});

it("keeps an error available for reporting until it is dismissed", () => {
	toast.error("Disk failed");
	expect(native).toHaveBeenCalledWith("Disk failed", expect.objectContaining({ timeout: 0 }));
});

it("keeps the action row before bounded diagnostics while copying the complete failure", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	const details = Array.from(
		{ length: 80 },
		(_, index) => `Native encoder diagnostic ${index}`,
	).join("\n");
	const title = "Lightning MP4 export failed";
	toast.error(title, { description: details });
	const { options, report, action, diagnostic } = errorPresentation();
	expect(native).toHaveBeenCalledWith(title, expect.anything());
	expect(options.timeout).toBe(0);
	expect(report.type).toBe(ErrorReportButton);
	expect(report.props.error).toBe(`${title}\n\n${details}`);
	expect(diagnostic.props.children).toBe(details);
	expect(diagnostic.props.className).toContain("overflow-y-auto");
	expect(diagnostic.props.className).toContain("max-h-");
	expect(diagnostic.props.tabIndex).toBe(0);
	action?.props.onPress();
	await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(`${title}\n\n${details}`));
});

it("bounds an error passed entirely as the title without losing report or copy data", async () => {
	const message = `Native export failed\n${"FFmpeg diagnostic\n".repeat(80)}`;
	const writeText = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	toast.error(message);
	const [title] = native.mock.calls[0] as unknown as [
		ReactElement<{ children: string; className: string; tabIndex: number }>,
	];
	const { report, action } = errorPresentation();
	expect(title.props.children).toBe(message);
	expect(title.props.className).toContain("max-h-16");
	expect(title.props.tabIndex).toBe(0);
	expect(report.props.error).toBe(message);
	action?.props.onPress();
	await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(message));
});
