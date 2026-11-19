import { Button, Input, Label, TextField } from "@heroui/react";
import { useState } from "react";

export type PasswordFormLabels = {
	passwordHeading: string;
	passwordDescription: string;
	newPassword: string;
	confirmPassword: string;
	savePassword: string;
	passwordSaved: string;
	passwordMinimum: string;
	passwordMismatch: string;
	savingPassword: string;
	failure: string;
};

/** Optional credentials after sign-in; passwords never enter persistent client state. */
export function RecordlyPasswordForm({
	labels,
	onSave,
}: {
	labels: PasswordFormLabels;
	onSave: (password: string) => Promise<void>;
}) {
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [saved, setSaved] = useState(false);
	return (
		<form
			aria-label={labels.passwordHeading}
			className="space-y-3"
			onSubmit={async (event) => {
				event.preventDefault();
				if (pending) return;
				setError("");
				setSaved(false);
				if (password.length < 12) {
					setError(labels.passwordMinimum);
					return;
				}
				if (password !== confirmation) {
					setError(labels.passwordMismatch);
					return;
				}
				setPending(true);
				try {
					await onSave(password);
					setPassword("");
					setConfirmation("");
					setSaved(true);
				} catch {
					setError(labels.failure);
				} finally {
					setPending(false);
				}
			}}
		>
			<h3>{labels.passwordHeading}</h3>
			<p className="text-xs leading-relaxed text-muted">{labels.passwordDescription}</p>
			<TextField
				name="newPassword"
				value={password}
				onChange={(value) => {
					setPassword(value);
					setSaved(false);
					setError("");
				}}
				isRequired
				isDisabled={pending}
			>
				<Label>{labels.newPassword}</Label>
				<Input
					variant="secondary"
					type="password"
					autoComplete="new-password"
					minLength={12}
				/>
			</TextField>
			<TextField
				name="confirmPassword"
				value={confirmation}
				onChange={(value) => {
					setConfirmation(value);
					setSaved(false);
					setError("");
				}}
				isRequired
				isDisabled={pending}
			>
				<Label>{labels.confirmPassword}</Label>
				<Input
					variant="secondary"
					type="password"
					autoComplete="new-password"
					minLength={12}
				/>
			</TextField>
			<p className="text-xs text-muted">{labels.passwordMinimum}</p>
			<Button
				type="submit"
				variant="secondary"
				size="sm"
				isDisabled={pending || password.length < 12 || !confirmation}
			>
				{pending ? labels.savingPassword : labels.savePassword}
			</Button>
			{error && (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			)}
			{saved && (
				<p role="status" className="text-sm text-success">
					{labels.passwordSaved}
				</p>
			)}
		</form>
	);
}
