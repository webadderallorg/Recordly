import { annotationsOps } from "./annotations";
import { audioOps } from "./audio";
import { captionsOps } from "./captions";
import { cardsOps } from "./cards";
import { checkEditsOps } from "./checkEdits";
import { historyOps } from "./history";
import { lookOps } from "./look";
import { polishOps } from "./polish";
import { previewOps } from "./preview";
import { projectOps } from "./project";
import { timelineOps } from "./timeline";
import { transitionOps } from "./transitions";
import type { EditorOpContext, EditorOpMap } from "./types";
import { zoomOps } from "./zoom";

const ops: EditorOpMap = {
	...timelineOps,
	...transitionOps,
	...zoomOps,
	...annotationsOps,
	...captionsOps,
	...cardsOps,
	...audioOps,
	...lookOps,
	...previewOps,
	...checkEditsOps,
	...historyOps,
	...projectOps,
	...polishOps,
};

export const READ_ONLY_OPS = new Set(["get_state", "render_preview", "check_edits"]);

export function runEditorOp(op: string, payload: unknown, context: EditorOpContext) {
	const handler = ops[op];
	if (!handler) throw new Error(`The editor does not support "${op}".`);
	return handler(payload, context);
}

export type { EditorOpContext, EditorOpMap } from "./types";
