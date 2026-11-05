import {
	Button,
	FieldError,
	Form,
	Input,
	InputOTP,
	Label,
	REGEXP_ONLY_DIGITS,
	Separator,
	TextField,
} from "@heroui/react";
import { AppleLogo } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AuthProtectionState } from "../../lib/auth/cloudAuthProtection";
import { RecordlyBotChallenge } from "./RecordlyBotChallenge";

export type SignInProvider = "google" | "azure" | "apple";

/** The same primary sign-in controls for desktop and the hosted cloud library. */
export function RecordlySignInFields({
	email,
	onEmailChange,
	onRequestCode,
	onVerifyCode,
	onPasswordSignIn,
	onProvider,
	providers,
	loadingProviders,
	providersKnown,
	configured,
	busy,
	compact = false,
	assetBase = "/",
	authProtectionConfigUrl,
	labels,
}: {
	email: string;
	onEmailChange: (email: string) => void;
	onRequestCode: (captchaToken?: string) => Promise<boolean>;
	onVerifyCode: (email: string, code: string) => Promise<boolean>;
	onPasswordSignIn: (password: string, captchaToken?: string) => Promise<boolean>;
	onProvider: (provider: SignInProvider) => void;
	providers: SignInProvider[];
	loadingProviders: boolean;
	providersKnown: boolean;
	configured: boolean;
	busy?: string;
	compact?: boolean;
	assetBase?: string;
	authProtectionConfigUrl?: string;
	labels: {
		loadingProviders: string;
		continueWith: (provider: string) => string;
		providerDisabled: (provider: string) => string;
		continueEmail: string;
		email: string;
		emailPlaceholder: string;
		invalidEmail: string;
		sendingLink: string;
		sendLink: string;
		checkInbox: string;
		code: string;
		verifyCode: string;
		verifyingCode: string;
		resendCode: string;
		resendIn: string;
		changeEmail: string;
		usePassword: string;
		usePasswordLink: string;
		useCode: string;
		password: string;
		signingIn: string;
		passwordHelp: string;
		botChecking?: string;
		botFailed?: string;
		botRetry?: string;
		botTitle?: string;
	};
}) {
	const codeId = useId();
	const providerDescriptionId = useId();
	const [sentTo, setSentTo] = useState("");
	const [code, setCode] = useState("");
	const [password, setPassword] = useState("");
	const [passwordMode, setPasswordMode] = useState(false);
	const [resendAt, setResendAt] = useState(0);
	const [now, setNow] = useState(Date.now());
	const locked = useRef(false);
	const [checkingProtection, setCheckingProtection] = useState(false);
	const [challengeVersion, setChallengeVersion] = useState(0);
	const activeChallenge = useRef(0);
	const protectionRequired = useRef(false);
	const protectionWaiter = useRef<((state: AuthProtectionState | undefined) => void) | undefined>(
		undefined,
	);
	const retryAction = useRef<(() => void) | undefined>(undefined);
	const onProtectionChange = useCallback(
		(state: AuthProtectionState) => {
			if (challengeVersion !== activeChallenge.current) return;
			if (state.required) protectionRequired.current = true;
			else if (state.ready && !state.failed) protectionRequired.current = false;
			if (state.ready || state.failed) {
				const resolve = protectionWaiter.current;
				protectionWaiter.current = undefined;
				resolve?.(state.ready ? state : undefined);
			}
		},
		[challengeVersion],
	);
	useEffect(
		() => () => {
			activeChallenge.current++;
			protectionWaiter.current?.(undefined);
			protectionWaiter.current = undefined;
		},
		[],
	);
	const resetChallenge = () => {
		activeChallenge.current++;
		setChallengeVersion(0);
		retryAction.current = undefined;
	};
	const runProtected = async (action: (captchaToken?: string) => Promise<void>) => {
		if (locked.current || busy || !configured) return;
		locked.current = true;
		retryAction.current = () => void runProtected(action);
		setCheckingProtection(true);
		let verified: AuthProtectionState | undefined;
		try {
			const result = new Promise<AuthProtectionState | undefined>((resolve) => {
				protectionWaiter.current = resolve;
			});
			setChallengeVersion(++activeChallenge.current);
			verified = await result;
			setCheckingProtection(false);
			if (verified) await action(verified.token);
		} finally {
			if (verified) resetChallenge();
			setCheckingProtection(false);
			locked.current = false;
		}
	};
	useEffect(() => {
		if (!resendAt) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [resendAt]);
	const seconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
	const requestCode = () =>
		runProtected(async (captchaToken) => {
			const target = email.trim();
			if (await onRequestCode(captchaToken)) {
				setSentTo(target);
				setCode("");
				setNow(Date.now());
				setResendAt(Date.now() + 60000);
			}
		});
	const disabled = Boolean(busy) || checkingProtection;
	const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
	return (
		<div
			data-signin-fields
			data-signin-step={sentTo ? "code" : passwordMode ? "password" : "email"}
			className="space-y-4 @container"
		>
			{!sentTo && !passwordMode && challengeVersion === 0 && (
				<div
					className="flex gap-2"
					role="group"
					aria-label={loadingProviders ? labels.loadingProviders : undefined}
					aria-busy={loadingProviders}
				>
					{(
						[
							{ provider: "google", label: "Google", image: "google-logo.png" },
							{
								provider: "azure",
								label: "Microsoft",
								image: "microsoft-logo.svg",
							},
							{ provider: "apple", label: "Apple", image: null },
						] as const
					).map(({ provider, label, image }) => (
						<Button
							key={provider}
							variant="secondary"
							aria-label={labels.continueWith(label)}
							className="h-11 w-full min-w-0 gap-2 rounded-xl px-2 text-xs font-medium text-foreground @[360px]:text-sm"
							isDisabled={
								disabled ||
								!configured ||
								loadingProviders ||
								!providersKnown ||
								!providers.includes(provider)
							}
							aria-describedby={
								providersKnown && !providers.includes(provider)
									? `${providerDescriptionId}-${provider}`
									: undefined
							}
							onPress={() => {
								resetChallenge();
								onProvider(provider);
							}}
						>
							{image ? (
								<img
									src={`${assetBase}auth/${image}`}
									alt=""
									className="size-4 shrink-0"
								/>
							) : (
								<AppleLogo
									aria-hidden="true"
									weight="fill"
									className="size-4 shrink-0"
								/>
							)}
							{label}
							{providersKnown && !providers.includes(provider) && (
								<span id={`${providerDescriptionId}-${provider}`} className="sr-only">
									{labels.providerDisabled(label)}
								</span>
							)}
						</Button>
					))}
				</div>
			)}

			{!sentTo && !passwordMode && challengeVersion === 0 && (
				<div data-signin-divider className="flex items-center gap-4 text-xs text-muted">
					<Separator className="flex-1" />
					<span>{labels.continueEmail}</span>
					<Separator className="flex-1" />
				</div>
			)}

			<Form
				data-signin-form
				className="flex flex-col gap-3"
				onSubmit={async (event) => {
					event.preventDefault();
					if (locked.current || disabled || !configured) return;
					if (!sentTo) {
						if (!validEmail) return;
						if (passwordMode) {
							if (!password) return;
							await runProtected(async (captchaToken) => {
								await onPasswordSignIn(password, captchaToken);
								setPassword("");
							});
						} else await requestCode();
						return;
					}
					if (!/^[0-9]{6}$/.test(code)) return;
					locked.current = true;
					try {
						await onVerifyCode(sentTo, code);
					} finally {
						locked.current = false;
					}
				}}
			>
				{!sentTo && (
					<TextField
						name="email"
						type="email"
						value={email}
						validate={() => (validEmail ? null : labels.invalidEmail)}
						onChange={(value) => {
							resetChallenge();
							onEmailChange(value);
						}}
						isRequired
						isDisabled={disabled || !configured}
					>
						<div className="flex items-center justify-between gap-3">
							<Label>{labels.email}</Label>
							<button
								type="button"
								className="cursor-pointer bg-transparent p-0 text-right text-xs font-medium text-muted underline-offset-2 hover:underline focus-visible:underline disabled:cursor-default disabled:opacity-50"
								disabled={disabled || !configured}
								onClick={() => {
									resetChallenge();
									setPasswordMode(!passwordMode);
									onEmailChange(email);
									setPassword("");
								}}
							>
								{passwordMode ? labels.useCode : labels.usePasswordLink}
							</button>
						</div>
						<Input
							className={compact ? "h-11" : "h-12"}
							placeholder={labels.emailPlaceholder}
							autoComplete="email"
						/>
						<FieldError>{labels.invalidEmail}</FieldError>
					</TextField>
				)}
				{challengeVersion > 0 && (
					<RecordlyBotChallenge
						key={challengeVersion}
						configurationUrl={authProtectionConfigUrl}
						previouslyRequired={protectionRequired.current}
						onChange={onProtectionChange}
						onRetry={() => retryAction.current?.()}
						labels={{
							checking: labels.botChecking ?? "A quick security check…",
							failed:
								labels.botFailed ?? "The security check couldn’t load. Try again.",
							retry: labels.botRetry ?? "Try again",
							title: labels.botTitle ?? "Recordly security check",
						}}
					/>
				)}
				{sentTo ? (
					<>
						<div data-signin-code-entry className="w-full space-y-2">
							<Label
								htmlFor={codeId}
								className="block break-words text-center text-sm leading-relaxed"
							>
								{labels.checkInbox.replace("{{email}}", sentTo)}
							</Label>
							<InputOTP
								id={codeId}
								name="code"
								aria-label={labels.checkInbox.replace("{{email}}", sentTo)}
								value={code}
								onChange={setCode}
								maxLength={6}
								minLength={6}
								pattern={REGEXP_ONLY_DIGITS}
								pasteTransformer={(value) => value.replace(/[^0-9]/g, "")}
								inputMode="numeric"
								autoComplete="one-time-code"
								required
								autoFocus
								isDisabled={disabled}
								className="mx-auto w-full max-w-[328px]"
							>
								<InputOTP.Group className="grid w-full grid-cols-6 gap-2">
									{[0, 1, 2, 3, 4, 5].map((index) => (
										<InputOTP.Slot
											key={index}
											index={index}
											className="aspect-square h-auto w-full"
										/>
									))}
								</InputOTP.Group>
							</InputOTP>
						</div>
						<Button
							type="submit"
							variant="primary"
							className="h-12 w-full"
							isDisabled={disabled || !/^[0-9]{6}$/.test(code)}
						>
							{busy === "verify" ? labels.verifyingCode : labels.verifyCode}
						</Button>
						<div className="flex flex-wrap justify-between gap-2">
							<Button
								type="button"
								variant="ghost"
								isDisabled={disabled || seconds > 0}
								onPress={() => void requestCode()}
							>
								{seconds > 0
									? labels.resendIn.replace("{{seconds}}", String(seconds))
									: labels.resendCode}
							</Button>
							<Button
								type="button"
								variant="ghost"
								isDisabled={disabled}
								onPress={() => {
									resetChallenge();
									setSentTo("");
									setResendAt(0);
									onEmailChange(email);
									setCode("");
									setPasswordMode(false);
								}}
							>
								{labels.changeEmail}
							</Button>
						</div>
					</>
				) : (
					<>
						{passwordMode && (
							<TextField
								name="password"
								value={password}
								onChange={(value) => {
									resetChallenge();
									setPassword(value);
								}}
								isRequired
								isDisabled={disabled}
							>
								<Label>{labels.password}</Label>
								<Input
									type="password"
									autoComplete="current-password"
									className="h-12"
								/>
							</TextField>
						)}
						<Button
							type="submit"
							variant="primary"
							className={`w-full ${compact ? "h-11 rounded-xl" : "h-12"}`}
							isDisabled={
								disabled ||
								!configured ||
								(passwordMode && (!validEmail || !password))
							}
						>
							{checkingProtection
								? (labels.botChecking ?? "A quick security check…")
								: passwordMode
									? busy === "password"
										? labels.signingIn
										: labels.usePassword
									: busy === "code"
										? labels.sendingLink
										: labels.sendLink}
						</Button>
						{passwordMode && (
							<p className="text-xs leading-relaxed text-muted">
								{labels.passwordHelp}
							</p>
						)}
					</>
				)}
			</Form>
		</div>
	);
}
