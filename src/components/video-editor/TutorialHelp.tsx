import { ArrowRight, ExternalLink, HelpCircle, Keyboard, MessageSquareMore, Scissors, Settings2, Twitter } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { formatBinding, SHORTCUT_ACTIONS, SHORTCUT_LABELS } from "@/lib/shortcuts";
import { formatShortcut } from "@/utils/platformUtils";
import { toast } from "sonner";

const RECORDLY_ISSUES_URL = "https://github.com/webadderall/Recordly/issues";
const RECORDLY_X_URL = "https://x.com/webadderall";
const CONTACT_EMAIL = "youngchen3442@gmail.com";
export const APP_HEADER_ACTION_BUTTON_CLASS = "h-7 px-2 text-xs text-slate-400 hover:bg-white/10 hover:text-slate-200 transition-all gap-1.5";

async function openExternalLink(url: string, errorMessage: string) {
	try {
		const result = await window.electronAPI.openExternalUrl(url);
		if (!result.success) {
			toast.error(result.error || errorMessage);
		}
	} catch (error) {
		toast.error(`${errorMessage} ${String(error)}`);
	}
}

export function FeedbackDialog() {
	const t = useScopedT("editor");

	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={APP_HEADER_ACTION_BUTTON_CLASS}
				>
					<MessageSquareMore className="h-3.5 w-3.5" />
					<span className="font-medium">{t("feedback.trigger", "Feedback")}</span>
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-lg bg-[#09090b] border-white/10 [&>button]:text-slate-400 [&>button:hover]:text-white">
				<DialogHeader>
					<DialogTitle className="text-xl font-semibold text-slate-200 flex items-center gap-2">
						<MessageSquareMore className="h-5 w-5 text-[#2563EB]" /> {t("feedback.title", "Feedback & contact")}
					</DialogTitle>
					<DialogDescription className="text-slate-400">
						{t("feedback.description", "Reach out directly or open an issue if something is broken or missing.")}
					</DialogDescription>
				</DialogHeader>
				<div className="mt-4 space-y-4">
					<div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
						<div className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/5 px-3 py-3">
							<div>
								<p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
									{t("feedback.emailLabel", "Email")}
								</p>
								<p className="mt-1 text-sm font-medium text-slate-100">{CONTACT_EMAIL}</p>
							</div>
							<Button
								type="button"
								variant="outline"
								onClick={() => void openExternalLink(`mailto:${CONTACT_EMAIL}`, t("feedback.openFailed", "Failed to open link."))}
								className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
							>
								<ExternalLink className="h-3.5 w-3.5" />
							</Button>
						</div>
						<div className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/5 px-3 py-3">
							<div>
								<p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
									{t("feedback.xLabel", "X")}
								</p>
								<p className="mt-1 text-sm font-medium text-slate-100">@webadderall</p>
							</div>
							<Button
								type="button"
								variant="outline"
								onClick={() => void openExternalLink(RECORDLY_X_URL, t("feedback.openFailed", "Failed to open link."))}
								className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
							>
								<Twitter className="h-3.5 w-3.5" />
							</Button>
						</div>
					</div>
					<Button
						type="button"
						variant="outline"
						onClick={() => void openExternalLink(RECORDLY_ISSUES_URL, t("feedback.openFailed", "Failed to open link."))}
						className="h-10 w-full justify-between border-white/10 bg-white/5 px-4 text-slate-200 hover:bg-white/10 hover:text-white"
					>
						<span className="flex items-center gap-2 text-sm font-medium">
							<MessageSquareMore className="h-4 w-4" />
							{t("feedback.reportIssue", "Report issue / send feedback")}
						</span>
						<ExternalLink className="h-3.5 w-3.5 text-slate-500" />
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function KeyboardShortcutsDialog() {
	const { shortcuts, isMac, openConfig } = useShortcuts();
	const t = useScopedT("editor");
	const [scrollLabels, setScrollLabels] = useState({
		pan: "Shift + Ctrl + Scroll",
		zoom: "Ctrl + Scroll",
	});

	useEffect(() => {
		Promise.all([
			formatShortcut(["shift", "mod", "Scroll"]),
			formatShortcut(["mod", "Scroll"]),
		]).then(([pan, zoom]) => setScrollLabels({ pan, zoom }));
	}, []);

	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={APP_HEADER_ACTION_BUTTON_CLASS}
				>
					<Keyboard className="h-3.5 w-3.5" />
					<span className="font-medium">{t("keyboardShortcuts.trigger", "Shortcuts")}</span>
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-lg bg-[#09090b] border-white/10 [&>button]:text-slate-400 [&>button:hover]:text-white">
				<DialogHeader>
					<DialogTitle className="text-xl font-semibold text-slate-200 flex items-center gap-2">
						<Keyboard className="h-5 w-5 text-[#2563EB]" /> {t("keyboardShortcuts.title")}
					</DialogTitle>
					<DialogDescription className="text-slate-400">
						{t("keyboardShortcuts.description", "Quick reference for the timeline and editor controls.")}
					</DialogDescription>
				</DialogHeader>
				<div className="mt-4 space-y-4">
					<div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2 text-xs">
						{SHORTCUT_ACTIONS.map((action) => (
							<div key={action} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/5 px-3 py-2.5">
								<span className="text-slate-300">{SHORTCUT_LABELS[action]}</span>
								<kbd className="rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[#2563EB]">
									{formatBinding(shortcuts[action], isMac)}
								</kbd>
							</div>
						))}
						<div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-3">
							<div className="rounded-lg border border-white/5 bg-white/5 px-3 py-2.5">
								<p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{t("keyboardShortcuts.panTimeline")}</p>
								<kbd className="mt-2 inline-flex rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[#2563EB]">
									{scrollLabels.pan}
								</kbd>
							</div>
							<div className="rounded-lg border border-white/5 bg-white/5 px-3 py-2.5">
								<p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{t("keyboardShortcuts.zoomTimeline")}</p>
								<kbd className="mt-2 inline-flex rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[#2563EB]">
									{scrollLabels.zoom}
								</kbd>
							</div>
							<div className="rounded-lg border border-white/5 bg-white/5 px-3 py-2.5">
								<p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{t("keyboardShortcuts.cycleAnnotations")}</p>
								<kbd className="mt-2 inline-flex rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[#2563EB]">
									{t("keyboardShortcuts.tab")}
								</kbd>
							</div>
						</div>
					</div>
					<div className="flex justify-end">
						<Button
							type="button"
							variant="outline"
							onClick={openConfig}
							className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
						>
							<Settings2 className="h-4 w-4" />
							{t("keyboardShortcuts.customize")}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function TutorialHelp() {
	const t = useScopedT("editor");

	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={APP_HEADER_ACTION_BUTTON_CLASS}
				>
					<HelpCircle className="w-3.5 h-3.5" />
					<span className="font-medium">{t("tutorial.howTrimmingWorks")}</span>
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-2xl bg-[#09090b] border-white/10 [&>button]:text-slate-400 [&>button:hover]:text-white">
				<DialogHeader>
					<DialogTitle className="text-xl font-semibold text-slate-200 flex items-center gap-2">
						<Scissors className="w-5 h-5 text-[#ef4444]" /> {t("tutorial.title")}
					</DialogTitle>
					<DialogDescription className="text-slate-400">
						{t("tutorial.understanding")}
					</DialogDescription>
				</DialogHeader>
				<div className="mt-4 space-y-8">
					{/* Explanation */}
					<div className="bg-white/5 rounded-lg p-4 border border-white/5">
						<p className="text-slate-300 leading-relaxed">
							{t("tutorial.descriptionP1")}
							<span className="text-[#ef4444] font-bold"> {t("tutorial.descriptionRemove")}</span>.{" "}
							{t("tutorial.descriptionP3")}
						</p>
					</div>
					{/* Visual Illustration */}
					<div className="space-y-2">
						<h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
							{t("tutorial.visualExample")}
						</h3>
						<div className="relative h-24 bg-[#000] rounded-lg border border-white/10 flex items-center px-4 overflow-hidden select-none">
							{/* Background track (Kept parts) */}
							<div className="absolute inset-x-4 h-2 bg-slate-600 rounded-full overflow-hidden">
								{/* Solid line representing video */}
							</div>
							{/* Removed Segment 1 */}
							<div
								className="absolute left-[20%] h-8 bg-[#ef4444]/20 border border-[#ef4444] rounded flex flex-col items-center justify-center z-10"
								style={{ width: "20%" }}
							>
								<span className="text-[10px] font-bold text-[#ef4444] bg-black/50 px-1 rounded">
									{t("tutorial.removed")}
								</span>
							</div>
							{/* Removed Segment 2 */}
							<div
								className="absolute left-[65%] h-8 bg-[#ef4444]/20 border border-[#ef4444] rounded flex flex-col items-center justify-center z-10"
								style={{ width: "15%" }}
							>
								<span className="text-[10px] font-bold text-[#ef4444] bg-black/50 px-1 rounded">
									{t("tutorial.removed")}
								</span>
							</div>
							{/* Labels for kept parts */}
							<div className="absolute left-[5%] text-[10px] text-slate-400 font-medium">
								{t("tutorial.kept")}
							</div>
							<div className="absolute left-[50%] text-[10px] text-slate-400 font-medium">
								{t("tutorial.kept")}
							</div>
							<div className="absolute left-[90%] text-[10px] text-slate-400 font-medium">
								{t("tutorial.kept")}
							</div>
						</div>
						<div className="flex justify-center mt-2">
							<ArrowRight className="w-4 h-4 text-slate-600 rotate-90" />
						</div>
						{/* Result */}
						<div className="relative h-12 bg-[#000] rounded-lg border border-white/10 flex items-center justify-center gap-1 px-4 select-none">
							<div
								className="h-8 bg-slate-700 rounded flex items-center justify-center opacity-80"
								style={{ width: "30%" }}
							>
								<span className="text-[10px] text-white font-medium">
									{t("tutorial.part", undefined, { number: "1" })}
								</span>
							</div>
							<div
								className="h-8 bg-slate-700 rounded flex items-center justify-center opacity-80"
								style={{ width: "30%" }}
							>
								<span className="text-[10px] text-white font-medium">
									{t("tutorial.part", undefined, { number: "2" })}
								</span>
							</div>
							<div
								className="h-8 bg-slate-700 rounded flex items-center justify-center opacity-80"
								style={{ width: "30%" }}
							>
								<span className="text-[10px] text-white font-medium">
									{t("tutorial.part", undefined, { number: "3" })}
								</span>
							</div>
							<span className="absolute right-4 text-xs text-slate-400">
								{t("tutorial.finalVideo")}
							</span>
						</div>
					</div>
					{/* Steps */}
					<div className="grid grid-cols-2 gap-4">
						<div className="p-3 rounded bg-white/5 border border-white/5">
							<div className="text-[#ef4444] font-bold mb-1">{t("tutorial.addTrimStep")}</div>
							<p className="text-xs text-slate-400">{t("tutorial.addTrimDesc")}</p>
						</div>
						<div className="p-3 rounded bg-white/5 border border-white/5">
							<div className="text-[#ef4444] font-bold mb-1">{t("tutorial.adjustStep")}</div>
							<p className="text-xs text-slate-400">{t("tutorial.adjustDesc")}</p>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
