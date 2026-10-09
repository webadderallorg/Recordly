import { describe, expect, it, vi } from "vitest";
import { historyOps } from "./history";
import type { EditorOpContext } from "./types";

const context = (over: { canUndo?: boolean; canRedo?: boolean } = {}) => {
	const undo = vi.fn();
	const redo = vi.fn();
	return {
		undo,
		redo,
		context: {
			history: { undo, redo, canUndo: over.canUndo ?? true, canRedo: over.canRedo ?? true },
			assertSameRecording: () => undefined,
			adoptJoinedMedia: () => undefined,
		} as unknown as EditorOpContext,
	};
};

describe("history ops", () => {
	it("undoes and redoes through the editor's own history", () => {
		const { undo, redo, context: ctx } = context();
		expect(historyOps["history.undo"]({}, ctx)).toMatchObject({ undone: true });
		expect(undo).toHaveBeenCalledTimes(1);
		expect(redo).not.toHaveBeenCalled();
		expect(historyOps["history.redo"]({}, ctx)).toMatchObject({ redone: true });
		expect(redo).toHaveBeenCalledTimes(1);
		expect(undo).toHaveBeenCalledTimes(1);
	});

	it("refuses rather than pretending when there is nothing to undo or redo", () => {
		const empty = context({ canUndo: false, canRedo: false });
		expect(() => historyOps["history.undo"]({}, empty.context)).toThrow(/nothing to undo/);
		expect(() => historyOps["history.redo"]({}, empty.context)).toThrow(/nothing to redo/);
		expect(empty.undo).not.toHaveBeenCalled();
		expect(empty.redo).not.toHaveBeenCalled();
	});
});
