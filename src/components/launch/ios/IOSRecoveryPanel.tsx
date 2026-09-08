import { useEffect, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import type { IOSRecoveryCandidate } from "@/shared/iosCaptureAPI";
export function IOSRecoveryPanel({ showEmpty = false }: { showEmpty?: boolean }) {
	const t = useScopedT("launch");
	const api = window.electronAPI?.iosCapture;
	const [candidates, setCandidates] = useState<readonly IOSRecoveryCandidate[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	useEffect(() => {
		let live = true;
		if (api)
			void api
				.getRecoveryCandidates()
				.then((result) => {
					if (live) setCandidates(result);
				})
				.catch(() => {
					if (live) setError(true);
				});
		return () => {
			live = false;
		};
	}, [api]);
	const act = async (action: () => Promise<unknown>) => {
		setBusy(true);
		setError(false);
		try {
			await action();
			if (api) setCandidates(await api.getRecoveryCandidates());
		} catch {
			setError(true);
		} finally {
			setBusy(false);
		}
	};
	if (!api || (!candidates.length && !error && !showEmpty)) return null;
	return (
		<section
			className="p-3 border-t border-[var(--launch-border)] text-sm space-y-2"
			aria-label={t("ios.recovery.title")}
		>
			<h3>{t("ios.recovery.title")}</h3>
			{showEmpty && !candidates.length && !error && <p>{t("ios.recovery.empty")}</p>}
			{error && <p role="alert">{t("ios.recovery.failed")}</p>}
			{candidates.map((candidate, index) => (
				<div key={candidate.sessionId} className="space-y-2">
					<p>
						{t("ios.recovery.take", undefined, { number: index + 1 })} ·{" "}
						{t(`ios.recovery.${candidate.status}`)}
					</p>
					<div className="flex flex-wrap gap-2">
						{candidate.status === "recoverable-av" && (
							<Button
								size="sm"
								disabled={busy}
								onClick={() =>
									void act(() => api.recover(candidate.sessionId, "with-audio"))
								}
							>
								{t("ios.recovery.recover")}
							</Button>
						)}
						{candidate.status !== "unrecoverable" && (
							<Button
								size="sm"
								variant="outline"
								disabled={busy}
								onClick={() =>
									void act(() => api.recover(candidate.sessionId, "video-only"))
								}
							>
								{t("ios.recovery.videoOnly")}
							</Button>
						)}
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() =>
								void act(() => api.openRecoveryFolder(candidate.sessionId))
							}
						>
							{t("ios.recovery.folder")}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() =>
								void act(() => api.exportDiagnostics(candidate.sessionId))
							}
						>
							{t("ios.recovery.diagnostics")}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() => void act(() => api.discardRecovery(candidate.sessionId))}
						>
							{t("ios.recovery.discard")}
						</Button>
					</div>
				</div>
			))}
		</section>
	);
}
