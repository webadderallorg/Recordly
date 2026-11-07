import { Alert, Button, Modal, Spinner, toast } from "@heroui/react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import LibraryPage from "./LibraryPage";
import { CenteredCard } from "./ShareUI";
import {
	RecordlySignInFields,
	type SignInProvider,
} from "../../../../../../src/components/auth/RecordlySignInFields";
import { RecordlyPasswordForm } from "../../../../../../src/components/auth/RecordlyPasswordForm";
import settingsCopy from "../../../../../../src/i18n/locales/en/settings.json";
import { RecordlyDemoVideo } from "../../../../../../src/components/ui/RecordlyDemoVideo";
import copy from "../../../../../../src/i18n/locales/en/onboarding.json";
import { beginCloudOAuth, cloudSignupMetadata, completeCloudCallback, CloudSignupConsentRetryError } from "../scripts/cloudAuth";
import ThemeToggle from "./ThemeToggle";
import { commentAccessTokenForAccount, type CommentAccountState } from "../scripts/api";
import { commentProfileName, takeCommentReturn } from "../scripts/commentAuth";

import CommentProfileName from "./CommentProfileName";

interface Props {
	authConfig?: { url: string; publishableKey: string };
	commentAccount?: {
		canComment: boolean;
		onChange: (account: CommentAccountState | null) => void;
		reauthenticate: number;
		returnTo: () => string;
	};
}

