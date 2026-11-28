import { Button } from "@heroui/react";
import { ArrowLeft, Check } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { useScopedT } from "@/contexts/I18nContext";
import { saveAppSetting } from "@/lib/appSettings";
import {
	OnboardingBody,
	OnboardingFooter,
	OnboardingHeader,
	OnboardingPrimaryAction,
	OnboardingTitle,
} from "./OnboardingLayout";
import { PermissionsConfetti } from "./PermissionsConfetti";

type Permission = "screen" | "accessibility";

export function OnboardingPermissions({
	onBack,
	onFinish,
	preview = false,
	persistRequest = true,
	showFooter = true,
	onReadyChange,
}: {
	onBack?: () => void;
	onFinish?: () => void;
	preview?: boolean;
	persistRequest?: boolean;
	showFooter?: boolean;
	onReadyChange?: (ready: boolean) => void;
}) {
	const t = useScopedT("onboarding");
	const reduceMotion = useReducedMotion();
	const [platform, setPlatform] = useState<"checking" | "mac" | "other">("checking");
	const [screenGranted, setScreenGranted] = useState(false);
	const [accessibilityGranted, setAccessibilityGranted] = useState(false);
	const [simulatedMissing, setSimulatedMissing] = useState({
		screen: false,
		accessibility: false,
	});
	const [busy, setBusy] = useState<Permission>();
	const [allowClicked, setAllowClicked] = useState({ screen: false, accessibility: false });
	const [statusError, setStatusError] = useState<string>();
	const [requestError, setRequestError] = useState<string>();
	const error = requestError ?? statusError;
	const mounted = useRef(false);
	const refreshing = useRef(false);
	const canSimulate = import.meta.env.DEV && preview;
	useEffect(() => {
		if (!preview && persistRequest)
			saveAppSetting("recordly.onboarding.permissionsRequested", true);
	}, [preview, persistRequest]);
	// Preview resets only the displayed state; macOS remains the source of actual grants.
	const granted = {
		screen: screenGranted && !(canSimulate && simulatedMissing.screen),
		accessibility: accessibilityGranted && !(canSimulate && simulatedMissing.accessibility),
	};
	const preloadScreen = !granted.screen;
	const preloadAccessibility = !granted.accessibility;
	useEffect(() => {
		if (platform !== "mac") return;
		const permissions: Permission[] = [];
		if (preloadScreen) permissions.push("screen");
		if (preloadAccessibility) permissions.push("accessibility");
		void window.electronAPI.preloadPermissionAccessories(permissions).catch(() => undefined);
	}, [platform, preloadScreen, preloadAccessibility]);
	useEffect(() => {
		if (platform !== "mac") return;
		return () => {
			void window.electronAPI.preloadPermissionAccessories([]).catch(() => undefined);
		};
	}, [platform]);
	const canFinish =
		!statusError &&
		platform !== "checking" &&
		(platform !== "mac" || (granted.screen && granted.accessibility && !busy));
	useLayoutEffect(() => {
		onReadyChange?.(canFinish);
	}, [canFinish, onReadyChange]);
	const refresh = useCallback(async () => {
		if (refreshing.current) return;
		refreshing.current = true;
		try {
			const [screen, accessibility] = await Promise.all([
				window.electronAPI.getScreenRecordingPermissionStatus(),
				window.electronAPI.getAccessibilityPermissionStatus(),
			]);
			if (!mounted.current) return;
			if (!screen?.success || !accessibility?.success) throw new Error(t("checkFailed"));
			setScreenGranted(screen.status === "granted");
			setAccessibilityGranted(accessibility.trusted);
			setStatusError(undefined);
			if (screen.status === "granted" && accessibility.trusted) setRequestError(undefined);
		} finally {
			refreshing.current = false;
		}
	}, [t]);

	useEffect(() => {
		mounted.current = true;
		let disposed = false;
		void (async () => {
			try {
				const mac = (await window.electronAPI.getPlatform()) === "darwin";
				if (disposed) return;
				if (mac) await refresh();
				if (!disposed) setPlatform(mac ? "mac" : "other");
			} catch {
				if (!disposed) {
					setStatusError(t("checkFailed"));
					setPlatform("mac");
				}
			}
		})();
		return () => {
			mounted.current = false;
			disposed = true;
		};
	}, [refresh, t]);

	useEffect(() => {
		if (platform !== "mac") return;
		const check = () => {
			void refresh().catch(() => {
				if (mounted.current) setStatusError(t("checkFailed"));
			});
		};
		const visible = () => {
			if (document.visibilityState === "visible") check();
		};
		window.addEventListener("focus", check);
		document.addEventListener("visibilitychange", visible);
		const timer = window.setInterval(check, 3000);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("focus", check);
			document.removeEventListener("visibilitychange", visible);
		};
	}, [platform, refresh, t]);
	const allow = async (permission: Permission) => {
		if (busy) return;
		const testSetup = canSimulate && simulatedMissing[permission];
		setBusy(permission);
		try {
			if (allowClicked[permission]) {
				const result =
					await window.electronAPI.requestRecordingPermissionPrompt(permission);
				if (!result.success) throw new Error(t("permissionFailed"));
			} else {
				setAllowClicked((current) => ({ ...current, [permission]: true }));
				const opened = await (permission === "screen"
					? window.electronAPI.openScreenRecordingPreferences(testSetup || undefined)
					: window.electronAPI.openAccessibilityPreferences(testSetup || undefined));
				if (!opened.success) throw new Error(t("openSettingsFailed"));
				if (testSetup)
					setSimulatedMissing((current) => ({ ...current, [permission]: false }));
			}
			await refresh();
			setRequestError(undefined);
		} catch {
			setRequestError(t("permissionFailed"));
		} finally {
			setBusy(undefined);
		}
	};
	if (platform === "checking") return <div role="status">{t("checking")}</div>;

	const footer = showFooter && onFinish && (
		<OnboardingFooter>
			{onBack ? (
				<Button variant="ghost" aria-label={t("backToAccount")} onPress={onBack}>
					<ArrowLeft size={16} />
					{t("back")}
				</Button>
			) : (
				<div />
			)}
			<OnboardingPrimaryAction isDisabled={!canFinish} onPress={onFinish}>
				{t("startRecording")}
			</OnboardingPrimaryAction>
		</OnboardingFooter>
	);

	// Windows and Linux choose a capture source after opening the recording HUD.
	if (platform === "other")
		return (
			<>
				<OnboardingBody scrollable={false}>
					<OnboardingHeader
						centered
						title={<OnboardingTitle text={t("welcomeTitle")} />}
						description={t(preview ? "otherDescription" : "signedIn")}
					/>
				</OnboardingBody>
				{footer}
			</>
		);

	return (
		<div
			className="onboarding-permissions relative flex h-full min-h-0 flex-col"
			aria-busy={Boolean(busy)}
		>
			<PermissionsConfetti ready={canFinish} />
			<OnboardingBody>
				<OnboardingHeader centered title={<OnboardingTitle text={t("allowTitle")} />} />
				{canSimulate && (
					<div
						className="flex flex-wrap items-center gap-2 text-xs text-muted"
						data-permission-preview-controls
					>
						<Button
							variant="secondary"
							size="sm"
							isDisabled={Boolean(busy)}
							onPress={() => {
								setSimulatedMissing({ screen: true, accessibility: true });
								setAllowClicked({ screen: false, accessibility: false });
								setRequestError(undefined);
								setStatusError(undefined);
							}}
						>
							{t("simulatePermissions", "Simulate permissions")}
						</Button>
					</div>
				)}
				<div className="onboarding-permission-list">
					{[
						{
							key: "screen" as const,
							name: t("screen"),
							description: t("screenDescription"),
							granted: granted.screen,
						},
						{
							key: "accessibility" as const,
							name: t("accessibility"),
							description: t("accessibilityDescription"),
							granted: granted.accessibility,
						},
					].map(({ key, name, description, granted }, index) => (
						<motion.div
							key={key}
							initial={reduceMotion ? false : { opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{
								duration: reduceMotion ? 0 : 0.3,
								delay: reduceMotion ? 0 : 0.1 + index * 0.07,
								ease: [0.22, 1, 0.36, 1],
							}}
							className="onboarding-permission-row"
						>
							<div className="min-w-0">
								<h3 className="text-base font-semibold">{name}</h3>
								<p className="mt-1.5 text-sm leading-relaxed text-muted">
									{description}
								</p>
							</div>
							<div className="onboarding-permission-action">
								{granted ? (
									<span
										role="status"
										aria-live="polite"
										aria-label={`${name}: ${t("allowed")}`}
										className="onboarding-permission-granted text-success"
									>
										<Check size={22} aria-hidden="true" />
										{t("allowed")}
									</span>
								) : (
									<Button
										variant="secondary"
										className="onboarding-permission-button w-full rounded-xl text-accent"
										isDisabled={Boolean(busy)}
										onPress={() => void allow(key)}
										aria-label={t(
											allowClicked[key]
												? "openPermissionPromptLabel"
												: "allowPermission",
											undefined,
											{
												permission: name,
											},
										)}
									>
										{allowClicked[key]
											? t("openPermissionPrompt")
											: t("allowPermission", undefined, { permission: name })}
									</Button>
								)}
							</div>
						</motion.div>
					))}
				</div>
				{error && (
					<p role="alert" className="text-sm text-danger">
						{error} <ErrorReportButton error={error} />
					</p>
				)}
			</OnboardingBody>
			{footer}
		</div>
	);
}
