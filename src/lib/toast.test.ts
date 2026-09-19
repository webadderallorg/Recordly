import { toast as sonnerToast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFocusModeEnabled, setFocusModeEnabledRef, setFocusModeInitialized } from "./focusMode";
import { toast } from "./toast";

vi.mock("sonner", () => ({
	toast: Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warning: vi.fn(),
		loading: vi.fn(),
		promise: vi.fn(),
		dismiss: vi.fn(),
		custom: vi.fn(),
		message: vi.fn(),
	}),
}));

describe("toast wrapper with focus mode", () => {
	beforeEach(() => {
		setFocusModeEnabledRef(false);
		setFocusModeInitialized();
		vi.clearAllMocks();
	});

	afterEach(() => {
		setFocusModeEnabledRef(false);
	});

	it("passes through toast calls when focus mode is disabled", () => {
		expect(isFocusModeEnabled()).toBe(false);

		toast("hello");
		expect(sonnerToast).toHaveBeenCalledWith("hello");

		toast.success("saved");
		expect(sonnerToast.success).toHaveBeenCalledWith("saved");

		toast.error("failed");
		expect(sonnerToast.error).toHaveBeenCalledWith("failed");

		toast.info("note");
		expect(sonnerToast.info).toHaveBeenCalledWith("note");

		toast.warning("alert");
		expect(sonnerToast.warning).toHaveBeenCalledWith("alert");

		toast.loading("working");
		expect(sonnerToast.loading).toHaveBeenCalledWith("working");
	});

	it("suppresses all toast variants and returns dummy id when focus mode is enabled", () => {
		setFocusModeEnabledRef(true);
		expect(isFocusModeEnabled()).toBe(true);

		const id = toast("hello");
		expect(id).toBe("focus-mode-suppressed");
		expect(sonnerToast).not.toHaveBeenCalled();

		const successId = toast.success("saved");
		expect(successId).toBe("focus-mode-suppressed");
		expect(sonnerToast.success).not.toHaveBeenCalled();

		const errorId = toast.error("failed");
		expect(errorId).toBe("focus-mode-suppressed");
		expect(sonnerToast.error).not.toHaveBeenCalled();

		const infoId = toast.info("note");
		expect(infoId).toBe("focus-mode-suppressed");
		expect(sonnerToast.info).not.toHaveBeenCalled();

		const warningId = toast.warning("alert");
		expect(warningId).toBe("focus-mode-suppressed");
		expect(sonnerToast.warning).not.toHaveBeenCalled();

		const loadingId = toast.loading("working");
		expect(loadingId).toBe("focus-mode-suppressed");
		expect(sonnerToast.loading).not.toHaveBeenCalled();
	});

	it("allows dismiss calls even when focus mode is active", () => {
		setFocusModeEnabledRef(true);
		toast.dismiss("some-id");
		expect(sonnerToast.dismiss).toHaveBeenCalledWith("some-id");
	});
});
