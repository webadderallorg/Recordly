/** G1–G4 require recorded device and signed-install evidence before changing this. */
export const IOS_CAPTURE_ENABLED_BY_DEFAULT = false;

export function isIOSCaptureEnabled(
	platform: string,
	packaged: boolean,
	environment: Readonly<Record<string, string | undefined>>,
): boolean {
	return (
		platform === "darwin" &&
		(IOS_CAPTURE_ENABLED_BY_DEFAULT ||
			(!packaged && environment.RECORDLY_ENABLE_IOS_CAPTURE === "1"))
	);
}
