import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Description, Modal, Surface } from "@heroui/react";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	Cursor,
	Monitor,
	Play,
	ShareNetwork,
	ShieldCheck,
} from "@phosphor-icons/react";

const steps = [
	{ name: "Record", key: "record", icon: Monitor, color: "from-sky-100 to-blue-200" },
	{ name: "Preview", key: "preview", icon: Play, color: "from-violet-100 to-indigo-200" },
	{ name: "Share", key: "share", icon: ShareNetwork, color: "from-rose-100 to-orange-100" },
] as const;

type Step = (typeof steps)[number]["key"];
// Optional clips are bundled only when provided. Missing clips use illustrations, without 404s.
const clips = import.meta.glob<string>("/src/assets/onboarding/{record,preview,share}.mp4", {
	eager: true,
	query: "?url",
	import: "default",
});

function StepTile({
	step,
	src,
	reduceMotion,
}: {
	step: (typeof steps)[number];
	src?: string;
	reduceMotion: boolean;
}) {
	const [failed, setFailed] = useState(false);
	const player = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		if (!src) return;
		if (reduceMotion) player.current?.pause();
		else void player.current?.play().catch(() => undefined);
	}, [reduceMotion, src]);
	const Icon = step.icon;
	return (
		<div className="min-w-0 flex-1 text-center">
			<div
				className={`relative flex aspect-square items-center justify-center overflow-hidden rounded-[24px] border border-black/5 bg-gradient-to-br ${step.color}`}
			>
				<Icon aria-hidden="true" size={52} weight="duotone" className="text-zinc-700" />
				{src && !failed && (
					<video
						ref={player}
						aria-label={`${step.name} demonstration`}
						className="absolute inset-0 size-full object-cover"
						autoPlay={!reduceMotion}
						muted
						loop
						playsInline
						controls={Boolean(reduceMotion)}
						preload="metadata"
						onError={() => setFailed(true)}
					>
						<source src={src} type="video/mp4" onError={() => setFailed(true)} />
					</video>
				)}
			</div>
			<h3 className="mt-4 text-base font-semibold sm:text-lg">{step.name}</h3>
		</div>
	);
}

