import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { Alert, Button, Description, Modal } from "@heroui/react";
import { ArrowLeft, X } from "@phosphor-icons/react";
import type { User } from "@supabase/supabase-js";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { LegalLinks } from "@/components/billing/LegalLinks";
import { SignOut } from "@/components/ui/icons";
import { RecordlyDemoVideo } from "@/components/ui/RecordlyDemoVideo";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { captureAuthFailure, recordAuthEvent, type SignInAction } from "@/lib/auth/authDiagnostics";
import {
	getEnabledSignInProviders,
	type RecordlyOAuthProvider,
	sendSignInCode,
	verifySignInCode,
	signInWithEmail,
	signInWithSocial,
	signOutRecordly,
} from "@/lib/auth/recordlyAuth";
import { RecordlySignInFields, SIGN_IN_PROVIDER_CHECK_TIMEOUT_MS } from "./RecordlySignInFields";
import { FirstBootMusic } from "./FirstBootMusic";
import {
	OnboardingBody,
	OnboardingFooter,
	OnboardingHeader,
	OnboardingLayout,
	OnboardingHeroTitle,
	OnboardingPrimaryAction,
} from "./OnboardingLayout";
import { OnboardingPermissions } from "./OnboardingPermissions";

const MotionDialog = motion.create(Modal.Dialog);

export type SignInReason = "account" | "share" | "reauthenticate";

