interface ElectronAPISettings {
	openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
	installDownloadedUpdate: () => Promise<{ success: boolean }>;
	downloadAvailableUpdate: () => Promise<{ success: boolean; message?: string }>;
	deferDownloadedUpdate: (delayMs?: number) => Promise<{ success: boolean; message?: string }>;
	dismissUpdateToast: () => Promise<{ success: boolean }>;
	skipUpdateVersion: () => Promise<{ success: boolean; message?: string }>;
	getCurrentUpdateToastPayload: () => Promise<UpdateToastState | null>;
	getUpdateStatusSummary: () => Promise<UpdateStatusSummary>;
	previewUpdateToast: () => Promise<{ success: boolean }>;
	checkForAppUpdates: () => Promise<{ success: boolean; logPath: string }>;
	onUpdateToastStateChanged: (callback: (payload: UpdateToastState | null) => void) => () => void;
	onUpdateReadyToast: (
		callback: (payload: {
			version: string;
			detail: string;
			delayMs: number;
			isPreview?: boolean;
		}) => void,
	) => () => void;
	onMenuLoadProject: (callback: () => void) => () => void;
	onMenuSaveProject: (callback: () => void) => () => void;
	onMenuSaveProjectAs: (callback: () => void) => () => void;
	getRecordingPreferences: () => Promise<{
		success: boolean;
		microphoneEnabled: boolean;
		microphoneDeviceId?: string;
		systemAudioEnabled: boolean;
	}>;
	setRecordingPreferences: (prefs: {
		microphoneEnabled?: boolean;
		microphoneDeviceId?: string;
		systemAudioEnabled?: boolean;
	}) => Promise<{ success: boolean; error?: string }>;
	getCountdownDelay: () => Promise<{ success: boolean; delay: number }>;
	setCountdownDelay: (delay: number) => Promise<{ success: boolean; error?: string }>;
	startCountdown: (seconds: number) => Promise<{ success: boolean; cancelled?: boolean }>;
	cancelCountdown: () => Promise<{ success: boolean }>;
	getActiveCountdown: () => Promise<{ success: boolean; seconds: number | null }>;
	onCountdownTick: (callback: (seconds: number) => void) => () => void;
	extensionsDiscover: () => Promise<RendererExtensionInfo[]>;
	extensionsList: () => Promise<RendererExtensionInfo[]>;
	extensionsGet: (id: string) => Promise<RendererExtensionInfo | null>;
	extensionsEnable: (id: string) => Promise<{ success: boolean; error?: string }>;
	extensionsDisable: (id: string) => Promise<{ success: boolean; error?: string }>;
	extensionsInstallFromFolder: () => Promise<{
		success: boolean;
		extension?: RendererExtensionInfo;
		message?: string;
		error?: string;
		canceled?: boolean;
	}>;
	extensionsUninstall: (id: string) => Promise<{ success: boolean; error?: string }>;
	extensionsGetDirectory: () => Promise<{ success: boolean; path?: string; error?: string }>;
	extensionsOpenDirectory: () => Promise<{ success: boolean; path?: string; error?: string }>;
	extensionsMarketplaceSearch: (params: {
		query?: string;
		tags?: string[];
		sort?: string;
		page?: number;
		pageSize?: number;
	}) => Promise<RendererMarketplaceSearchResult & { error?: string }>;
	extensionsMarketplaceGet: (id: string) => Promise<RendererMarketplaceExtension | null>;
	extensionsMarketplaceInstall: (
		extensionId: string,
		downloadUrl: string,
	) => Promise<{ success: boolean; error?: string }>;
	extensionsMarketplaceSubmit: (
		extensionId: string,
	) => Promise<{ success: boolean; reviewId?: string; error?: string }>;
	extensionsReviewsList: (params: {
		status?: RendererMarketplaceReviewStatus;
		page?: number;
		pageSize?: number;
	}) => Promise<{ reviews: RendererExtensionReview[]; total: number; error?: string }>;
	extensionsReviewUpdate: (
		reviewId: string,
		status: RendererMarketplaceReviewStatus,
		notes?: string,
	) => Promise<{ success: boolean; error?: string }>;
}