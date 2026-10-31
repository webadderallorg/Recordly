import {
	checkShareCapacity,
	RECORDING_LIMIT_MESSAGE,
	subscribeShareCapacityChanges,
} from "./shareCapacity";
import { SharedRecordings } from "./SharedRecordings";
import { saveProjectShareLink } from "./projectShareLinks";
import { useI18n } from "@/contexts/I18nContext";
import { Check } from "@/components/ui/icons";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Export, LinkSimple } from "@phosphor-icons/react";
import { Label } from "@/components/ui/label";

import { CLOUD_SHARE_ENDPOINT as DEFAULT_CLOUD_ENDPOINT } from "./endpoint";

type Props = {
	projectPath?: string | null;
	filePath?: string;
	projectTitle: string;
	prepareFile?: () => Promise<string | undefined>;
	preparationProgress?: number;
	onCancelPrepare?: () => void;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	hideTrigger?: boolean;
	authToken?: string;
	accountId?: string;
	inline?: boolean;
	onBusyChange?: (busy: boolean) => void;
	onRequestSignIn?: () => void;
};

export function CloudShareButton({
	projectPath,
	filePath,
	projectTitle,
	prepareFile,
	preparationProgress = 0,
	onCancelPrepare,
	open: controlledOpen,
	onOpenChange,
	hideTrigger = false,
	authToken,
	accountId,
	inline = false,
	onBusyChange,
	onRequestSignIn,
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
	const [capacityAvailable, setCapacityAvailable] = useState<boolean | null>(null);
	const [checkingCapacity, setCheckingCapacity] = useState(false);
	useEffect(() => {
		setCapacityAvailable(null);
		setCheckingCapacity(false);
		if (!authToken || !DEFAULT_CLOUD_ENDPOINT) return;
		let active = true;
		let generation = 0;
		const refresh = () => {
			const request = ++generation;
			setCheckingCapacity(true);
			void checkShareCapacity(DEFAULT_CLOUD_ENDPOINT, authToken)
				.then((available) => {
					if (active && request === generation) setCapacityAvailable(available);
				})
				.catch(() => {
					if (active && request === generation) setCapacityAvailable(null);
				})
				.finally(() => {
					if (active && request === generation) setCheckingCapacity(false);
				});
		};
		const unsubscribe = subscribeShareCapacityChanges(refresh);
		refresh();
		return () => {
			active = false;
			unsubscribe();
		};
	}, [authToken]);
	useEffect(() => {
		onBusyChange?.(uploading);
	}, [uploading, onBusyChange]);
	const [phase, setPhase] = useState<"idle" | "preparing" | "uploading">("idle");
	const [error, setError] = useState<string>();
	const [shareUrl, setShareUrl] = useState<string>();
	const [copied, setCopied] = useState(false);
	const previousAccountId = useRef(accountId);
	const accountVersion = useRef(0);
	useLayoutEffect(() => {
		if (previousAccountId.current === accountId) return;
		previousAccountId.current = accountId;
		accountVersion.current++;
		setError(undefined);
		setShareUrl(undefined);
		setCopied(false);
	}, [accountId]);
	const [notes, setNotes] = useState("");
	const preparedFileRef = useRef<string | undefined>(undefined);
	const cancelRequestedRef = useRef(false);
	const activeUploadId = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (phase === "preparing" && Number.isFinite(preparationProgress)) {
			setProgress((current) =>
				Math.max(current, Math.min(70, Math.round(preparationProgress * 0.7))),
			);
		}
	}, [phase, preparationProgress]);

	const discardPreparedFile = useCallback(() => {
		const preparedPath = preparedFileRef.current;
		preparedFileRef.current = undefined;
		if (preparedPath) void window.electronAPI.discardExportedTemp(preparedPath);
	}, []);

	useEffect(() => discardPreparedFile, [discardPreparedFile]);

	useEffect(() => {
		return window.electronAPI.onCloudShareProgress((next) => {
			if (next.uploadId !== activeUploadId.current) return;
			if (next.totalBytes <= 0 || !Number.isFinite(next.uploadedBytes)) return;
			setProgress((current) =>
				Math.max(
					current,
					Math.min(99, 70 + Math.round((next.uploadedBytes / next.totalBytes) * 29)),
				),
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
		// A generation also catches switching away and back to the same account.
		const uploadAccountVersion = accountVersion.current;
		const isCurrentAccount = () => uploadAccountVersion === accountVersion.current;
		setUploading(true);
		setProgress(0);
		setPhase("idle");
		cancelRequestedRef.current = false;
		setError(undefined);
		setShareUrl(undefined);
		try {
			if (!DEFAULT_CLOUD_ENDPOINT)
				throw new Error("Cloud sharing is not available in this build yet.");
			if (!authToken) throw new Error(t("editor.cloud.signInRequired"));
			const available = await checkShareCapacity(DEFAULT_CLOUD_ENDPOINT, authToken);
			if (!isCurrentAccount()) return;
			setCapacityAvailable(available);
			if (!available) throw new Error(RECORDING_LIMIT_MESSAGE);
			if (cancelRequestedRef.current) return;
			setPhase("preparing");
			let resolvedFilePath = filePath ?? preparedFileRef.current;
			if (!resolvedFilePath) {
				resolvedFilePath = await prepareFile?.();
				if (cancelRequestedRef.current || !isCurrentAccount()) {
					if (resolvedFilePath)
						void window.electronAPI.discardExportedTemp(resolvedFilePath);
					return;
				}
				if (!resolvedFilePath) throw new Error(t("editor.cloud.prepareFailed"));
				preparedFileRef.current = resolvedFilePath;
			}
			const nextUploadId = crypto.randomUUID();
			setUploadId(nextUploadId);
			activeUploadId.current = nextUploadId;
			setProgress(70);
			setPhase("uploading");
			const result = await window.electronAPI.cloudShareUpload({
				filePath: resolvedFilePath,
				endpoint: DEFAULT_CLOUD_ENDPOINT,
				token: authToken,
				title: projectTitle,
				notes: notes.trim() || undefined,
				uploadId: nextUploadId,
			});
			if (!isCurrentAccount()) return;
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
			if (!isCurrentAccount()) return;
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setUploading(false);
			setPhase("idle");
			setUploadId(undefined);
			activeUploadId.current = undefined;
		}
	}, [projectPath, authToken, filePath, notes, prepareFile, projectTitle, t]);

	const handleCancel = useCallback(async () => {
		cancelRequestedRef.current = true;
		if (phase === "preparing") onCancelPrepare?.();
		if (uploadId) await window.electronAPI.cloudShareCancel(uploadId);
	}, [onCancelPrepare, phase, uploadId]);

	const copyShareUrl = useCallback(async () => {
		if (!shareUrl) return;
		try {
			await navigator.clipboard.writeText(shareUrl);
			setCopied(true);
			toast.success(t("editor.cloud.linkCopied"));
		} catch {
			setCopied(false);
			toast.error(t("editor.cloud.copyFailed"));
		}
	}, [shareUrl, t]);

	const form = (
		<>
			{shareUrl ? (
				<Button type="button" size="lg" onClick={copyShareUrl} className="w-full">
					{copied ? <Check className="h-4 w-4" /> : <LinkSimple className="h-4 w-4" />}
					{copied ? t("editor.cloud.copied") : "Copy link"}
				</Button>
			) : (
				<div className="space-y-4">
					{!uploading && (
						<div className="space-y-2">
							<Label htmlFor="cloud-share-notes">{t("editor.cloud.notes")}</Label>
							<textarea
								id="cloud-share-notes"
								placeholder={t("editor.cloud.notesPlaceholder")}
								value={notes}
								onChange={(event) => setNotes(event.target.value.slice(0, 2000))}
								disabled={uploading}
								className="block h-20 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
							/>
							{!inline && (
								<p className="text-right text-[11px] text-muted-foreground">
									{notes.length}/2000
								</p>
							)}
						</div>
					)}
					{uploading ? (
						<div className="space-y-2">
							<div className="h-2 overflow-hidden rounded-full bg-foreground/10">
								<div
									className="h-full bg-[#2563EB] transition-all"
									style={{ width: `${progress}%` }}
								/>
							</div>
							<p className="text-xs text-muted-foreground">Uploading · {progress}%</p>
						</div>
					) : null}
					{error || capacityAvailable === false ? (
						<p className="text-sm text-destructive">
							{error || RECORDING_LIMIT_MESSAGE}
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
									(checkingCapacity || capacityAvailable === false)
								}
								onClick={() => {
									if (!authToken && onRequestSignIn) onRequestSignIn();
									else void handleUpload();
								}}
							>
								<Export className="h-4 w-4" />
								{authToken ? "Share" : "Sign in to share"}
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
						<p className="text-xs text-muted-foreground">
							Free-plan links expire after 14 days.
						</p>
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
