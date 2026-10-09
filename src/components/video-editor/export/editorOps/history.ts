import type { EditorOpMap } from "./types";

export const historyOps: EditorOpMap = {
	"history.undo": (_payload, context) => {
		if (!context.history.canUndo) {
			throw new Error("There is nothing to undo: the edit history is empty.");
		}
		context.history.undo();
		return { undone: true, canUndo: context.history.canUndo };
	},
	"history.redo": (_payload, context) => {
		if (!context.history.canRedo) {
			throw new Error("There is nothing to redo.");
		}
		context.history.redo();
		return { redone: true, canRedo: context.history.canRedo };
	},
};
