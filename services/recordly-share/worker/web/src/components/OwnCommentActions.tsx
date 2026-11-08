import { Button, Label, Modal, TextArea, TextField, toast } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import {
	CommentSignInError,
	deleteOwnComment,
	formatTimestamp,
	updateOwnComment,
	type Comment,
	type CommentAccountState,
} from "../scripts/api";
import { Notice } from "./ShareUI";

export default function OwnCommentActions({
	comment,
	shareCode,
	account,
	canEdit,
	onUpdated,
	onDeleted,
	onReauthenticate,
}: {
	comment: Comment;
	shareCode: string;
	account: CommentAccountState;
	canEdit: boolean;
	onUpdated: (text: string) => void;
	onDeleted: () => void;
	onReauthenticate: () => void;
}) {
	const draftKey = `recordly-comment-edit:${shareCode}:${account.key}:${comment.id}`;
	const [mode, setMode] = useState<"edit" | "delete" | null>(null);
	const [draft, setDraft] = useState(comment.text);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [signInNeeded, setSignInNeeded] = useState(false);
	const active = useRef(true);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);

	useEffect(() => {
		if (mode !== "edit") return;
		try {
			sessionStorage.setItem(draftKey, draft);
		} catch {
			/* Keep an in-memory draft. */
		}
	}, [mode, draft, draftKey]);
	function clearDraft() {
		try {
			sessionStorage.removeItem(draftKey);
		} catch {
			/* Storage is optional. */
		}
	}
	function cancel() {
		clearDraft();
		setMode(null);
	}

	function open(next: "edit" | "delete") {
		setMode(next);
		setError("");
		setSignInNeeded(false);
		if (next === "edit") {
			let recovered: string | null = null;
			try {
				recovered = sessionStorage.getItem(draftKey);
			} catch {
				/* Storage is optional. */
			}
			setDraft(recovered && recovered.length <= 2000 ? recovered : comment.text);
		}
	}
	async function save() {
		if (pending || !mode || (mode === "edit" && (!canEdit || !draft.trim()))) return;
		setPending(true);
		setError("");
		setSignInNeeded(false);
		try {
			const token = await account.getAccessToken();
			if (mode === "edit") await updateOwnComment(shareCode, comment.id, draft.trim(), token);
			else await deleteOwnComment(shareCode, comment.id, token);
			if (!active.current) return;
			clearDraft();
			if (mode === "edit") {
				onUpdated(draft.trim());
				toast.success("Comment updated");
			} else {
				onDeleted();
				toast.success("Comment deleted");
			}
			setMode(null);
		} catch (cause) {
			if (active.current) {
				setError(
					cause instanceof Error
						? cause.message
						: "Could not change your comment. Please try again.",
				);
				setSignInNeeded(cause instanceof CommentSignInError);
			}
		} finally {
			if (active.current) setPending(false);
		}
	}
	return (
		<>
			<div className="flex gap-1">
				{canEdit && (
					<Button
						size="sm"
						variant="ghost"
						onPress={() => open("edit")}
						aria-label="Edit your comment"
					>
						Edit
					</Button>
				)}
				<Button
					size="sm"
					variant="ghost"
					onPress={() => open("delete")}
					aria-label="Delete your comment"
				>
					Delete
				</Button>
			</div>
			<Modal
				isOpen={mode !== null}
				onOpenChange={(open) => {
					if (!open && !pending) cancel();
				}}
			>
				<Modal.Backdrop isDismissable={!pending} isKeyboardDismissDisabled={pending}>
					<Modal.Container size="sm" placement="center" className="p-4">
						<Modal.Dialog
							className="max-h-[calc(100dvh-32px)] space-y-4 overflow-y-auto p-6"
							aria-label={
								mode === "edit" ? "Edit your comment" : "Delete your comment"
							}
						>
							{!pending && <Modal.CloseTrigger />}
							<Modal.Header>
								<Modal.Heading>
									{mode === "edit" ? "Edit comment" : "Delete comment?"}
								</Modal.Heading>
							</Modal.Header>
							<form
								className="space-y-4"
								onSubmit={(event) => {
									event.preventDefault();
									void save();
								}}
							>
								{mode === "edit" ? (
									<>
										<TextField
											value={draft}
											onChange={setDraft}
											isRequired
											isDisabled={pending}
										>
											<Label>Edit comment</Label>
											<TextArea maxLength={2000} autoFocus />
										</TextField>
										<p className="text-xs text-muted">
											Timestamp stays at {formatTimestamp(comment.timestamp)}.
										</p>
									</>
								) : (
									<p>
										This removes your comment from the shared video. This cannot
										be undone.
									</p>
								)}
								{error && <Notice>{error}</Notice>}
								{signInNeeded && (
									<Button
										size="sm"
										variant="secondary"
										onPress={onReauthenticate}
									>
										Sign in again
									</Button>
								)}
								<div className="flex justify-end gap-2">
									<Button
										size="sm"
										variant="ghost"
										isDisabled={pending}
										onPress={cancel}
									>
										Cancel
									</Button>
									<Button
										size="sm"
										type="submit"
										variant={mode === "delete" ? "danger" : "primary"}
										isPending={pending}
										isDisabled={
											pending ||
											(mode === "edit" &&
												(!canEdit ||
													!draft.trim() ||
													draft.trim() === comment.text))
										}
									>
										{mode === "edit" ? "Save changes" : "Delete comment"}
									</Button>
								</div>
							</form>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
		</>
	);
}
