import { Button, Checkbox, Description, Form, Label, TextArea, TextField } from "@heroui/react";
import { Check, Paperclip } from "@phosphor-icons/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRecordlyAuth } from "@/components/auth/useRecordlyAuth";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import {
	DiscordIcon,
	openExternalLink,
	RECORDLY_DISCORD_URL,
} from "@/components/feedback/FeedbackLinks";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { ChatWarning, X } from "@/components/ui/icons";
import { useI18n } from "@/contexts/I18nContext";
import { beginAppOperation, collectFeedbackDiagnostics } from "@/lib/feedback/diagnostics";
import {
	DEFAULT_FEEDBACK_SENTIMENT,
	type FeedbackSentiment,
	getFeedbackDraft,
	subscribeFeedbackDraft,
	updateFeedbackDraft,
} from "@/lib/feedback/draft";
import {
	feedbackErrorMessage,
	submitFeedback,
	validateAttachments,
} from "@/lib/feedback/submitFeedback";

import styles from "./FeedbackDialog.module.css";

const sentiments = [
	{ value: "loving", emoji: "🥰", label: "Loving" },
	{ value: "neutral", emoji: "😐", label: "Neutral" },
	{ value: "angry", emoji: "🙁", label: "Frowning" },
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
	const user = auth.user;
	const userId = user?.id;
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
	const [uploadProgress, setUploadProgress] = useState<number | null>(null);
	const [replyAccountId, setReplyAccountId] = useState<string>();
	const allowReply = Boolean(user?.email && replyAccountId === userId);
	const [receipt, setReceipt] = useState<{
		userId: string;
		allowReply: boolean;
		replyEmail?: string;
	}>();
	const sent = receipt?.userId === userId ? receipt : undefined;
	const sentHeading = useRef<HTMLHeadingElement>(null);
	const sendingRef = useRef(false);
	const picker = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (!open) return;
		setReceipt(undefined);
		setReplyAccountId(undefined);
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
		setError("");
	}, [userId]);
	useEffect(() => {
		if (open && sent) sentHeading.current?.focus();
	}, [open, sent]);
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
			<DialogContent className={styles.dialog}>
				{!sent && (
					<DialogHeader className={styles.header}>
						<DialogTitle>{t("common.feedback.send", "Send feedback")}</DialogTitle>
					</DialogHeader>
				)}
				{sent ? (
					<div className={styles.confirmation}>
						<Check className={styles.check} aria-hidden="true" />
						<DialogTitle ref={sentHeading} tabIndex={-1} className={styles.sentTitle}>
							{t("common.feedback.sentTitle", "Support request sent")}
						</DialogTitle>
						<Description className={styles.sentDescription}>
							{t(
								"common.feedback.sentDescription",
								"Your ticket has been logged for Recordly.",
							)}
							{sent.allowReply &&
								(sent.replyEmail
									? ` ${t(
											"common.feedback.replyConfirmation",
											"I’ll reach out from {{senderEmail}}.",
											{
												senderEmail: "youngchen3442@gmail.com",
											},
										)}`
									: ` ${t("common.feedback.replyUnavailable", "Your email couldn't be shared.")}`)}
						</Description>
						<Button
							variant="tertiary"
							className={styles.discord}
							onPress={() =>
								void openExternalLink(
									RECORDLY_DISCORD_URL,
									t("editor.feedback.openFailed", "Failed to open link."),
								)
							}
						>
							<DiscordIcon className="size-4 text-muted-foreground" />
							{t("editing.joinDiscord", "Join Discord")}
						</Button>
					</div>
				) : !user ? (
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
						className={styles.form}
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
							const operation = beginAppOperation("feedback.send");
							try {
								operation.step("collect-diagnostics");
								const logs = await collectFeedbackDiagnostics();
								operation.step("submit");
								const replyEmail = await submitFeedback({
									title: `${sentiments.find((item) => item.value === sentiment)?.emoji ?? ""} ${message}`,
									subject: "other",
									message,
									files,
									logs,
									replyForAccountId: allowReply ? user.id : undefined,
									onUploadProgress: setUploadProgress,
								});
								operation.finish("succeeded");
								setReceipt({ userId: user.id, allowReply, replyEmail });
								updateFeedbackDraft(user.id, {
									sentiment: DEFAULT_FEEDBACK_SENTIMENT,
									message: "",
									files: [],
								});
							} catch (error) {
								operation.finish("failed");
								setError(feedbackErrorMessage(error));
							} finally {
								sendingRef.current = false;
								setSending(false);
								setUploadProgress(null);
							}
						}}
					>
						<div
							role="group"
							aria-label={t("common.feedback.sentiment", "How do you feel?")}
							className={styles.sentiments}
						>
							{sentiments.map((item) => (
								<Button
									key={item.value}
									type="button"
									variant={sentiment === item.value ? "secondary" : "ghost"}
									className={styles.sentiment}
									aria-label={t(`common.feedback.${item.value}`, item.label)}
									aria-pressed={sentiment === item.value}
									isDisabled={sending}
									onPress={() =>
										setSentiment(sentiment === item.value ? null : item.value)
									}
								>
									<span className={styles.emoji} aria-hidden="true">
										{item.emoji}
									</span>
									<span className={styles.sentimentLabel}>
										{t(`common.feedback.${item.value}`, item.label)}
									</span>
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
								className={styles.message}
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
							className={styles.attach}
							isDisabled={sending}
							onPress={() => picker.current?.click()}
						>
							<Paperclip className="size-4" aria-hidden="true" />
							{t("common.feedback.attachFilesWithLimit", "Attach files (50 MB)")}
						</Button>
						{files.length > 0 && (
							<div className="flex flex-col gap-1">
								{files.map((file, index) => (
									<div
										key={`${file.name}-${index}`}
										className={styles.attachment}
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
						<Description className={styles.diagnostics}>
							{t("common.feedback.diagnostics", "Diagnostic logs will be attached.")}
						</Description>
						{user.email && (
							<Checkbox
								variant="secondary"
								isSelected={allowReply}
								isDisabled={sending}
								onChange={(checked) =>
									setReplyAccountId(checked ? userId : undefined)
								}
							>
								<Checkbox.Content>
									<Checkbox.Control className={styles.replyControl}>
										<Checkbox.Indicator />
									</Checkbox.Control>
									<Label className="text-xs leading-relaxed">
										{t(
											"common.feedback.allowReply",
											"Reply to my feedback (shares email)",
										)}
									</Label>
								</Checkbox.Content>
							</Checkbox>
						)}
						{uploadProgress !== null && (
							<progress
								className="w-full"
								aria-label={t("common.feedback.attachFiles", "Attach files")}
								value={uploadProgress}
								max={100}
							/>
						)}
						{error && (
							<Description role="alert" className="text-danger">
								{error} <ErrorReportButton error={error} />
							</Description>
						)}
						<Button
							type="submit"
							size="sm"
							isDisabled={sending}
							className={styles.submit}
						>
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
