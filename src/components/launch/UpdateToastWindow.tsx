import { Gift } from "lucide-react";
import { useEffect, useState } from "react";

type UpdateToastPayload = {
	version: string;
	detail: string;
	delayMs: number;
	isPreview?: boolean;
};

function formatDelayHours(delayMs: number) {
	const hours = Math.max(1, Math.round(delayMs / (60 * 60 * 1000)));
	return `${hours}h`;
}

export function UpdateToastWindow() {
	const [payload, setPayload] = useState<UpdateToastPayload | null>(null);

	useEffect(() => {
		let mounted = true;

		void window.electronAPI.getCurrentUpdateToastPayload().then((nextPayload) => {
			if (mounted) {
				setPayload(nextPayload);
			}
		});

		const dispose = window.electronAPI.onUpdateReadyToast((nextPayload) => {
			setPayload(nextPayload);
		});

		return () => {
			mounted = false;
			dispose();
		};
	}, []);

	if (!payload) {
		return <div className="h-full w-full bg-transparent" />;
	}

	return (
		<div className="flex h-full w-full items-center justify-center bg-transparent p-2">
			<div className="pointer-events-auto flex w-full max-w-[404px] items-start gap-3 rounded-[24px] border border-sky-300/20 bg-[#0d1117]/95 p-4 text-white shadow-2xl shadow-black/45 backdrop-blur-xl">
				<div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300">
					<Gift className="h-5 w-5" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<p className="text-sm font-semibold tracking-tight">
							{payload.isPreview ? "Update Toast Preview" : `Recordly ${payload.version} is ready`}
						</p>
						{payload.isPreview ? (
							<span className="rounded-full border border-sky-300/20 bg-sky-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-sky-200">
								Dev
							</span>
						) : null}
					</div>
					<p className="mt-1 text-sm leading-5 text-white/70">{payload.detail}</p>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<button
							type="button"
							onClick={async () => {
								if (payload.isPreview) {
									await window.electronAPI.dismissUpdateToast();
									return;
								}

								await window.electronAPI.installDownloadedUpdate();
							}}
							className="rounded-xl bg-sky-400 px-3 py-2 text-xs font-semibold text-[#031a2c] transition-colors hover:bg-sky-300"
						>
							Update Now
						</button>
						<button
							type="button"
							onClick={async () => {
								if (payload.isPreview) {
									await window.electronAPI.dismissUpdateToast();
									return;
								}

								await window.electronAPI.deferDownloadedUpdate(payload.delayMs);
								await window.electronAPI.dismissUpdateToast();
							}}
							className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/85 transition-colors hover:bg-white/10"
						>
							Update Later ({formatDelayHours(payload.delayMs)})
						</button>
						<button
							type="button"
							onClick={async () => {
								if (payload.isPreview) {
									await window.electronAPI.dismissUpdateToast();
									return;
								}

								await window.electronAPI.skipDownloadedUpdate(payload.version);
							}}
							className="rounded-xl border border-sky-300/15 bg-transparent px-3 py-2 text-xs font-medium text-white/65 transition-colors hover:bg-white/5 hover:text-white"
						>
							Skip This Version
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}