export default function CloudLibrary({ authConfig, commentAccount }: Props = {}) {
	const onCommentAccountChange = commentAccount?.onChange;
	const [signInOpen, setSignInOpen] = useState(false);
	const [client, setClient] = useState<SupabaseClient | null>(null);
	const [session, setSession] = useState<Session | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [email, setEmail] = useState("");
	const [pending, setPending] = useState(false);
	const [action, setAction] = useState<string>();
	const [providers, setProviders] = useState<SignInProvider[]>([]);
	const [providersKnown, setProvidersKnown] = useState(false);
	const [loadingProviders, setLoadingProviders] = useState(true);
	useEffect(() => {
		let active = true;
		let unsubscribe = () => {
			/* No subscription until configuration loads. */
		};
		async function initialize() {
			try {
				const config = authConfig || await (async () => {
					const response = await fetch("/cloud/config");
					if (!response.ok) throw new Error("Cloud sign-in is unavailable. Please try again later.");
					return response.json();
				})();
				const auth = createClient(config.url, config.publishableKey, {
					auth: {
						flowType: "pkce",
						storageKey: "recordly-cloud-auth",
						detectSessionInUrl: false,
					},
				});
				const { data } = auth.auth.onAuthStateChange((_event, next) => {
					if (active) setSession(next);
				});
				unsubscribe = () => {
					data.subscription.unsubscribe();
					auth.auth.stopAutoRefresh();
				};
				if (!active) {
					unsubscribe();
					return;
				}
				// Discover only enabled providers; email stays usable if discovery fails.
				void fetch(`${config.url}/auth/v1/settings`, {
					headers: { apikey: config.publishableKey },
					signal: AbortSignal.timeout(10000),
				})
					.then(async (response) => {
						if (!response.ok) throw new Error("Provider discovery unavailable");
						const settings = await response.json();
						if (active) {
							setProviders(
								(["google", "azure", "apple"] as const).filter(
									(provider) => settings.external?.[provider] === true,
								),
							);
							setProvidersKnown(true);
						}
					})
					.catch(() => {
						/* Email remains available when providers cannot be discovered. */
					})
					.finally(() => {
						if (active) setLoadingProviders(false);
					});
				// Keep the client available even if a stale callback needs a fresh link.
				setClient(auth);
				try {
					let returnTo: string | null = null;
					if (await completeCloudCallback(auth, location.href, (challenge) => { returnTo = takeCommentReturn(challenge); }, config)) {
						if (returnTo) { location.replace(returnTo); return; }
						history.replaceState(null, "", "/library");
					}
				} catch (cause) {
					if (!(cause instanceof CloudSignupConsentRetryError))
						history.replaceState(null, "", "/library");
					if (active)
						setError(cause instanceof Error ? cause.message : copy.signInFailed);
				}
				const result = await auth.auth.getSession();
				if (result.error) throw result.error;
				if (active) {
					setClient(auth);
					setSession(result.data.session);
				}
			} catch (cause) {
				if (active)
					setError(
						cause instanceof Error ? cause.message : "Could not load cloud sign-in.",
					);
			} finally {
				if (active) setLoading(false);
			}
		}
		void initialize();
		return () => {
			active = false;
			unsubscribe();
		};
	}, []);

	useEffect(() => {
		if (!onCommentAccountChange) return;
		const usable = session && !session.user.is_anonymous && session.user.email_confirmed_at;
		const accountKey = session?.user.id ?? "";
		onCommentAccountChange(usable && client ? {
			key: accountKey,
			needsDisplayName: !commentProfileName(session.user.user_metadata),
			displayName: commentProfileName(session.user.user_metadata) || "",
			getAccessToken: async () => {
				const result = await client.auth.getSession();
				return commentAccessTokenForAccount(accountKey, result);
			},
		} : null);
		if (usable) setSignInOpen(false);
	}, [session, client, onCommentAccountChange]);
	useEffect(() => {
		if (commentAccount?.reauthenticate) setSignInOpen(true);
	}, [commentAccount?.reauthenticate]);

	async function run(action: string, work: () => Promise<unknown>) {
		if (!client || pending) return false;
		setPending(true);
		setAction(action);
		setError("");
		try {
			await work();
			return true;
		} catch (cause) {
			setError(
				action === "verify"
					? copy.invalidCode
					: cause instanceof Error
						? cause.message
						: copy.signInFailed,
			);
			return false;
		} finally {
			setPending(false);
			setAction(undefined);
		}
	}

	async function signInWithProvider(provider: SignInProvider) {
		if (!client || pending || !providers.includes(provider)) return;
		setPending(true);
		setAction(provider);
		setError("");
		try {
			await beginCloudOAuth(client, provider, location.origin, commentAccount?.returnTo());
		} catch {
			setError(copy.signInFailed);
			setPending(false);
			setAction(undefined);
		}
	}

	async function signOut() {
		const result = await client?.auth.signOut({ scope: "local" });
		if (result?.error) {
			toast.danger("Could not sign out. Please try again.");
			return;
		}
		setSession(null);
	}
	if (commentAccount && !signInOpen) return (
		<div className="space-y-2 p-4 text-sm">
			{loading ? <Spinner size="sm" aria-label="Checking Recordly account" /> : session && !session.user.is_anonymous && session.user.email_confirmed_at ? <>
				{client && <CommentProfileName key={session.user.id} client={client} user={session.user} onSaved={(user) => {
					setSession((current) => current?.user.id === user.id ? { ...current, user } : current);
				}} />}
				<Button size="sm" variant="ghost" onPress={() => void signOut()}>Sign out</Button>
			</> : <>
				<p>{commentAccount.canComment ? "Sign in with your Recordly account to comment." : "Sign in with your Recordly account to manage your comments."}</p>
				<Button size="sm" onPress={() => setSignInOpen(true)}>Sign in or create account</Button>
			</>}
		</div>
	);
	if (loading)
		return (
			<CenteredCard>
				<Spinner aria-label="Loading cloud library" />
			</CenteredCard>
		);
	if (session && client && !commentAccount)
		return (
			<LibraryPage
				key={session.user.id}
				accessToken={session.access_token}
				folderStorageKey={`recordly-cloud-folders:${session.user.id}`}
				onSignOut={() => void signOut()}
				accountSettings={
					<RecordlyPasswordForm
						labels={{
							...settingsCopy.account,
							failure:
								"Could not save your password. Sign in with an email code and try again.",
						}}
						onSave={async (password) => {
							const { data, error: identityError } = await client.auth.getUser();
							if (identityError) throw identityError;
							if (!data.user?.email_confirmed_at || data.user.is_anonymous)
								throw new Error("Verify your email first.");
							const { error } = await client.auth.updateUser({ password });
							if (error) throw error;
						}}
					/>
				}
			/>
		);
	const AuthContainer = commentAccount ? "div" : "main";
	return (
		<AuthContainer className={commentAccount ? undefined : "cloud-auth-page"}>
			<Modal isOpen onOpenChange={(open) => { if (commentAccount) setSignInOpen(open); }}>
				<Modal.Backdrop variant="blur" isDismissable={Boolean(commentAccount)} isKeyboardDismissDisabled={!commentAccount}>
					<Modal.Container size="cover" placement="center" className="p-4 sm:p-8">
						<Modal.Dialog
							aria-label={copy.signInLabel}
							className="cloud-auth-dialog relative h-auto min-h-0 w-full max-w-[600px] max-h-[calc(100dvh-48px)] gap-0 overflow-y-auto p-2"
						>
							{commentAccount && <Modal.CloseTrigger aria-label="Close sign-in" className="z-20" />}
							<div className="cloud-auth-theme" style={commentAccount ? { left: 16, right: "auto" } : undefined}>
								<ThemeToggle />
							</div>
							<div className="relative h-32 shrink-0 overflow-hidden rounded-2xl sm:h-36">
								<RecordlyDemoVideo className="absolute inset-0" />
							</div>
							<div className="flex flex-1 flex-col justify-center px-5 py-6 sm:px-8">
								<div className="w-full max-w-[420px] self-center space-y-4">
									<Modal.Header className="items-center gap-3 text-center">
										<div className="flex items-center gap-3">
											<img
												src="/auth/recordly-128.png"
												alt=""
												className="size-12 rounded-xl"
											/>
											<Modal.Heading className="cloud-auth-heading">
												Recordly
											</Modal.Heading>
										</div>
										<p className="text-balance text-sm leading-relaxed text-muted">
											{commentAccount ? "Sign in to leave feedback or manage your comments. Watching stays open to everyone with the link." : copy.tagline}
										</p>
									</Modal.Header>
									<RecordlySignInFields
										authProtectionConfigUrl="/cloud/config"
										email={email}
										onEmailChange={(value) => {
											setEmail(value);

											setError("");
										}}
										onRequestCode={(captchaToken) =>
											run("code", async () => {
												const { error } = await client!.auth.signInWithOtp({
													email: email.trim(),
													options: {
														shouldCreateUser: true,
														data: cloudSignupMetadata(),
														captchaToken,
													},
												});
												if (error) throw error;
											})
										}
										onVerifyCode={(targetEmail, token) =>
											run("verify", async () => {
												const { data, error } =
													await client!.auth.verifyOtp({
														email: targetEmail,
														token,
														type: "email",
													});
												if (error) throw error;
												if (
													!data.session ||
													!data.user ||
													data.user.is_anonymous
												)
													throw new Error(copy.invalidCode);
											})
										}
										onPasswordSignIn={(password, captchaToken) =>
											run("password", async () => {
												const { error } =
													await client!.auth.signInWithPassword({
														email: email.trim(),
														password,
														options: { captchaToken },
													});
												if (error) throw error;
											})
										}
										onProvider={(provider) => void signInWithProvider(provider)}
										providers={providers}
										providersKnown={providersKnown}
										loadingProviders={loadingProviders}
										configured={Boolean(client)}
										busy={action}
										labels={{
											...copy,
											invalidEmail: "Enter a valid email address.",
											continueWith: (provider) =>
												copy.continueWith.replace("{{provider}}", provider),
											providerDisabled: (provider) =>
												copy.providerDisabled.replace(
													"{{provider}}",
													provider,
												),
										}}
									/>
									{error && (
										<Alert status="danger" role="alert">
											<Alert.Indicator />
											<Alert.Content>
												<Alert.Description>{error}</Alert.Description>
											</Alert.Content>
										</Alert>
									)}
								</div>
								<p className="pb-6 pt-4 text-center text-sm leading-relaxed text-muted [&_a]:underline [&_a]:underline-offset-[3px]">
									By continuing, you agree to the{" "}
									<a href="/terms" target="_blank" rel="noopener noreferrer">
										Terms
									</a>{" "}
									and acknowledge the{" "}
									<a href="/privacy" target="_blank" rel="noopener noreferrer">
										Privacy Policy
									</a>
									.
								</p>
							</div>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
		</AuthContainer>
	);
}
