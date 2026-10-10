import { useCallback, useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { ArrowLeft, ArrowRight, Check, Cursor, Monitor } from "@phosphor-icons/react";
import { OnboardingBody, OnboardingFooter, OnboardingHeader } from "./OnboardingLayout";
import { PermissionsConfetti } from "./PermissionsConfetti";

export function OnboardingPermissions({
	onBack,
	onFinish,
}: {
	onBack: () => void;
	onFinish: () => void;
}) {
	const [platform, setPlatform] = useState<"checking" | "mac" | "other">("checking");
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
				if (mac) await refresh();
				if (!disposed) setPlatform(mac ? "mac" : "other");
			} catch (error) {
				if (!disposed) {
					setError(String(error));
					setPlatform("mac");
				}
			}
		})();
		return () => {
			disposed = true;
		};
	}, [refresh]);

	useEffect(() => {
		if (platform !== "mac") return;
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
	}, [platform, refresh]);
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
		<div className="onboarding-permissions relative flex min-h-0 flex-col">
			<PermissionsConfetti
				ready={platform === "mac" && screenGranted && accessibilityGranted && !error}
			/>
			<OnboardingBody scrollable={false}>
				{platform === "checking" ? (
					<p role="status" className="py-12 text-center text-sm text-muted">
						Checking permissions…
					</p>
				) : (
					<>
						<OnboardingHeader
							title="Allow Recordly to record"
							description={
								platform === "mac"
									? "Enable these permissions in macOS System Settings."
									: "Your screen is captured only when you start a recording. Microphone and camera access are requested when you use them."
							}
						/>
						{platform === "mac" && (
							<>
								<div className="space-y-3">
									{[
										{
											key: "screen" as const,
											name: "Screen Recording",
											description:
												"Capture a screen, window or selected area.",
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
											className="onboarding-permission-row flex items-center gap-3 rounded-2xl border border-separator p-4"
										>
											<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-accent">
												<Icon size={22} aria-hidden="true" />
											</div>
											<div className="min-w-0 flex-1">
												<h3 className="text-sm font-semibold">{name}</h3>
												<p className="mt-1 text-xs leading-relaxed text-muted">
													{description}
												</p>
											</div>
											{granted ? (
												<span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-success">
													<Check size={16} aria-hidden="true" />
													Allowed
												</span>
											) : (
												<Button
													variant="secondary"
													className="h-11 shrink-0 rounded-xl"
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
								<div className="onboarding-permission-help flex items-center gap-3">
									<p className="flex-1 text-xs leading-relaxed text-muted">
										{screenGranted && accessibilityGranted
											? "Your screen is captured only when you start recording. Microphone and camera access are requested when you use them."
											: "Return after enabling access. macOS may require restarting Recordly."}
									</p>
									{(!screenGranted || !accessibilityGranted) && (
										<Button
											variant="ghost"
											size="sm"
											className="shrink-0"
											isDisabled={Boolean(busy)}
											onPress={() =>
												void refresh().catch((error) =>
													setError(String(error)),
												)
											}
										>
											Check again
										</Button>
									)}
								</div>
								{error && (
									<p role="alert" className="text-sm text-danger">
										{error}
									</p>
								)}
							</>
						)}
					</>
				)}
			</OnboardingBody>
			<OnboardingFooter>
				<Button variant="ghost" aria-label="Back to account" onPress={onBack}>
					<ArrowLeft size={16} />
					Back
				</Button>
				<Button
					isDisabled={
						platform === "checking" ||
						(platform === "mac" &&
							(!screenGranted || !accessibilityGranted || Boolean(busy)))
					}
					onPress={onFinish}
				>
					Start recording <ArrowRight size={16} />
				</Button>
			</OnboardingFooter>
		</div>
	);
}
