import { Input, ProgressBar, TextArea } from "@heroui/react";
import { ArrowClockwise, Export, LinkSimple } from "@phosphor-icons/react";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { LocalizedError } from "@/components/feedback/LocalizedError";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Check, Copy } from "@/components/ui/icons";
import { Label } from "@/components/ui/label";
import { useI18n, useI18n as useUiLocale } from "@/contexts/I18nContext";
import type { Props } from "./cloudShareProps";
import { CLOUD_SHARE_ENDPOINT as DEFAULT_CLOUD_ENDPOINT } from "./endpoint";
import { PublishedVideoPreview } from "./PublishedVideoPreview";
import { SharedRecordings } from "./SharedRecordings";
import { notifyShareCapacityChanged, RECORDING_LIMIT_MESSAGE } from "./shareCapacity";
import { useCloudShareController } from "./useCloudShareController";
export function CloudShareButton(props: Props) {
	const {
		onRegenerate,
		filePath,
		projectTitle,
		prepareFile,
		hideTrigger = false,
		authToken,
		inline = false,
		onRequestSignIn,
	} = props;
	const { t: uiText } = useUiLocale();
	const { t } = useI18n();
	const {
		open,
		setOpen,
		progress,
		uploading,
		checkingCapacity,
		error,
		shareUrl,
		needsRegenerate,
		copied,
		shareLinkInput,
		title,
		setTitle,
		notes,
		setNotes,
		signInRequired,
		capacityIdentity,
		currentCapacityIdentity,
		capacityError,
		verifiedCapacity,
		sessionRecovery,
		handleOpenChange,
		handleUpload,
		handleCancel,
		copyShareUrl,
	} = useCloudShareController(props);

	const form = (
		<>
			{uploading ? (
				<div className="mb-4 space-y-2">
					<ProgressBar aria-label={t("editor.cloud.createLink")} value={progress}>
						<ProgressBar.Track>
							<ProgressBar.Fill />
						</ProgressBar.Track>
					</ProgressBar>
					<p className="text-xs text-muted-foreground">
						{t("editor.exportStatus.completePercent", "{{percent}}% complete", {
							percent: progress,
						})}
					</p>
				</div>
			) : null}
			{shareUrl ? (
				<div className="space-y-3">
					<PublishedVideoPreview key={shareUrl} url={shareUrl} />
					<Label htmlFor="cloud-share-link" className="sr-only">
						{t("editor.cloud.shareLink", "Share link")}
					</Label>
					<div className="share-link-field flex min-w-0 items-center gap-3 rounded-2xl border border-input bg-background p-1.5 pl-3">
						<LinkSimple
							aria-hidden="true"
							className="size-5 shrink-0 text-muted-foreground"
						/>
						<input
							id="cloud-share-link"
							ref={shareLinkInput}
							readOnly
							value={shareUrl}
							onFocus={(event) => event.currentTarget.select()}
							className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground outline-none"
						/>
						<Button
							type="button"
							size="icon"
							aria-label={
								needsRegenerate
									? uiText("ui.regenerate")
									: copied
										? t("editor.cloud.copied")
										: t("editor.cloud.copyLink", "Copy link")
							}
							disabled={uploading}
							onClick={() => {
								if (needsRegenerate) {
									onRegenerate ? onRegenerate() : void handleUpload();
								} else {
									void copyShareUrl();
								}
							}}
							className="size-10 shrink-0 rounded-xl bg-[#191a1c] text-white hover:bg-[#303136]"
						>
							{needsRegenerate ? (
								<ArrowClockwise className="h-4 w-4" />
							) : copied ? (
								<Check className="h-4 w-4" />
							) : (
								<Copy className="size-5" />
							)}
						</Button>
					</div>
					{needsRegenerate && !uploading && (
						<>
							<p className="text-xs text-muted-foreground">
								{uiText("ui.thisProjectHasChangedSinceThisLinkWas")}
							</p>
							{error && (
								<p role="alert" className="text-sm text-destructive">
									<LocalizedError
										error={error}
										summary={
											signInRequired
												? t("editor.cloud.signInRequired")
												: undefined
										}
									/>{" "}
									<ErrorReportButton error={error} />
								</p>
							)}
						</>
					)}
				</div>
			) : (
				<div className="space-y-4">
					{!uploading && (
						<>
							<div className="space-y-2">
								<Label htmlFor="cloud-share-title">
									{t("editor.cloud.title", "Title")}
								</Label>
								<Input
									id="cloud-share-title"
									value={title}
									placeholder={projectTitle}
									maxLength={200}
									onChange={(event) => setTitle(event.target.value)}
									className="block w-full rounded-md bg-background text-sm"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="cloud-share-notes">{t("editor.cloud.notes")}</Label>
								<TextArea
									id="cloud-share-notes"
									placeholder={t("editor.cloud.notesPlaceholder")}
									value={notes}
									onChange={(event) =>
										setNotes(event.target.value.slice(0, 2000))
									}
									disabled={uploading}
									className="block h-20 w-full resize-none rounded-md bg-background text-sm"
								/>
								{!inline && (
									<p className="text-right text-[11px] text-muted-foreground">
										{notes.length}/2000
									</p>
								)}
							</div>
						</>
					)}
					{authToken && !checkingCapacity && verifiedCapacity === null && !error && (
						<p className="text-xs text-muted-foreground">
							{capacityIdentity === currentCapacityIdentity && capacityError
								? capacityError
								: t(
										"editor.cloud.checkStorageFailed",
										"Could not check cloud storage. Try again.",
									)}{" "}
							<button
								type="button"
								className="underline"
								onClick={() => {
									if (signInRequired && onRequestSignIn) onRequestSignIn();
									else {
										sessionRecovery.current.attempted = false;
										notifyShareCapacityChanged();
									}
								}}
							>
								{signInRequired && onRequestSignIn
									? t("editor.cloud.checkSignIn", "Check sign-in")
									: t("common.actions.retry", "Try again")}
							</button>
						</p>
					)}
					{error || verifiedCapacity === false ? (
						<p className="text-sm text-destructive">
							{error ? (
								<LocalizedError
									error={error}
									summary={
										signInRequired
											? t("editor.cloud.signInRequired")
											: undefined
									}
								/>
							) : (
								t("editor.cloud.recordingLimit", RECORDING_LIMIT_MESSAGE)
							)}
							{error && <ErrorReportButton error={error} context="cloud-share" />}
						</p>
					) : null}
					<div className="flex justify-end gap-2">
						{uploading ? (
							<Button
								type="button"
								variant="outline"
								onClick={() => void handleCancel()}
							>
								{t("common.actions.cancel")}
							</Button>
						) : (
							<Button
								type="button"
								size="lg"
								className="w-full"
								disabled={
									Boolean(authToken) &&
									// Pending checks do not block the action; handleUpload verifies before export.
									(verifiedCapacity === false ||
										(capacityIdentity === currentCapacityIdentity &&
											Boolean(capacityError)))
								}
								onClick={() => {
									if (!authToken && onRequestSignIn) onRequestSignIn();
									else void handleUpload();
								}}
							>
								<Export className="h-4 w-4" />
								{authToken
									? t("editor.cloud.share", "Share")
									: t("editor.cloud.signInToShare", "Sign in to share")}
							</Button>
						)}
					</div>
				</div>
			)}
		</>
	);

	if (inline) return <div>{form}</div>;

	return (
		<>
			{hideTrigger ? null : (
				<Button
					type="button"
					variant="outline"
					onClick={() => setOpen(true)}
					disabled={!filePath && !prepareFile}
					className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border-foreground/10 bg-foreground/5 px-3 text-foreground hover:bg-foreground/10 disabled:opacity-40"
					title={t("editor.cloud.createLinkTitle")}
				>
					<Export className="h-4 w-4" />
					<span className="text-sm font-semibold tracking-tight">
						{t("editor.cloud.createLink")}
					</span>
				</Button>
			)}
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogContent className="max-w-md border-foreground/10 bg-editor-dialog text-foreground">
					<DialogHeader>
						<DialogTitle>{t("editor.cloud.heading")}</DialogTitle>
						<DialogDescription>{t("editor.cloud.description")}</DialogDescription>
					</DialogHeader>

					{!uploading && authToken && DEFAULT_CLOUD_ENDPOINT && (
						<SharedRecordings
							token={authToken}
							endpoint={DEFAULT_CLOUD_ENDPOINT}
							refreshKey={shareUrl}
						/>
					)}

					{form}
				</DialogContent>
			</Dialog>
		</>
	);
}
