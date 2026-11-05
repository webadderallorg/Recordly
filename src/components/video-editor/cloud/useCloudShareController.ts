import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/contexts/I18nContext";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { Props } from "./cloudShareProps";
import { CLOUD_SHARE_ENDPOINT as DEFAULT_CLOUD_ENDPOINT } from "./endpoint";
import {
	getProjectShare,
	isDeletedProjectShareLink,
	isProjectShareStale,
	type ProjectShareLink,
	saveProjectShareLink,
	subscribeDeletedProjectShareLinks,
} from "./projectShareLinks";
import {
	checkShareCapacity,
	notifyShareCapacityChanged,
	RECORDING_LIMIT_MESSAGE,
} from "./shareCapacity";
import { useCloudShareCapacity } from "./useCloudShareCapacity";
export function useCloudShareController(props: Props) {
	const {
		projectRevision,
		existingShareUrl,
		linkIsStale,
		projectPath,
		filePath,
		projectTitle,
		prepareFile,
		preparationProgress = 0,
		onCancelPrepare,
		open: controlledOpen,
		onOpenChange,
		authToken,
		accountId,
		inline = false,
		onBusyChange,
	} = props;

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

	useEffect(() => {
		onBusyChange?.(uploading);
	}, [uploading, onBusyChange]);

	const [phase, setPhase] = useState<"idle" | "preparing" | "uploading">("idle");

	const [error, setError] = useState<string>();

	const [shareUrl, setShareUrl] = useState<string>();

	const [savedShare, setSavedShare] = useState<ProjectShareLink>();

	useLayoutEffect(
		() =>
			subscribeDeletedProjectShareLinks((url) => {
				setShareUrl((current) => (current === url ? undefined : current));
				setSavedShare((current) => (current?.url === url ? undefined : current));
			}),
		[],
	);

	const needsRegenerate = linkIsStale ?? isProjectShareStale(savedShare, projectRevision);

	const uploadLock = useRef(false);

	const [copied, setCopied] = useState(false);

	const shareLinkInput = useRef<HTMLInputElement>(null);

	const preparedFileRef = useRef<string | undefined>(undefined);

	const cancelRequestedRef = useRef(false);

	const activeUploadId = useRef<string | undefined>(undefined);

	const activeUploadAccountVersion = useRef<number | undefined>(undefined);

	const preparationLifecycle = useRef({ phase, onCancelPrepare });

	useLayoutEffect(() => {
		preparationLifecycle.current = { phase, onCancelPrepare };
	}, [phase, onCancelPrepare]);

	const previousIdentity = useRef(`${accountId ?? ""}:${projectPath ?? ""}`);

	const accountVersion = useRef(0);

	useLayoutEffect(() => {
		const identity = `${accountId ?? ""}:${projectPath ?? ""}`;
		if (previousIdentity.current !== identity) {
			previousIdentity.current = identity;
			accountVersion.current++;
			if (uploadLock.current) {
				// Cancel the actual publication, not just its eventual UI result.
				cancelRequestedRef.current = true;
				if (phase === "preparing") onCancelPrepare?.();
				const id = activeUploadId.current;
				if (id) void window.electronAPI.cloudShareCancel(id).catch(() => undefined);
			}
			setError(undefined);
			setShareUrl(undefined);
			setSavedShare(undefined);
			setCopied(false);
		}
	}, [projectPath, accountId, phase, onCancelPrepare]);

	useLayoutEffect(() => {
		if (uploadLock.current || (!inline && !open)) return;
		const saved = projectPath ? getProjectShare(projectPath, accountId) : undefined;
		setSavedShare(saved);
		const candidate = existingShareUrl ?? saved?.url;
		const url = candidate && !isDeletedProjectShareLink(candidate) ? candidate : undefined;
		setShareUrl(url);
		if (url) setProgress(100);
	}, [projectPath, accountId, existingShareUrl, open, inline]);

	const [title, setTitle] = useState(projectTitle);

	useEffect(() => setTitle(projectTitle), [projectTitle]);

	const [notes, setNotes] = useState("");
	const {
		setCapacityAvailable,
		checkingCapacity,
		capacityError,
		capacityIdentity,
		setCapacityIdentity,
		currentCapacityIdentity,
		verifiedCapacity,
		signInRequired,
		sessionRecovery,
		recoverSession,
		latestAuthToken,
	} = useCloudShareCapacity({
		authToken,
		accountId,
		accountVersion,
		uploadId,
		activeUploadAccountVersion,
		activeUploadId,
		uploading,
	});

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

	useLayoutEffect(
		() => () => {
			// Invalidate awaited quota/export work before it can dispatch a new
			// upload after this component has left the editor.
			accountVersion.current++;
			cancelRequestedRef.current = true;
			if (preparationLifecycle.current.phase === "preparing")
				preparationLifecycle.current.onCancelPrepare?.();
			discardPreparedFile();
			const id = activeUploadId.current;
			if (id) void window.electronAPI.cloudShareCancel(id).catch(() => undefined);
		},
		[discardPreparedFile],
	);

	useEffect(() => {
		return window.electronAPI.onCloudShareProgress((next) => {
			if (
				next.uploadId !== activeUploadId.current ||
				activeUploadAccountVersion.current !== accountVersion.current
			)
				return;
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
		if (uploadLock.current) return;
		uploadLock.current = true;
		// A generation also catches switching away and back to the same account.
		const uploadAccountVersion = accountVersion.current;
		const previousUrl = shareUrl;
		let completed = false;
		const isCurrentAccount = () => uploadAccountVersion === accountVersion.current;
		setUploading(true);
		setProgress(0);
		setPhase("idle");
		cancelRequestedRef.current = false;
		setError(undefined);
		setShareUrl(undefined);
		try {
			if (!DEFAULT_CLOUD_ENDPOINT)
				throw new Error(
					t(
						"editor.cloud.sharingUnavailable",
						"Cloud sharing is not available in this build yet.",
					),
				);
			if (!authToken) throw new Error(t("editor.cloud.signInRequired"));
			const available = await checkShareCapacity(
				DEFAULT_CLOUD_ENDPOINT,
				authToken,
				recoverSession,
			);
			if (!isCurrentAccount()) return;
			setCapacityAvailable(available);
			setCapacityIdentity(currentCapacityIdentity);
			if (!available)
				throw new Error(t("editor.cloud.recordingLimit", RECORDING_LIMIT_MESSAGE));
			if (cancelRequestedRef.current) return;
			const nextUploadId = crypto.randomUUID();
			setUploadId(nextUploadId);
			activeUploadId.current = nextUploadId;
			activeUploadAccountVersion.current = uploadAccountVersion;
			setPhase("preparing");
			let resolvedFilePath = filePath ?? preparedFileRef.current;
			if (!resolvedFilePath && window.electronAPI.cloudShareBeginExport) {
				// Arm the main-process observer before the exporter opens its output.
				await window.electronAPI
					.cloudShareBeginExport({
						endpoint: DEFAULT_CLOUD_ENDPOINT,
						token: latestAuthToken.current ?? authToken,
						title: title.trim() || projectTitle,
						uploadId: nextUploadId,
					})
					.catch(() => undefined);
				if (cancelRequestedRef.current || !isCurrentAccount()) return;
			}
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
			setProgress((current) => Math.max(current, 70));
			setPhase("uploading");
			const result = await window.electronAPI.cloudShareUpload({
				filePath: resolvedFilePath,
				endpoint: DEFAULT_CLOUD_ENDPOINT,
				token: latestAuthToken.current,
				title: title.trim() || projectTitle,
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
			completed = true;
			setSavedShare({
				url: result.shareUrl,
				sharedAt: Date.now(),
				revision: projectRevision,
				accountId,
			});
			notifyShareCapacityChanged();
			if (projectPath) {
				try {
					saveProjectShareLink(projectPath, result.shareUrl, {
						revision: projectRevision,
						accountId,
					});
				} catch {
					toast.error(
						t(
							"editor.cloud.saveLinkFailed",
							"Share created, but its link could not be saved locally",
						),
					);
				}
			}
			toast.success(t("editor.cloud.linkCreated"));
		} catch (cause) {
			if (!isCurrentAccount()) return;
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (
				!completed &&
				previousUrl &&
				!isDeletedProjectShareLink(previousUrl) &&
				isCurrentAccount()
			) {
				setShareUrl(previousUrl);
				setProgress(100);
			}
			const id = activeUploadId.current;
			if (id) void window.electronAPI.cloudShareCancel(id).catch(() => undefined);
			uploadLock.current = false;
			setUploading(false);
			setPhase("idle");
			setUploadId(undefined);
			activeUploadId.current = undefined;
			activeUploadAccountVersion.current = undefined;
		}
	}, [
		projectPath,
		projectRevision,
		accountId,
		shareUrl,
		authToken,
		filePath,
		notes,
		prepareFile,
		projectTitle,
		title,
		t,
		currentCapacityIdentity,
		recoverSession,
		latestAuthToken,
		setCapacityAvailable,
		setCapacityIdentity,
	]);

	const handleCancel = useCallback(async () => {
		cancelRequestedRef.current = true;
		if (phase === "preparing") onCancelPrepare?.();
		if (uploadId) await window.electronAPI.cloudShareCancel(uploadId);
	}, [onCancelPrepare, phase, uploadId]);

	const copyShareUrl = useCallback(async () => {
		if (!shareUrl) return;
		try {
			await copyTextToClipboard(shareUrl);
			setCopied(true);
			toast.success(t("editor.cloud.linkCopied"));
		} catch {
			setCopied(false);
			shareLinkInput.current?.focus();
			shareLinkInput.current?.select();
			toast.error(t("editor.cloud.copyFailed"), { copyable: false });
		}
	}, [shareUrl, t]);
	return {
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
	};
}
