// Both Electron and renderer builds consume this same opt-in. Enable only after
// the authentication server allows the sb_flow_id query on every return URL.
export const oauthFlowIdRedirectsEnabled = import.meta.env.VITE_OAUTH_FLOW_ID_REDIRECTS === "true";
