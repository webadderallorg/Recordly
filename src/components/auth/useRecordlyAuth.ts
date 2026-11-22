import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { captureAuthFailure, recordAuthEvent } from "@/lib/auth/authDiagnostics";
import {
	completeAuthCallback,
	recordlyAuth,
	recordlyAuthConfigured,
	retryPendingSignupConsent,
} from "@/lib/auth/recordlyAuth";
import { isSavedSignInLocked } from "@/lib/auth/savedSignIn";

export function useRecordlyAuth() {
	const [user, setUser] = useState<User | null>(null);
	const [accessToken, setAccessToken] = useState<string>();
	const [loading, setLoading] = useState(recordlyAuthConfigured);
	const [callbackError, setCallbackError] = useState<string>();
	const [savedSignInLocked, setSavedSignInLocked] = useState(false);
	const [callbackVersion, setCallbackVersion] = useState(0);
	const [callbackActivity, setCallbackActivity] = useState({ pending: recordlyAuthConfigured });
	const callbackReadPending = useRef(recordlyAuthConfigured);
	const callbacksInFlight = useRef(0);
	const callbackEffectMounted = useRef(false);
	const callbackUrl = useRef<string | undefined>(undefined);
	const isCallbackPending = useCallback(
		() => callbackReadPending.current || callbacksInFlight.current > 0,
		[],
	);

	useEffect(() => {
		if (!recordlyAuth) {
			setLoading(false);
			return;
		}

		let mounted = true;
		let authEventReceived = false;
		callbackEffectMounted.current = true;
		callbackReadPending.current = true;
		const publishCallbackActivity = () => {
			// Publish each transition so startup retries a blocked handoff even if
			// React batches the start and finish into a single render.
			if (callbackEffectMounted.current)
				setCallbackActivity({ pending: isCallbackPending() });
		};
		recordAuthEvent("session-restore", "started");
		void recordlyAuth.auth
			.getSession()
			.then(({ data, error }) => {
				if (error) throw error;
				recordAuthEvent("session-restore", data.session ? "succeeded" : "empty");
				if (mounted && !authEventReceived) {
					setUser(data.session?.user ?? null);
					setAccessToken(data.session?.access_token);
					setLoading(false);
				}
				if (data.session) void retryPendingSignupConsent();
			})
			.catch((error) => {
				if (mounted && !authEventReceived) {
					const diagnostic = captureAuthFailure("session-restore", error);
					if (isSavedSignInLocked(error)) setSavedSignInLocked(true);
					else setCallbackError(diagnostic);
					setLoading(false);
				}
			});
		const { data: listener } = recordlyAuth.auth.onAuthStateChange((event, session) => {
			// Supabase emits a null initial session even when restoring threw.
			// Let getSession distinguish an empty store from an unreadable one.
			if (event === "INITIAL_SESSION" && !session) return;
			// SDK session methods must run after the auth event callback releases its lock.
			if (session) queueMicrotask(() => void retryPendingSignupConsent());
			if (mounted) {
				if (event === "SIGNED_IN" || event === "SIGNED_OUT")
					recordAuthEvent(
						"session-event",
						event === "SIGNED_IN" ? "signed-in" : "signed-out",
					);
				authEventReceived = true;
				setUser(session?.user ?? null);
				setAccessToken(session?.access_token);
				setLoading(false);
				if (event === "SIGNED_IN") {
					setCallbackError(undefined);
					setSavedSignInLocked(false);
				}
			}
		});

		const handleCallback = async (url: string) => {
			if (!mounted || callbackUrl.current === url) return;
			callbackUrl.current = url;
			callbacksInFlight.current++;
			publishCallbackActivity();
			try {
				setCallbackError(undefined);
				await completeAuthCallback(url);
				if (mounted) setCallbackVersion((version) => version + 1);
			} catch (error) {
				if (mounted) setCallbackError(captureAuthFailure("callback-delivery", error));
			} finally {
				await window.electronAPI.ackAuthCallbackUrl(url).catch(() => undefined);
				callbacksInFlight.current--;
				publishCallbackActivity();
			}
		};
		const unsubscribe = window.electronAPI.onAuthCallbackUrl((url) => void handleCallback(url));
		void window.electronAPI
			.getPendingAuthCallbackUrl()
			.then((url) => {
				if (url) void handleCallback(url);
			})
			.catch((error) => {
				if (mounted) setCallbackError(captureAuthFailure("callback-read", error));
			})
			.finally(() => {
				if (!mounted) return;
				callbackReadPending.current = false;
				publishCallbackActivity();
			});

		return () => {
			mounted = false;
			callbackEffectMounted.current = false;
			listener.subscription.unsubscribe();
			unsubscribe();
		};
	}, [isCallbackPending]);

	return {
		user: user?.is_anonymous ? null : user,
		accessToken: user?.is_anonymous ? undefined : accessToken,
		loading,
		configured: recordlyAuthConfigured,
		callbackError,
		savedSignInLocked,
		callbackVersion,
		callbackActivity,
		isCallbackPending,
	};
}
