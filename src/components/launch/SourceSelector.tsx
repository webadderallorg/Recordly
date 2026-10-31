import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import styles from "./LaunchWindow.module.css";

function OverlaySourceSelector() {
	const started = useRef(false);
	useEffect(() => {
		if (started.current) return;
		started.current = true;
		void window.electronAPI
			.pickCaptureTarget()
			.then((result) => {
				if (result.message && !result.canceled) toast.info(result.message);
				window.close();
			})
			.catch(() => {
				toast.error("Unable to open the source picker.");
				window.close();
			});
	}, []);
	return null;
}

function LinuxSourceList() {
	const [sources, setSources] = useState<ProcessedDesktopSource[]>([]);
	const [loading, setLoading] = useState(true);
	const [selecting, setSelecting] = useState(false);
	const [error, setError] = useState<string>();
	const refresh = useCallback(async () => {
		setLoading(true);
		setError(undefined);
		try {
			setSources(
				await window.electronAPI.getSources({
					types: ["screen", "window"],
					thumbnailSize: { width: 160, height: 90 },
					fetchWindowIcons: false,
				}),
			);
		} catch {
			setError("Could not load recording sources. Try refreshing the list.");
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	useEffect(() => {
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") window.close();
		};
		window.addEventListener("keydown", key);
		const unsubscribe = window.electronAPI.onRecordingStateChanged((state) => {
			if (state.recording) window.close();
		});
		return () => {
			window.removeEventListener("keydown", key);
			unsubscribe();
		};
	}, []);
	const select = async (source: ProcessedDesktopSource) => {
		if (selecting) return;
		setSelecting(true);
		setError(undefined);
		try {
			const selected = await window.electronAPI.selectSource(source);
			if (selected?.id !== source.id)
				throw new Error("Source selection is unavailable during recording.");
		} catch (error) {
			setError(error instanceof Error ? error.message : "Could not select that source.");
		} finally {
			setSelecting(false);
		}
	};
	return (
		<div className="flex h-screen flex-col overflow-hidden rounded-2xl border border-separator bg-surface text-foreground">
			<header className="flex shrink-0 items-center justify-between border-b border-separator p-4">
				<div className={styles.electronDrag}>
					<h1 className="text-lg font-semibold">Choose recording source</h1>
					<p className="mt-1 text-xs text-muted">
						Choose a screen or window. Recording starts from the recording controls.
					</p>
				</div>
				<Button variant="ghost" onClick={() => window.close()}>
					Cancel
				</Button>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto p-3">
				{error && (
					<p
						role="alert"
						className="mb-3 rounded-lg bg-danger/10 p-3 text-sm text-danger"
					>
						{error}
					</p>
				)}
				{loading ? (
					<p role="status" className="py-6 text-center text-sm text-muted">
						Loading sources…
					</p>
				) : sources.length === 0 ? (
					<p className="py-6 text-center text-sm text-muted">
						No recording sources found.
					</p>
				) : (
					["screen", "window"].map((kind) => {
						const entries = sources.filter((source) =>
							source.id.startsWith(`${kind}:`),
						);
						return (
							entries.length > 0 && (
								<section key={kind} className="mb-3">
									<h2 className="px-2 py-2 text-xs font-semibold text-muted">
										{kind === "screen" ? "Screens" : "Windows"}
									</h2>
									<div className="space-y-1">
										{entries.map((source) => (
											<Button
												key={source.id}
												variant="ghost"
												disabled={selecting}
												className="h-auto w-full justify-start gap-3 rounded-xl px-3 py-2 text-left"
												onClick={() => void select(source)}
											>
												{source.thumbnail && (
													<img
														src={source.thumbnail}
														alt=""
														className="h-12 w-20 shrink-0 rounded-lg object-cover"
													/>
												)}
												<span className="min-w-0 truncate">
													{source.name}
												</span>
											</Button>
										))}
									</div>
								</section>
							)
						);
					})
				)}
			</div>
			<footer className="flex shrink-0 justify-end border-t border-separator p-3">
				<Button
					variant="ghost"
					disabled={loading || selecting}
					onClick={() => void refresh()}
				>
					Refresh
				</Button>
			</footer>
		</div>
	);
}

export function SourceSelector() {
	const [platform, setPlatform] = useState<string>();
	useEffect(() => {
		void window.electronAPI.getPlatform().then(setPlatform);
	}, []);
	if (!platform) return null;
	return platform === "linux" ? <LinuxSourceList /> : <OverlaySourceSelector />;
}
