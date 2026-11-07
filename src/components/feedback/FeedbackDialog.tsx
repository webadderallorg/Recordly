import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { Button, Description, Form, TextArea, TextField } from "@heroui/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { useRecordlyAuth } from "@/components/auth/useRecordlyAuth";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { ChatWarning, File, X } from "@/components/ui/icons";
import { collectFeedbackDiagnostics } from "@/lib/feedback/diagnostics";
import {
	getFeedbackDraft,
	type FeedbackSentiment,
	subscribeFeedbackDraft,
	updateFeedbackDraft,
} from "@/lib/feedback/draft";
import {
	feedbackErrorMessage,
	submitFeedback,
	validateAttachments,
} from "@/lib/feedback/submitFeedback";

const sentiments = [
	{ value: "loving", emoji: "🥰", label: "Loving" },
	{ value: "neutral", emoji: "😐", label: "Neutral" },
	{ value: "angry", emoji: "😠", label: "Angry" },
] as const;

export function FeedbackDialog({
	className,
	showLabel = true,
	onSignIn,
	open: controlledOpen,
	onOpenChange,
	hideTrigger = false,
}: {
	className?: string;
	showLabel?: boolean;
	onSignIn?: () => void;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	hideTrigger?: boolean;
}) {
	const auth = useRecordlyAuth();
	const { t } = useI18n();
	const [internalOpen, setInternalOpen] = useState(false);
	const open = controlledOpen ?? internalOpen;
	const setOpen = (value: boolean) => {
		setInternalOpen(value);
		onOpenChange?.(value);
	};
	const userId = auth.user?.id;
	const { sentiment, message, files } = useSyncExternalStore(subscribeFeedbackDraft, () =>
		getFeedbackDraft(userId),
	);
	const setSentiment = (sentiment: FeedbackSentiment) => {
		if (userId) updateFeedbackDraft(userId, { sentiment });
	};
	const setMessage = (message: string) => {
		if (userId) updateFeedbackDraft(userId, { message });
	};
	const setFiles = (files: File[]) => {
		if (userId) updateFeedbackDraft(userId, { files });
	};
	const [error, setError] = useState("");
	const [sending, setSending] = useState(false);
	const [sent, setSent] = useState(false);
	const sendingRef = useRef(false);
	const picker = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (!open) return;
		setSent(false);
		if (userId) {
			const draft = getFeedbackDraft(userId);
			// Spaces in a saved draft suppress the native placeholder despite looking empty.
			if (draft.message.length > 0 && !draft.message.trim()) {
				updateFeedbackDraft(userId, { message: "" });
			}
		}
	}, [open, userId]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset submission feedback when the signed-in account changes.
	useEffect(() => {
		setSent(false);
		setError("");
	}, [userId]);
	function addFiles(incoming: File[]) {
		const next = [...files, ...incoming];
		const issue = validateAttachments(next);
		if (issue) {
			setError(issue);
			return;
		}
		setFiles(next);
		setError("");
	}
	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (sendingRef.current) return;
				setOpen(value);
			}}
		>
			{!hideTrigger && (
				<span
					className="inline-flex"
					title={!showLabel ? t("common.feedback.trigger", "Feedback") : undefined}
				>
					<DialogTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							isIconOnly={!showLabel}
							className={className}
							aria-label={t("common.feedback.trigger", "Feedback")}
							onPress={() => setOpen(true)}
						>
							<ChatWarning className="size-4" />
							{showLabel && t("common.feedback.trigger", "Feedback")}
						</Button>
					</DialogTrigger>
				</span>
			)}
			<DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{sent
							? t("common.feedback.thanks", "Thanks for your feedback")
							: t("common.feedback.send", "Send feedback")}
					</DialogTitle>
				</DialogHeader>
				{sent ? (
					<Button onPress={() => setOpen(false)}>
						{t("common.actions.done", "Done")}
					</Button>
				) : !auth.user ? (
					<div className="flex flex-col gap-4">
						<Description>
							{t("common.feedback.signInRequired", "Sign in to send feedback.")}
						</Description>
						{onSignIn ? (
							<Button
								onPress={() => {
									setOpen(false);
									onSignIn();
								}}
							>
								{t("editor.cloud.signIn", "Sign in")}
							</Button>
						) : (
							<Description>
								{t("common.feedback.openHome", "Open Home to sign in.")}
							</Description>
						)}
					</div>
				) : (
					<Form
						className="flex flex-col gap-4"
						onSubmit={async (event) => {
							event.preventDefault();
							if (sendingRef.current) return;
							if (!message.trim()) {
								setError(
									t(
										"common.feedback.missingMessage",
										"Tell us more before sending.",
									),
								);
								return;
							}
							sendingRef.current = true;
							setSending(true);
							setError("");
							try {
								await submitFeedback({
									title: `${sentiments.find((item) => item.value === sentiment)?.emoji ?? ""} ${message}`,
									subject: "other",
									message,
									files,
									logs: await collectFeedbackDiagnostics(),
								});
								setSent(true);
								if (userId)
									updateFeedbackDraft(userId, {
										sentiment: null,
										message: "",
										files: [],
									});
							} catch (error) {
								setError(feedbackErrorMessage(error));
							} finally {
								sendingRef.current = false;
								setSending(false);
							}
						}}
					>
						<div
							role="group"
							aria-label={t("common.feedback.sentiment", "How do you feel?")}
							className="flex justify-center gap-3"
						>
							{sentiments.map((item) => (
								<Button
									key={item.value}
									type="button"
									isIconOnly
									variant={sentiment === item.value ? "secondary" : "ghost"}
									className={`size-14 rounded-full text-3xl ${sentiment === item.value ? "ring-2 ring-accent" : ""}`}
									aria-label={t(`common.feedback.${item.value}`, item.label)}
									aria-pressed={sentiment === item.value}
									isDisabled={sending}
									onPress={() => setSentiment(item.value)}
								>
									<span aria-hidden="true">{item.emoji}</span>
								</Button>
							))}
						</div>
						<TextField
							name="description"
							aria-label={t("common.feedback.description", "Description")}
							isRequired
							isDisabled={sending}
							value={message}
							onChange={(value) => {
								setMessage(value);
								setError("");
							}}
							className="w-full"
						>
							<TextArea
								maxLength={10000}
								rows={5}
								className="resize-y placeholder:text-muted-foreground placeholder:opacity-100"
								placeholder={t(
									"common.feedback.descriptionPlaceholder",
									"We read all feedback...",
								)}
								onPaste={(event) => {
									const pasted = Array.from(event.clipboardData.files);
									if (pasted.length) {
										event.preventDefault();
										addFiles(pasted);
									}
								}}
							/>
						</TextField>
						<input
							ref={picker}
							type="file"
							multiple
							hidden
							disabled={sending}
							aria-label={t("common.feedback.attachFiles", "Attach files")}
							onChange={(event) => {
								addFiles(Array.from(event.target.files ?? []));
								event.target.value = "";
							}}
						/>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="self-start"
							isDisabled={sending}
							onPress={() => picker.current?.click()}
						>
							<File className="size-4" />
							{t("common.feedback.attachFiles", "Attach files")}
						</Button>
						{files.length > 0 && (
							<div className="flex flex-col gap-1">
								{files.map((file, index) => (
									<div
										key={`${file.name}-${index}`}
										className="flex items-center gap-2 text-sm"
									>
										<span className="min-w-0 flex-1 truncate">{file.name}</span>
										<Button
											type="button"
											isIconOnly
											size="sm"
											variant="ghost"
											isDisabled={sending}
											aria-label={t(
												"common.feedback.removeFile",
												"Remove {{name}}",
												{ name: file.name },
											)}
											onPress={() =>
												setFiles(files.filter((_, i) => i !== index))
											}
										>
											<X className="size-3" />
										</Button>
									</div>
								))}
							</div>
						)}
						<Description className="text-xs">
							{t(
								"common.feedback.diagnostics",
								"Relevant diagnostic logs will be attached.",
							)}
						</Description>
						{error && (
							<Description role="alert" className="text-danger">
								{error} <ErrorReportButton error={error} />
							</Description>
						)}
						<Button type="submit" isDisabled={sending} className="w-full">
							{sending
								? t("common.feedback.sending", "Sending…")
								: t("common.feedback.send", "Send feedback")}
						</Button>
					</Form>
				)}
			</DialogContent>
		</Dialog>
	);
}
