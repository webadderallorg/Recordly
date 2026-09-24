import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Check, CloudArrowUp, Copy, ShareNetwork } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/contexts/I18nContext";
import { copyToClipboard } from "@/lib/clipboard";
import { saveProjectShareLink } from "./projectShareLinks";

const DEFAULT_CLOUD_ENDPOINT = "http://localhost:8787/api/upload";

type Props = {
	projectPath?: string | null;
	filePath?: string;
	projectTitle: string;
	prepareFile?: () => Promise<string | undefined>;
	onCancelPrepare?: () => void;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	hideTrigger?: boolean;
	authToken?: string;
};

export function CloudShareButton({
	projectPath,
	filePath,
	projectTitle,
	prepareFile,
	onCancelPrepare,
	open: controlledOpen,
	onOpenChange,
	hideTrigger = false,
	authToken,
}: Props) {
	const { t } = useI18n();
	const [internalOpen, setInternalOpen] = useState(false);
	const open = controlledOpen ?? internalOpen;
	const setOpen = useCallback(
		(nextOpen: boolean) => {
			onOpenChange?.(nextOpen);
			if (controlledOpen === undefined) setInternalOpen(nextOpen);
		},
		[controlledOpen, onOpenChange],
	);
	const [uploadId, setUploadId] = useState<string>();
	const [progress, setProgress] = useState(0);
	const [uploading, setUploading] = useState(false);
	const [phase, setPhase] = useState<"idle" | "preparing" | "uploading">("idle");
	const [error, setError] = useState<string>();
	const [shareUrl, setShareUrl] = useState<string>();
	const [copied, setCopied] = useState(false);
	const [notes, setNotes] = useState("");
	const preparedFileRef = useRef<string | undefined>(undefined);
	const cancelRequestedRef = useRef(false);

	const discardPreparedFile = useCallback(() => {
		const preparedPath = preparedFileRef.current;
		preparedFileRef.current = undefined;
		if (preparedPath) void window.electronAPI.discardExportedTemp(preparedPath);
	}, []);

	useEffect(() => discardPreparedFile, [discardPreparedFile]);

	useEffect(() => {
		return window.electronAPI.onCloudShareProgress((next) => {
			setUploadId(next.uploadId);
			setProgress(
				next.totalBytes > 0
					? Math.min(100, Math.round((next.uploadedBytes / next.totalBytes) * 100))
					: 0,
			);
		});
	}, []);

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (!nextOpen && uploading) return;
			setOpen(nextOpen);
			if (nextOpen) {
				setError(undefined);
				setCopied(false);
			} else {
				discardPreparedFile();
			}
		},
		[discardPreparedFile, setOpen, uploading],
	);

	const handleUpload = useCallback(async () => {
		setUploading(true);
		setProgress(0);
		setPhase("preparing");
		cancelRequestedRef.current = false;
		setError(undefined);
		setShareUrl(undefined);
		try {
			if (!authToken) throw new Error(t("editor.cloud.signInRequired"));
			let resolvedFilePath = filePath ?? preparedFileRef.current;
			if (!resolvedFilePath) {
				resolvedFilePath = await prepareFile?.();
				if (cancelRequestedRef.current) {
					if (resolvedFilePath)
						void window.electronAPI.discardExportedTemp(resolvedFilePath);
					return;
				}
				if (!resolvedFilePath) throw new Error(t("editor.cloud.prepareFailed"));
				preparedFileRef.current = resolvedFilePath;
			}
			const nextUploadId = crypto.randomUUID();
			setUploadId(nextUploadId);
			setPhase("uploading");
			const result = await window.electronAPI.cloudShareUpload({
				filePath: resolvedFilePath,
				endpoint: DEFAULT_CLOUD_ENDPOINT,
				token: authToken,
				title: projectTitle,
				notes: notes.trim() || undefined,
				uploadId: nextUploadId,
			});
			if (!result.success || !result.shareUrl) {
				if (!result.canceled) setError(result.error || t("editor.cloud.uploadFailed"));
				return;
			}
			setProgress(100);
			setShareUrl(result.shareUrl);
			if (projectPath) {
				try {
					saveProjectShareLink(projectPath, result.shareUrl);
				} catch {
					toast.error("Share created, but its link could not be saved locally");
				}
			}
			toast.success(t("editor.cloud.linkCreated"));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setUploading(false);
			setPhase("idle");
			setUploadId(undefined);
		}
	}, [projectPath, authToken, filePath, notes, prepareFile, projectTitle, t]);

	const handleCancel = useCallback(async () => {
		cancelRequestedRef.current = true;
		if (phase === "preparing") onCancelPrepare?.();
		if (uploadId) await window.electronAPI.cloudShareCancel(uploadId);
	}, [onCancelPrepare, phase, uploadId]);

	const copyShareUrl = useCallback(async () => {
		if (!shareUrl) return;
		const copied = await copyToClipboard(shareUrl);
		if (copied) {
			setCopied(true);
			toast.success(t("editor.cloud.linkCopied"));
		} else {
			setCopied(false);
			toast.error(t("editor.cloud.copyFailed"));
		}
	}, [shareUrl, t]);

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
					<ShareNetwork className="h-4 w-4" />
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

					{shareUrl ? (
						<div className="space-y-4">
							<div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-400">
								<Check className="h-5 w-5 shrink-0" />
								{t("editor.cloud.ready")}
							</div>
							<div className="flex gap-2">
								<Input value={shareUrl} readOnly className="min-w-0" />
								<Button type="button" onClick={copyShareUrl} className="shrink-0">
									{copied ? (
										<Check className="h-4 w-4" />
									) : (
										<Copy className="h-4 w-4" />
									)}
									{copied ? t("editor.cloud.copied") : t("editor.cloud.copy")}
								</Button>
							</div>
							<Button
								type="button"
								variant="outline"
								onClick={() => void window.electronAPI.openExternalUrl(shareUrl)}
								className="w-full"
							>
								{t("editor.cloud.openPage")}
							</Button>
						</div>
					) : (
						<div className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="cloud-share-notes">{t("editor.cloud.notes")}</Label>
								<textarea
									id="cloud-share-notes"
									placeholder={t("editor.cloud.notesPlaceholder")}
									value={notes}
									onChange={(event) =>
										setNotes(event.target.value.slice(0, 2000))
									}
									disabled={uploading}
									className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
								/>
								<p className="text-right text-[11px] text-muted-foreground">
									{notes.length}/2000
								</p>
							</div>
							{uploading ? (
								<div className="space-y-2">
									<div className="h-2 overflow-hidden rounded-full bg-foreground/10">
										<div
											className="h-full bg-[#2563EB] transition-all"
											style={{ width: `${progress}%` }}
										/>
									</div>
									<p className="text-xs text-muted-foreground">
										{phase === "preparing"
											? t("editor.cloud.preparing")
											: t("editor.cloud.uploading", undefined, { progress })}
									</p>
								</div>
							) : null}
							{error ? <p className="text-sm text-destructive">{error}</p> : null}
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
									<Button type="button" onClick={() => void handleUpload()}>
										<CloudArrowUp className="h-4 w-4" />
										{t("editor.cloud.publish")}
									</Button>
								)}
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
