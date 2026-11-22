import { Alert, Button, Description, Modal } from "@heroui/react";
import { ArrowLeft, X } from "@phosphor-icons/react";
import type { User } from "@supabase/supabase-js";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useOptionalBilling } from "@/components/billing/BillingProvider";
import { LegalLinks } from "@/components/billing/LegalLinks";
import { SplitPricingContent } from "@/components/billing/SplitPricingModal";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { SignOut } from "@/components/ui/icons";
import { RecordlyDemoVideo } from "@/components/ui/RecordlyDemoVideo";
import { RecordlyMark } from "@/components/ui/RecordlyMark";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { captureAuthFailure, recordAuthEvent, type SignInAction } from "@/lib/auth/authDiagnostics";
import {
	getEnabledSignInProviders,
	type RecordlyOAuthProvider,
	sendSignInCode,
	signInWithEmail,
	signInWithSocial,
	signOutRecordly,
	verifySignInCode,
} from "@/lib/auth/recordlyAuth";
import { isMac } from "@/utils/platformUtils";
import {
	OnboardingBody,
	OnboardingFooter,
	OnboardingHeader,
	OnboardingHeroTitle,
	OnboardingLayout,
	OnboardingPrimaryAction,
	type OnboardingStage,
} from "./OnboardingLayout";
import { OnboardingPermissions } from "./OnboardingPermissions";
import { OnboardingSoundtrack } from "./OnboardingSoundtrack";
import { RecordlySignInFields, SIGN_IN_PROVIDER_CHECK_TIMEOUT_MS } from "./RecordlySignInFields";

const MotionDialog = motion.create(Modal.Dialog);
const pageIndex: Record<OnboardingStage, number> = { account: 0, permissions: 1, upgrade: 2 };

export type SignInReason = "account" | "share" | "reauthenticate";

type Props = {
	variant?: "compact" | "wide";
	onboarding?: boolean;
	signInOnly?: boolean;
	preview?: boolean;
	startWithPermissions?: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	reason?: SignInReason;
	authenticationVersion?: number;
	user: User | null;
	configured: boolean;
	callbackError?: string;
	onAuthenticated: () => void;
	recordingStart?: { disabled: boolean; onPress: () => void };
	finishDisabled?: boolean;
	onWindowClose?: () => void;
	onUnlockSavedSignIn?: () => void;
	requireSignIn?: boolean;
};

function friendlyAuthError(
	error: unknown,
	action: string,
	t: ReturnType<typeof useI18n>["t"],
	ot: ReturnType<typeof useScopedT>,
): string {
	const message = error instanceof Error ? error.message : String(error);
	if (/unsupported provider|provider is not enabled/i.test(message)) {
		if (action === "google") {
			return t("editor.cloud.googleUnavailable");
		}
		if (action === "azure")
			return ot("providerUnavailable", undefined, { provider: "Microsoft" });
		if (action === "apple") return ot("providerUnavailable", undefined, { provider: "Apple" });
		return t("editor.cloud.providerUnavailable");
	}
	return ot("signInFailed");
}