type Props = {
	variant?: "compact" | "wide";
	onboarding?: boolean;
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
	onWindowClose?: () => void;
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
	onWindowClose,
	requireSignIn = false,
}: Props) {
	const { t } = useI18n();
	const ot = useScopedT("onboarding");
	// A cached user or background refresh must not dismiss a requested sign-in.
	// Only a completed interactive sign-in can finish reauthentication.
	const reauthenticating = reason === "reauthenticate";
	const user = reauthenticating ? null : signedInUser;
	const [directSignInComplete, setDirectSignInComplete] = useState(false);
	const openedAuthenticationVersion = useRef<number | undefined>(undefined);
	useEffect(() => {
		if (!open) {
			openedAuthenticationVersion.current = undefined;
			return;
		}
		openedAuthenticationVersion.current ??= authenticationVersion;
		if (
			reauthenticating &&
			signedInUser &&
			(authenticationVersion > openedAuthenticationVersion.current || directSignInComplete)
		)
			onAuthenticated();
	}, [
		open,
		reauthenticating,
		signedInUser,
		authenticationVersion,
		directSignInComplete,
		onAuthenticated,
	]);
	const awaitingSignIn = useRef(false);
	const wide = onboarding || variant === "wide";
	const [showPermissions, setShowPermissions] = useState(false);
	const [permissionsReady, setPermissionsReady] = useState(false);
	const requiresSignIn = ((onboarding && !preview) || requireSignIn) && !user;
	const opened = useRef(false);
	const canViewPermissions = Boolean(user) || preview;
	const permissions = onboarding && canViewPermissions && showPermissions;
	const [email, setEmail] = useState("");
	const consent = { legalAccepted: true };

	const [busy, setBusy] = useState<string>();
	const [message, setMessage] = useState<string>();
	const [reportDiagnostic, setReportDiagnostic] = useState<string>();
	const [linkSent, setLinkSent] = useState(false);
	const [providers, setProviders] = useState<RecordlyOAuthProvider[]>([]);
	const [loadingProviders, setLoadingProviders] = useState(configured);
	const [providersKnown, setProvidersKnown] = useState(false);

	useEffect(() => {
		if (!open || !configured || user) return;
		let disposed = false;
		const controller = new AbortController();
		const timeout = window.setTimeout(() => controller.abort(), SIGN_IN_PROVIDER_CHECK_TIMEOUT_MS);
		setLoadingProviders(true);
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
				if (!disposed) setLoadingProviders(false);
			});
		return () => {
			disposed = true;
			window.clearTimeout(timeout);
			controller.abort();
		};
	}, [open, configured, user]);

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
			setShowPermissions(false);
			awaitingSignIn.current = false;
			setDirectSignInComplete(false);
			setBusy(undefined);
			setMessage(undefined);
			setReportDiagnostic(undefined);
			setLinkSent(false);
		}
	}, [open]);

	useEffect(() => {
		if (!open || opened.current) return;
		opened.current = true;
		if (onboarding && user && !preview) setShowPermissions(true);
	}, [open, onboarding, user, preview]);

	useEffect(() => {
		if (open && startWithPermissions && user) setShowPermissions(true);
	}, [open, startWithPermissions, user]);

	useEffect(() => {
		if (!open) return;
		if (user && !onboarding) {
			onAuthenticated();
			return;
		}
		if (!user) awaitingSignIn.current = true;
		else if (awaitingSignIn.current) {
			awaitingSignIn.current = false;
			setMessage(undefined);
			setReportDiagnostic(undefined);
			if (onboarding) {
				// Restoring a cached session must not jump an optional tour away
				// from its account page. The real flow still advances after sign-in.
				if (!preview) setShowPermissions(true);
			} else onAuthenticated();
		}
	}, [open, user, onAuthenticated, onboarding, preview]);

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
								centered={preview || !user}
								title={
									user && !preview ? (
										ot("yourAccount")
									) : (
										<OnboardingHeroTitle text={ot("welcomeTitle")} />
									)
								}
								description={user ? user.email || ot("signedIn") : undefined}
							/>
						) : (
							<Modal.Header className="recordly-signin-header items-center gap-2 p-0 text-center">
								<Modal.Heading className="heading-display">
									<OnboardingHeroTitle text={ot("signInTitle")} />
								</Modal.Heading>
							</Modal.Header>
						)}
					</motion.div>
					{user && onboarding ? null : user ? (
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
									void run(provider, () => signInWithSocial(provider, consent))
								}
								providers={providers}
								loadingProviders={loadingProviders}
								providersKnown={providersKnown}
								configured={configured}
								busy={busy}
								compact={onboarding}
								assetBase={import.meta.env.BASE_URL}
								labels={{
									loadingProviders: ot("loadingProviders"),
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
					{message ? (
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
					{!configured && !user && (
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
							onboarding ? (permissions ? "permissions" : "login") : undefined
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
								stage={permissions ? "permissions" : "account"}
								canViewPermissions={canViewPermissions}
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
														permissions ? undefined : "invisible"
													}
													aria-hidden={!permissions || undefined}
													isDisabled={!permissions}
													aria-label={ot("backToAccount")}
													onPress={() => setShowPermissions(false)}
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
											<OnboardingPrimaryAction
												isDisabled={
													permissions ? !permissionsReady : disabled
												}
												onPress={() => {
													if (permissions) {
														if (permissionsReady) onAuthenticated();
													} else setShowPermissions(true);
												}}
											>
												{ot(permissions ? "startRecording" : "continue")}
											</OnboardingPrimaryAction>
										</OnboardingFooter>
									)
								}
								onStageChange={(stage) =>
									setShowPermissions(
										stage === "permissions" && canViewPermissions,
									)
								}
							>
								<AnimatePresence
									initial={false}
									mode="sync"
									custom={permissions ? 1 : -1}
								>
									<motion.div
										key={permissions ? "permissions" : "account"}
										custom={permissions ? 1 : -1}
										variants={carouselMotion}
										initial="enter"
										animate="center"
										exit="exit"
										transition={transition}
										className={`col-start-1 row-start-1 flex min-h-0 flex-col ${permissions ? "h-full" : ""}`}
									>
										{permissions ? (
											<OnboardingPermissions
												showFooter={false}
												onReadyChange={setPermissionsReady}
												preview={preview}
												onBack={() => setShowPermissions(false)}
												onFinish={() => {
													if (canViewPermissions) onAuthenticated();
												}}
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
						{onboarding && open && <FirstBootMusic />}
					</MotionDialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
