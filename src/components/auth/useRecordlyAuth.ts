import type { User } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { captureAuthFailure, recordAuthEvent } from "@/lib/auth/authDiagnostics";
import {
	completeAuthCallback,
	recordlyAuth,
	recordlyAuthConfigured,
	retryPendingSignupConsent,
} from "@/lib/auth/recordlyAuth";

export function useRecordlyAuth() {
	const [user, setUser] = useState<User | null>(null);
	const [accessToken, setAccessToken] = useState<string>();
	const [loading, setLoading] = useState(recordlyAuthConfigured);
	const [callbackError, setCallbackError] = useState<string>();
	const [callbackVersion, setCallbackVersion] = useState(0);
	const callbackUrl = useRef<string | undefined>(undefined);

	useEffect(() => {
		if (!recordlyAuth) {
			setLoading(false);
			return;
		}

		let mounted = true;
		let authEventReceived = false;
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
					setCallbackError(captureAuthFailure("session-restore", error));
					setLoading(false);
				}
			});
		const { data: listener } = recordlyAuth.auth.onAuthStateChange((event, session) => {
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
				if (event === "SIGNED_IN") setCallbackError(undefined);
			}
		});

		const handleCallback = async (url: string) => {
			if (!mounted || callbackUrl.current === url) return;
			callbackUrl.current = url;
			try {
				setCallbackError(undefined);
				await completeAuthCallback(url);
				if (mounted) setCallbackVersion((version) => version + 1);
			} catch (error) {
				if (mounted) setCallbackError(captureAuthFailure("callback-delivery", error));
			} finally {
				await window.electronAPI.ackAuthCallbackUrl(url).catch(() => undefined);
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
			});

		return () => {
			mounted = false;
			listener.subscription.unsubscribe();
			unsubscribe();
		};
	}, []);

	return {
		user: user?.is_anonymous ? null : user,
		accessToken: user?.is_anonymous ? undefined : accessToken,
		loading,
		configured: recordlyAuthConfigured,
		callbackError,
		callbackVersion,
	};
}
