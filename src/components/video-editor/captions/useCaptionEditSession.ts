import { useCallback, useEffect, useRef, useState } from "react";
import { type CaptionEditTarget, normalizeCaptionEditText } from "../captionEditing";

export interface CaptionEditSession {
	target: CaptionEditTarget;
	draft: string;
}

interface CaptionEditSessionOptions {
	editTarget: CaptionEditTarget | null;
	onEditCaption?: (target: CaptionEditTarget, text: string) => void;
	onBeginEdit: () => void;
}

function useFocusAndAutosize(
	inputRef: React.RefObject<HTMLTextAreaElement>,
	session: CaptionEditSession | null,
) {
	const targetId = session?.target.id ?? null;
	const draft = session?.draft ?? "";

	useEffect(() => {
		if (!targetId) return;
		const frame = requestAnimationFrame(() => {
			const input = inputRef.current;
			if (!input) return;
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
		});
		return () => cancelAnimationFrame(frame);
	}, [inputRef, targetId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the textarea must regrow whenever the draft text changes.
	useEffect(() => {
		if (!targetId) return;
		const frame = requestAnimationFrame(() => {
			const input = inputRef.current;
			if (!input) return;
			input.style.height = "auto";
			input.style.height = `${input.scrollHeight}px`;
		});
		return () => cancelAnimationFrame(frame);
	}, [inputRef, targetId, draft]);
}

/** Inline editing of the caption currently on screen: begin, type, commit or cancel. */
export function useCaptionEditSession({
	editTarget,
	onEditCaption,
	onBeginEdit,
}: CaptionEditSessionOptions) {
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const sessionRef = useRef<CaptionEditSession | null>(null);
	const [session, setSession] = useState<CaptionEditSession | null>(null);

	const updateSession = useCallback((next: CaptionEditSession | null) => {
		sessionRef.current = next;
		setSession(next);
	}, []);

	const beginEdit = useCallback(() => {
		if (!editTarget || !onEditCaption) return;
		onBeginEdit();
		updateSession({ target: editTarget, draft: editTarget.text });
	}, [editTarget, onBeginEdit, onEditCaption, updateSession]);

	const setDraft = useCallback(
		(draft: string) => {
			if (sessionRef.current) updateSession({ ...sessionRef.current, draft });
		},
		[updateSession],
	);

	const commitEdit = useCallback(() => {
		const current = sessionRef.current;
		updateSession(null);
		if (!current || !onEditCaption) return;
		const normalizedDraft = normalizeCaptionEditText(current.draft);
		if (normalizedDraft && normalizedDraft !== normalizeCaptionEditText(current.target.text)) {
			onEditCaption(current.target, current.draft);
		}
	}, [onEditCaption, updateSession]);

	const cancelEdit = useCallback(() => updateSession(null), [updateSession]);

	useFocusAndAutosize(inputRef, session);

	return { session, inputRef, beginEdit, setDraft, commitEdit, cancelEdit };
}
