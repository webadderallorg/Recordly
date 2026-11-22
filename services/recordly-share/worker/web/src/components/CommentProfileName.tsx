import { Button, Input, Label, TextField } from "@heroui/react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { useState } from "react";
import { commentProfileName } from "../scripts/commentAuth";
import { Notice } from "./ShareUI";

export default function CommentProfileName({
	client,
	user,
	onSaved,
}: {
	client: SupabaseClient;
	user: User;
	onSaved: (user: User) => void;
}) {
	const current = commentProfileName(user.user_metadata);
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(current || "");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	if (current && !editing)
		return (
			<>
				<p>
					Commenting as <strong>{current}</strong>
				</p>
				<Button
					size="sm"
					variant="ghost"
					onPress={() => {
						setName(current);
						setEditing(true);
						setError("");
					}}
				>
					Change name
				</Button>
			</>
		);

	async function save() {
		if (pending || !name.trim() || name.trim().length > 100) return;
		setPending(true);
		setError("");
		try {
			const result = await client.auth.updateUser({ data: { full_name: name.trim() } });
			if (result.error || !result.data.user)
				throw new Error("Could not save your name. Please try again.");
			onSaved(result.data.user);
			setEditing(false);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not save your name. Please try again.",
			);
		} finally {
			setPending(false);
		}
	}
	return (
		<form
			className="space-y-2"
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			{!current && <p>Choose a display name before commenting.</p>}
			<TextField value={name} onChange={setName} isRequired isDisabled={pending}>
				<Label>Display name</Label>
				<Input autoComplete="nickname" maxLength={100} />
			</TextField>
			<p className="text-xs text-muted">
				This name is visible on shared videos. Your email stays private.
			</p>
			{error && <Notice>{error}</Notice>}
			<div className="flex gap-2">
				<Button
					size="sm"
					type="submit"
					isPending={pending}
					isDisabled={pending || !name.trim()}
				>
					Save name
				</Button>
				{current && (
					<Button
						size="sm"
						variant="ghost"
						isDisabled={pending}
						onPress={() => setEditing(false)}
					>
						Cancel
					</Button>
				)}
			</div>
		</form>
	);
}
