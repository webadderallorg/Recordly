export type PhoneRemoteSessionStatus =
	| "waiting"
	| "phone-connected"
	| "preview-live"
	| "mic-active"
	| "reconnecting"
	| "disconnected"
	| "camera-permission-denied"
	| "microphone-permission-denied"
	| "no-audio-track"
	| "phone-backgrounded"
	| "phone-sleeping"
	| "error";

export type PhoneRemoteSignalMessage =
	| {
			type: "offer" | "answer";
			description: RTCSessionDescriptionInit;
	  }
	| {
			type: "ice-candidate";
			candidate: RTCIceCandidateInit | null;
	  };

export type PhoneRemoteStatusMessage = {
	status: PhoneRemoteSessionStatus;
	detail?: string;
	hasAudio?: boolean;
	hasVideo?: boolean;
	facingMode?: "user" | "environment";
};

export type PhoneRemoteSignalEnvelope = {
	index: number;
	sentAt: number;
	message: PhoneRemoteSignalMessage;
};

export type PhoneRemoteJoinUrls = {
	joinUrl: string;
	localJoinUrl: string;
	lanJoinUrl: string;
	tunnelJoinUrl?: string;
	urlMode: "secure-tunnel" | "lan";
	tunnelError?: string;
};

export type PhoneRemotePublicSession = PhoneRemoteJoinUrls & {
	id: string;
	code: string;
	expiresAt: number;
	status: PhoneRemoteSessionStatus;
};

export type PhoneRemoteSession = PhoneRemotePublicSession & {
	ownerWebContentsId: number;
	createdAt: number;
	laptopSignals: PhoneRemoteSignalEnvelope[];
	phoneSignals: PhoneRemoteSignalEnvelope[];
	lastStatusDetail?: string;
};

export type PhoneRemoteStoreEvent =
	| {
			type: "status";
			sessionId: string;
			ownerWebContentsId: number;
			status: PhoneRemoteStatusMessage;
	  }
	| {
			type: "signal";
			sessionId: string;
			ownerWebContentsId: number;
			message: PhoneRemoteSignalMessage;
	  };
