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
import { toast } from "./toast";
afterEach(() => {
	toast.dismiss();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});
it("copies the error title and details through the native action", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	toast.error("Export failed", { description: "Encoder unavailable" });
	const options = (
		native.mock.calls as unknown as [
			string,
			{ variant: string; actionProps: { children: string; onPress: () => void } },
		][]
	)[0][1];
	expect(options.variant).toBe("danger");
	expect(options.actionProps.children).toBe("Copy");
	options.actionProps.onPress();
	await vi.waitFor(() => expect(native.success).toHaveBeenCalledWith("Error copied"));
	expect(writeText).toHaveBeenCalledWith("Export failed\n\nEncoder unavailable");
});
it("preserves explicit actions and updates named notifications", () => {
	const onClick = vi.fn();
	toast.error("Retry", { id: "job", action: { label: "Retry", onClick } });
	toast.success("Done", { id: "job" });
	expect(native.update).toHaveBeenCalledWith(
		"toast-key",
		"Done",
		expect.objectContaining({ variant: "success" }),
	);
	expect(native).toHaveBeenCalledWith(
		"Retry",
		expect.objectContaining({ actionProps: { children: "Retry", onPress: onClick } }),
	);
});