export function RecordlySignInDialog({
	variant = "compact",
	onboarding = false,
	signInOnly = false,
	preview = false,
	startWithPermissions = false,
	open,
	onOpenChange,
	user: signedInUser,
	reason = "account",
	authenticationVersion = 0,
	configured,
	callbackError,
	onAuthenticated,
	recordingStart,
	finishDisabled = false,
	onWindowClose,
	onUnlockSavedSignIn,
	requireSignIn = false,
}: Props) {
	const { t } = useI18n();
	const ot = useScopedT("onboarding");
	const billing = useOptionalBilling();
	const refreshBillingAfterSignIn = billing?.needsSignIn ? billing.refreshAfterSignIn : undefined;
	const [tourSignIn, setTourSignIn] = useState<{
		returnTo: "permissions" | "upgrade";
		authenticationVersion: number;
	}>();
	// A cached user or background refresh must not dismiss a requested sign-in.
	// Only a completed interactive sign-in can finish reauthentication.
	const reauthenticating = reason === "reauthenticate" || tourSignIn?.returnTo === "upgrade";
	const user = reauthenticating ? null : signedInUser;
	const showRecordingStart = Boolean(user && recordingStart);
	const [directSignInComplete, setDirectSignInComplete] = useState(false);
	const openedAuthenticationVersion = useRef<number | undefined>(undefined);
	useEffect(() => {
		if (!open) {
			openedAuthenticationVersion.current = undefined;
			return;
		}
		openedAuthenticationVersion.current ??= authenticationVersion;
		if (
			reason === "reauthenticate" &&
			signedInUser &&
			(authenticationVersion > openedAuthenticationVersion.current || directSignInComplete)
		)
			onAuthenticated();
	}, [open, reason, signedInUser, authenticationVersion, directSignInComplete, onAuthenticated]);
	const awaitingSignIn = useRef(false);
	const wide = onboarding || variant === "wide";
	const tour = onboarding && !signInOnly && !recordingStart;
	const [{ page, direction }, setPage] = useState<{ page: OnboardingStage; direction: number }>({
		page: "account",
		direction: 1,
	});
	const switchingAccount =
		tourSignIn?.returnTo === "permissions" ||
		(preview && tour && page === "account" && Boolean(user));
	const showSignInForm = !user || switchingAccount;
	const goTo = useCallback((next: OnboardingStage) => {
		setPage((current) =>
			current.page === next
				? current
				: { page: next, direction: pageIndex[next] > pageIndex[current.page] ? 1 : -1 },
		);
	}, []);
	const navigateTo = (next: OnboardingStage) => {
		if (next === "account" && page !== "account" && tour && !preview && user) {
			setEmail("");
			setDirectSignInComplete(false);
			setTourSignIn({ returnTo: "permissions", authenticationVersion });
		} else if (next !== "account") setTourSignIn(undefined);
		goTo(next);
	};
	const [permissionsReady, setPermissionsReady] = useState(false);
	const requiresSignIn = ((onboarding && !preview) || requireSignIn) && !user;
	const opened = useRef(false);
	// Only macOS grants capture permissions up front; Windows and Linux skip that page.
	// Start from the user agent so Windows and Linux never render the page, then confirm.
	const [needsPermissions, setNeedsPermissions] = useState(() =>
		/Macintosh|Mac OS X/i.test(navigator.userAgent),
	);
	useEffect(() => {
		let active = true;
		void isMac().then((mac) => {
			if (active) setNeedsPermissions(mac);
		});
		return () => {
			active = false;
		};
	}, []);
	const canViewPermissions = tour && (Boolean(user) || preview);
	const visiblePage = page === "permissions" && !needsPermissions ? "upgrade" : page;
	const stage = canViewPermissions ? visiblePage : "account";
	const permissions = stage === "permissions";
	const upgrade = stage === "upgrade";
	const canViewUpgrade = canViewPermissions && (permissionsReady || !needsPermissions);
	const backPage = upgrade && needsPermissions ? "permissions" : "account";
	const [email, setEmail] = useState("");
	const consent = { legalAccepted: true };

	const [busy, setBusy] = useState<string>();
	const [message, setMessage] = useState<string>();
	const [reportDiagnostic, setReportDiagnostic] = useState<string>();
	const [linkSent, setLinkSent] = useState(false);
	const [providers, setProviders] = useState<RecordlyOAuthProvider[]>([]);
	const [providersKnown, setProvidersKnown] = useState(false);

	useEffect(() => {
		if (!open || !configured || !showSignInForm || onUnlockSavedSignIn) return;
		const controller = new AbortController();
		const timeout = window.setTimeout(
			() => controller.abort(),
			SIGN_IN_PROVIDER_CHECK_TIMEOUT_MS,
		);
		setProvidersKnown(false);
		setProviders([]);
		void getEnabledSignInProviders(controller.signal)
			.then((enabled) => {
				if (!controller.signal.aborted) {
					setProviders(enabled);
					setProvidersKnown(true);
				}
			})
			.catch((error) => {
				// Allow sign-in attempts when provider availability could not be checked.
				if (!controller.signal.aborted) captureAuthFailure("provider-discovery", error);
			})
			.finally(() => {
				window.clearTimeout(timeout);
			});
		return () => {
			window.clearTimeout(timeout);
			controller.abort();
		};
	}, [open, configured, showSignInForm, onUnlockSavedSignIn]);

	useEffect(() => {
		if (open && callbackError) {
			setMessage(ot("signInFailed"));
			setReportDiagnostic(callbackError);
			setLinkSent(false);
		}
	}, [open, callbackError, ot]);

	useEffect(() => {
		if (!open) {
			opened.current = false;
			goTo("account");
			setPermissionsReady(false);
			awaitingSignIn.current = false;
			setTourSignIn(undefined);
			setDirectSignInComplete(false);
			setBusy(undefined);
			setMessage(undefined);
			setReportDiagnostic(undefined);
			setLinkSent(false);
		}
	}, [open, goTo]);

	useEffect(() => {
		if (!open || opened.current) return;
		opened.current = true;
		if (tour && user && !preview) goTo("permissions");
	}, [open, tour, user, preview, goTo]);

	const hasSignedInUser = Boolean(signedInUser);
	useEffect(() => {
		if (open && tour && startWithPermissions && hasSignedInUser) goTo("permissions");
	}, [open, tour, startWithPermissions, hasSignedInUser, goTo]);

	useEffect(() => {
		if (!open || recordingStart || reauthenticating) return;
		if (user && !tour) {
			onAuthenticated();
			return;
		}
		if (!user) awaitingSignIn.current = true;
		else if (awaitingSignIn.current) {
			awaitingSignIn.current = false;
			setMessage(undefined);
			setReportDiagnostic(undefined);
			if (tour) {
				if (!preview) goTo("permissions");
			} else onAuthenticated();
		}
	}, [open, user, onAuthenticated, tour, preview, goTo, recordingStart, reauthenticating]);

	useEffect(() => {
		if (
			!open ||
			!tourSignIn ||
			!signedInUser ||
			(!directSignInComplete && authenticationVersion <= tourSignIn.authenticationVersion)
		)
			return;
		awaitingSignIn.current = false;
		setDirectSignInComplete(false);
		setTourSignIn(undefined);
		setMessage(undefined);
		setReportDiagnostic(undefined);
		if (tourSignIn.returnTo === "upgrade") refreshBillingAfterSignIn?.();
		goTo(tourSignIn.returnTo);
	}, [
		open,
		tourSignIn,
		signedInUser,
		directSignInComplete,
		authenticationVersion,
		refreshBillingAfterSignIn,
		goTo,
	]);

	const run = async (label: SignInAction, action: () => Promise<unknown>) => {
		setBusy(label);
		setMessage(undefined);
		setReportDiagnostic(undefined);
		setLinkSent(false);
		recordAuthEvent(`sign-in-${label}`, "started");
		try {
			await action();
			recordAuthEvent(`sign-in-${label}`, "succeeded");
			return true;
		} catch (error) {
			setReportDiagnostic(captureAuthFailure(`sign-in-${label}`, error));
			setMessage(
				label === "verify" ? ot("invalidCode") : friendlyAuthError(error, label, t, ot),
			);
			return false;
		} finally {
			setBusy(undefined);
		}
	};

	const reduceMotion = useReducedMotion();
	const transition = { duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] as const };
	const reveal = {
		initial: { opacity: 0, y: reduceMotion ? 0 : 10 },
		animate: { opacity: 1, y: 0 },
		transition,
	};
	const carouselMotion = {
		enter: (direction: number) => ({
			opacity: reduceMotion ? 1 : 0,
			x: reduceMotion ? 0 : direction * 32,
		}),
		center: { opacity: 1, x: 0 },
		exit: (direction: number) => ({
			opacity: reduceMotion ? 1 : 0,
			x: reduceMotion ? 0 : direction * -32,
			transition: { ...transition, duration: reduceMotion ? 0 : 0.18 },
		}),
	};
	const disabled = Boolean(busy);
	const SignInBody = onboarding ? OnboardingBody : Fragment;
	const signInContent = (
		<motion.div
			layout={onboarding ? false : "position"}
			transition={transition}
			className={
				onboarding
					? "recordly-signin-content flex shrink-0 flex-col"
					: `recordly-signin-content recordly-signin-content-popup flex shrink-0 flex-col justify-center ${wide ? "md:order-1 md:min-w-0" : ""}`
			}
		>
			<SignInBody>
				<div
					className={
						onboarding
							? "recordly-signin-controls @container"
							: "recordly-signin-controls w-full max-w-[420px] self-center @container"
					}
				>
					<motion.div
						{...reveal}
						transition={{ ...transition, delay: reduceMotion ? 0 : 0.1 }}
					>
						{onboarding ? (
							<OnboardingHeader
								centered={preview || showSignInForm || showRecordingStart}
								title={
									!showSignInForm && !preview && !showRecordingStart ? (
										ot("yourAccount")
									) : (
										<OnboardingHeroTitle text={ot("welcomeTitle")} />
									)
								}
								description={
									user && !showSignInForm && !showRecordingStart
										? user.email || ot("signedIn")
										: undefined
								}
							/>
						) : (
							<Modal.Header className="recordly-signin-header items-center gap-2 p-0 text-center">
								<Modal.Heading className="heading-display">
									<OnboardingHeroTitle text={ot("signInTitle")} />
								</Modal.Heading>
							</Modal.Header>
						)}
					</motion.div>
					{showRecordingStart && recordingStart ? (
						<div data-signin-fields className="recordly-signin-start">
							<p
								role="status"
								className="grid place-items-center text-center text-sm text-muted"
							>
								{ot("signedIn")}
							</p>
							<Button
								variant="primary"
								className="col-start-1 row-start-3 h-11 w-full gap-2 rounded-xl"
								isDisabled={recordingStart.disabled}
								onPress={recordingStart.onPress}
							>
								<RecordlyMark className="text-white" />
								{ot("startRecording")}
							</Button>
						</div>
					) : onUnlockSavedSignIn ? (
						<div className="flex flex-col gap-3">
							<Alert status="warning" role="alert">
								<Alert.Indicator />
								<Alert.Content>
									<Alert.Title>{ot("unlockSavedSignIn")}</Alert.Title>
									<Alert.Description>
										{ot("unlockSavedSignInHelp")}
									</Alert.Description>
								</Alert.Content>
							</Alert>
							<Button className="w-full" onPress={onUnlockSavedSignIn}>
								{ot("restartToUnlockSignIn")}
							</Button>
						</div>
					) : !showSignInForm && onboarding ? null : !showSignInForm ? (
						<Button
							variant="secondary"
							className="w-full"
							isDisabled={disabled}
							onPress={() =>
								void run("signout", async () => {
									await signOutRecordly();
									onOpenChange(false);
								})
							}
						>
							<SignOut className="size-4" />
							{busy === "signout"
								? t("editor.cloud.signingOut")
								: t("editor.cloud.signOut")}
						</Button>
					) : (
						<>
							<RecordlySignInFields
								email={email}
								onEmailChange={(value) => {
									setEmail(value);
									setLinkSent(false);
									setMessage(undefined);
								}}
								onRequestCode={(captchaToken) =>
									run("code", () =>
										sendSignInCode(email.trim(), consent, captchaToken),
									)
								}
								onVerifyCode={(targetEmail, code) =>
									run("verify", async () => {
										await verifySignInCode(targetEmail, code);
										setDirectSignInComplete(true);
									})
								}
								onPasswordSignIn={(password, captchaToken) =>
									run("password", async () => {
										await signInWithEmail(email.trim(), password, captchaToken);
										setDirectSignInComplete(true);
									})
								}
								onProvider={(provider) =>
									void run(provider, () =>
										signInWithSocial(provider, consent, {
											selectAccount: switchingAccount,
										}),
									)
								}
								providers={providers}
								providersKnown={providersKnown}
								configured={configured}
								busy={busy}
								compact={onboarding}
								assetBase={import.meta.env.BASE_URL}
								labels={{
									checkInbox: ot("checkInbox"),
									code: ot("code"),
									verifyCode: ot("verifyCode"),
									verifyingCode: ot("verifyingCode"),
									resendCode: ot("resendCode"),
									resendIn: ot("resendIn"),
									changeEmail: ot("changeEmail"),
									usePassword: ot("usePassword"),
									usePasswordLink: ot("usePasswordLink"),
									useCode: ot("useCode"),
									password: ot("password"),
									signingIn: ot("signingIn"),
									passwordHelp: ot("passwordHelp"),
									botChecking: ot("botChecking"),
									botFailed: ot("botFailed"),
									botRetry: ot("botRetry"),
									botTitle: ot("botTitle"),
									continueWith: (provider) =>
										ot("continueWith", undefined, { provider }),
									providerDisabled: (provider) =>
										ot("providerDisabled", undefined, { provider }),
									continueEmail: ot("continueEmail"),
									email: ot("email"),
									emailPlaceholder: ot("emailPlaceholder"),
									invalidEmail: t("editor.cloud.enterEmail"),
									sendingLink: ot("sendingLink"),
									sendLink: ot("sendLink"),
								}}
							/>
						</>
					)}
					{message && !showRecordingStart ? (
						<Alert
							role={linkSent ? "status" : "alert"}
							status={linkSent ? "success" : "danger"}
						>
							<Alert.Indicator />
							<Alert.Content>
								<Alert.Description>{message}</Alert.Description>
								{!linkSent && (
									<ErrorReportButton
										error={reportDiagnostic ?? message}
										context="sign-in"
									/>
								)}
							</Alert.Content>
						</Alert>
					) : null}
					{!configured && !user && (!(onboarding && preview) || reauthenticating) && (
						<Description role="status">{t("editor.cloud.unavailable")}</Description>
					)}
				</div>
				<LegalLinks consent />
			</SignInBody>
		</motion.div>
	);
	return (
		<Modal
			isOpen={open}
			onOpenChange={(value) => {
				if (value || !requiresSignIn) onOpenChange(value);
			}}
		>
			<Modal.Backdrop
				variant="blur"
				isDismissable={!requiresSignIn}
				isKeyboardDismissDisabled={requiresSignIn}
			>
				<Modal.Container
					size="cover"
					placement="center"
					className={onboarding ? "p-0" : "p-4 sm:p-8"}
				>
					<MotionDialog
						layout={!onboarding}
						transition={transition}
						aria-label={onboarding ? ot("welcomeLabel") : ot("signInLabel")}
						data-onboarding-state={
							onboarding
								? showRecordingStart
									? "ready"
									: stage === "account"
										? "login"
										: stage
								: undefined
						}
						className={
							onboarding
								? "relative h-full min-h-0 w-full max-w-none gap-0 overflow-hidden rounded-none p-0"
								: `recordly-signin-dialog h-auto min-h-0 w-full max-h-[calc(100dvh-32px)] gap-0 p-2 ${wide ? "recordly-signin-dialog-wide max-w-[1120px] md:grid md:grid-cols-2 md:aspect-[28/19]" : "max-w-[600px]"}`
						}
					>
						{onboarding && onWindowClose && (
							<div
								aria-hidden="true"
								data-onboarding-window-drag
								className="onboarding-window-drag absolute left-0 right-12 top-0 z-30 h-8"
							/>
						)}
						{onboarding ? (
							<OnboardingLayout
								stage={stage}
								canViewPermissions={canViewPermissions}
								showPermissions={needsPermissions}
								canViewUpgrade={tour ? canViewUpgrade : undefined}
								showNavigation={!signInOnly && !recordingStart}
								footer={
									canViewPermissions && (
										<OnboardingFooter>
											<div
												className="flex min-w-0 flex-wrap items-center gap-1"
												data-onboarding-preview-actions={
													import.meta.env.DEV && preview
														? "true"
														: undefined
												}
											>
												<Button
													variant="ghost"
													className={
														stage === "account"
															? "invisible"
															: undefined
													}
													aria-hidden={stage === "account" || undefined}
													isDisabled={stage === "account"}
													aria-label={
														backPage === "permissions"
															? ot(
																	"backToPermissions",
																	"Back to permissions",
																)
															: ot("backToAccount")
													}
													onPress={() => navigateTo(backPage)}
												>
													<ArrowLeft size={16} /> {ot("back")}
												</Button>
												{import.meta.env.DEV && preview && (
													<Button
														variant="ghost"
														onPress={onAuthenticated}
													>
														{ot("skipOnboarding", "Skip onboarding")}
													</Button>
												)}
											</div>
											{upgrade ? (
												<Button
													variant="ghost"
													isDisabled={finishDisabled}
													onPress={onAuthenticated}
												>
													{ot(
														"skipAndStartRecording",
														"Skip and start recording",
													)}
												</Button>
											) : (
												<OnboardingPrimaryAction
													isDisabled={
														permissions ? !permissionsReady : disabled
													}
													onPress={() => {
														if (permissions && permissionsReady)
															navigateTo("upgrade");
														else if (!permissions)
															navigateTo("permissions");
													}}
												>
													{ot("next", "Next")}
												</OnboardingPrimaryAction>
											)}
										</OnboardingFooter>
									)
								}
								onStageChange={navigateTo}
							>
								<AnimatePresence
									initial={false}
									mode="popLayout"
									custom={direction}
								>
									<motion.div
										key={stage}
										custom={direction}
										variants={carouselMotion}
										initial="enter"
										animate="center"
										exit="exit"
										transition={transition}
										className={`col-start-1 row-start-1 flex min-h-0 flex-col ${stage !== "account" ? "h-full" : ""}`}
									>
										{upgrade ? (
											<OnboardingBody>
												<SplitPricingContent
													animateHeader={false}
													onSignIn={() => {
														setDirectSignInComplete(false);
														setTourSignIn({
															returnTo: "upgrade",
															authenticationVersion,
														});
														goTo("account");
													}}
												/>
											</OnboardingBody>
										) : permissions ? (
											<OnboardingPermissions
												showFooter={false}
												onReadyChange={setPermissionsReady}
												preview={preview}
											/>
										) : (
											signInContent
										)}
									</motion.div>
								</AnimatePresence>
							</OnboardingLayout>
						) : (
							<>
								{wide && (
									<div className="recordly-signin-artwork relative overflow-hidden rounded-2xl md:order-2 md:h-full md:min-h-0">
										<RecordlyDemoVideo className="absolute inset-0" />
									</div>
								)}
								{signInContent}
							</>
						)}
						{onWindowClose ? (
							<Button
								isIconOnly
								variant="ghost"
								aria-label={ot("closeWindow")}
								onPress={onWindowClose}
								className="onboarding-window-close absolute right-2 top-2 z-40 size-8 min-w-0 rounded-full bg-background/80"
							>
								<X size={16} aria-hidden="true" />
							</Button>
						) : (
							!requiresSignIn && (
								<Modal.CloseTrigger
									aria-label={t("common.actions.close")}
									className="z-20"
								/>
							)
						)}
						{onboarding && !signInOnly && open && <OnboardingSoundtrack />}
					</MotionDialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
