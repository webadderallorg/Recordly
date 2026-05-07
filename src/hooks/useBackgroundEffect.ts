import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type BackgroundEffectOptions,
	type BackgroundMode,
	DEFAULT_BACKGROUND_OPTIONS,
} from "@/lib/camera/backgroundEffect";

const STORAGE_KEY = "recordly:webcam-background-effect:v1";

function loadFromStorage(): BackgroundEffectOptions {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_BACKGROUND_OPTIONS;
		const parsed = JSON.parse(raw) as Partial<BackgroundEffectOptions>;
		return { ...DEFAULT_BACKGROUND_OPTIONS, ...parsed };
	} catch {
		return DEFAULT_BACKGROUND_OPTIONS;
	}
}

export type UseBackgroundEffectReturn = {
	options: BackgroundEffectOptions;
	getOptions: () => BackgroundEffectOptions;
	setMode: (mode: BackgroundMode) => void;
	setBlurIntensity: (intensity: number) => void;
	setColor: (color: string) => void;
	setImageDataUrl: (dataUrl: string | null) => void;
};

export function useBackgroundEffect(): UseBackgroundEffectReturn {
	const [options, setOptions] = useState<BackgroundEffectOptions>(() => loadFromStorage());
	const ref = useRef(options);
	ref.current = options;

	useEffect(() => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
		} catch {
			/* ignore quota errors */
		}
	}, [options]);

	const setMode = useCallback((mode: BackgroundMode) => {
		setOptions((prev) => ({ ...prev, mode }));
	}, []);
	const setBlurIntensity = useCallback((blurIntensity: number) => {
		setOptions((prev) => ({ ...prev, blurIntensity }));
	}, []);
	const setColor = useCallback((color: string) => {
		setOptions((prev) => ({ ...prev, color }));
	}, []);
	const setImageDataUrl = useCallback((imageDataUrl: string | null) => {
		setOptions((prev) => ({ ...prev, imageDataUrl }));
	}, []);

	const getOptions = useCallback(() => ref.current, []);

	return useMemo(
		() => ({ options, getOptions, setMode, setBlurIntensity, setColor, setImageDataUrl }),
		[options, getOptions, setMode, setBlurIntensity, setColor, setImageDataUrl],
	);
}