export function OnboardingFeature({
	onBack,
	onFinish,
	media = {},
}: {
	onBack: () => void;
	onFinish: () => void;
	media?: Partial<Record<Step, string>>;
}) {
	const [page, setPage] = useState<"checking" | "permissions" | "overview">("checking");
	const [reduceMotion, setReduceMotion] = useState(
		() => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	);
	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		const change = () => setReduceMotion(query.matches);
		query.addEventListener("change", change);
		return () => query.removeEventListener("change", change);
	}, []);
	const [screenGranted, setScreenGranted] = useState(false);
	const [accessibilityGranted, setAccessibilityGranted] = useState(false);
	const [busy, setBusy] = useState<string>();
	const [error, setError] = useState<string>();
	const refresh = useCallback(async () => {
		const [screen, accessibility] = await Promise.all([
			window.electronAPI.getScreenRecordingPermissionStatus(),
			window.electronAPI.getAccessibilityPermissionStatus(),
		]);
		if (!screen.success || !accessibility.success)
			throw new Error("Could not check permissions. Try again.");
		setScreenGranted(screen.status === "granted");
		setAccessibilityGranted(accessibility.trusted);
		setError(undefined);
		return screen.status === "granted" && accessibility.trusted;
	}, []);

	useEffect(() => {
		let disposed = false;
		void (async () => {
			try {
				const mac = (await window.electronAPI.getPlatform()) === "darwin";
				const granted = !mac || (await refresh());
				if (!disposed) setPage(granted ? "overview" : "permissions");
			} catch (error) {
				if (!disposed) {
					setError(String(error));
					setPage("permissions");
				}
			}
		})();
		return () => {
			disposed = true;
		};
	}, [refresh]);

	useEffect(() => {
		if (page !== "permissions") return;
		const check = () => {
			void refresh().catch((error) => setError(String(error)));
		};
		const visible = () => {
			if (document.visibilityState === "visible") check();
		};
		window.addEventListener("focus", check);
		document.addEventListener("visibilitychange", visible);
		return () => {
			window.removeEventListener("focus", check);
			document.removeEventListener("visibilitychange", visible);
		};
	}, [page, refresh]);

	const allow = async (permission: "screen" | "accessibility") => {
		if (busy) return;
		setBusy(permission);
		try {
			if (permission === "accessibility") {
				const result = await window.electronAPI.requestAccessibilityPermission();
				if (!result.success)
					throw new Error(result.error || "Could not request Accessibility access.");
				if (!result.trusted) {
					const opened = await window.electronAPI.openAccessibilityPreferences();
					if (!opened.success)
						throw new Error(opened.error || "Could not open System Settings.");
				}
			} else {
				const result = await window.electronAPI.openScreenRecordingPreferences();
				if (!result.success)
					throw new Error(result.error || "Could not open System Settings.");
			}
			await refresh();
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(undefined);
		}
	};

	return (
		<Surface className="absolute inset-0 flex flex-col justify-center overflow-y-auto px-6 py-10 sm:px-12 sm:py-12">
			{page === "checking" ? (
				<p role="status" className="text-center text-sm text-muted">
					Checking permissions…
				</p>
			) : page === "permissions" ? (
				<div className="mx-auto w-full max-w-[600px]">
					<ShieldCheck size={36} className="mb-5 text-accent" />
					<Modal.Header className="gap-3">
						<Modal.Heading className="text-3xl font-semibold tracking-tight">
							Allow Recordly to record
						</Modal.Heading>
						<Description className="text-sm leading-relaxed">
							Enable these permissions in macOS System Settings. Your screen is
							captured only when you start a recording.
						</Description>
					</Modal.Header>
					<div className="my-7 space-y-3">
						{[
							{
								key: "screen" as const,
								name: "Screen Recording",
								description: "Capture a screen, window or selected area.",
								granted: screenGranted,
								icon: Monitor,
							},
							{
								key: "accessibility" as const,
								name: "Accessibility",
								description: "Track your cursor and highlight clicks.",
								granted: accessibilityGranted,
								icon: Cursor,
							},
						].map(({ key, name, description, granted, icon: Icon }) => (
							<div
								key={key}
								className="flex items-center gap-4 rounded-2xl border border-separator p-4"
							>
								<Icon size={24} className="shrink-0 text-muted" />
								<div className="min-w-0 flex-1">
									<h3 className="text-sm font-semibold">{name}</h3>
									<p className="mt-1 text-xs text-muted">{description}</p>
								</div>
								{granted ? (
									<span className="flex shrink-0 items-center gap-1.5 text-xs text-success">
										<Check size={16} />
										Allowed
									</span>
								) : (
									<Button
										variant="secondary"
										isDisabled={Boolean(busy)}
										onPress={() => void allow(key)}
										aria-label={`Allow ${name}`}
									>
										{busy === key ? "Opening…" : "Allow"}
									</Button>
								)}
							</div>
						))}
					</div>
					<p className="text-xs leading-relaxed text-muted">
						Return here after enabling access. macOS may ask you to quit and reopen
						Recordly for Screen Recording changes to take effect. Microphone and camera
						access are requested when you use them.
					</p>
					{error && (
						<p role="alert" className="mt-3 text-sm text-danger">
							{error}
						</p>
					)}
					<Modal.Footer className="mt-7 gap-3">
						<Button
							variant="secondary"
							onPress={() => void refresh().catch((error) => setError(String(error)))}
						>
							Check again
						</Button>
						<Button
							isDisabled={!screenGranted || !accessibilityGranted || Boolean(busy)}
							onPress={() => setPage("overview")}
						>
							Continue
						</Button>
					</Modal.Footer>
				</div>
			) : (
				<div className="mx-auto w-full max-w-[780px]">
					<Modal.Header className="mb-8 items-center gap-2 text-center sm:mb-10">
						<Modal.Heading className="text-3xl font-semibold tracking-tight sm:text-4xl">
							Your next great recording
						</Modal.Heading>
					</Modal.Header>
					<div className="flex items-start gap-2 sm:gap-4">
						{steps.map((step, index) => (
							<div key={step.key} className="contents">
								<StepTile
									step={step}
									reduceMotion={reduceMotion}
									src={
										media[step.key] ??
										clips[`/src/assets/onboarding/${step.key}.mp4`]
									}
								/>
								{index < steps.length - 1 && (
									<div
										aria-hidden="true"
										className="flex aspect-square w-5 shrink-0 items-center justify-center self-center pb-10 sm:w-8"
									>
										<ArrowRight size={24} className="text-muted" />
									</div>
								)}
							</div>
						))}
					</div>
					<div className="mx-auto mt-8 max-w-[550px] text-center sm:mt-10">
						<Description className="text-sm leading-relaxed">
							Capture a moment, polish it in the preview, and share it with anyone.
							Recordly brings your screen, voice and camera together so your ideas are
							easy to follow.
						</Description>
					</div>
					<Modal.Footer className="mt-8 justify-center gap-3 sm:mt-10">
						<Button
							variant="secondary"
							isIconOnly
							aria-label="Back to sign in"
							onPress={onBack}
						>
							<ArrowLeft size={18} />
						</Button>
						<Button onPress={onFinish}>
							Start recording
							<ArrowRight size={18} />
						</Button>
					</Modal.Footer>
				</div>
			)}
		</Surface>
	);
}
