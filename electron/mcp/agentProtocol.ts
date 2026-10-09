export const AGENT_EVENT_TAG = 0x52434459;

export type AgentFrame = { x: number; y: number; width: number; height: number };
export type AgentButton = "left" | "right" | "middle";
export type AgentModifier = "cmd" | "shift" | "alt" | "ctrl" | "fn";

export const AGENT_MODIFIER_ALIASES: Record<string, AgentModifier> = {
	cmd: "cmd",
	command: "cmd",
	meta: "cmd",
	super: "cmd",
	win: "cmd",
	windows: "cmd",
	shift: "shift",
	alt: "alt",
	option: "alt",
	opt: "alt",
	ctrl: "ctrl",
	control: "ctrl",
	fn: "fn",
	function: "fn",
};

export type AgentWindow = AgentFrame & {
	pid: number;
	windowId: number;
	title: string;
	appName: string;
	bundleId: string | null;
};

export type AgentWindowInfo = {
	pid: number;
	windowId: number;
	title: string;
	appName: string;
	frame: AgentFrame;
	visible: boolean;
	minimized: boolean;
};

export const AGENT_ROLE_ALIASES: Record<string, string[]> = {
	button: ["AXButton", "AXMenuButton", "Button", "SplitButton"],
	link: ["AXLink", "Hyperlink"],
	textbox: ["AXTextField", "AXTextArea", "AXComboBox", "Edit", "ComboBox"],
	textfield: ["AXTextField", "AXTextArea", "AXComboBox", "Edit", "ComboBox"],
	checkbox: ["AXCheckBox", "CheckBox"],
	radio: ["AXRadioButton", "RadioButton"],
	tab: ["AXTabButton", "TabItem"],
	menuitem: ["AXMenuItem", "AXMenuBarItem", "MenuItem"],
	text: ["AXStaticText", "Text"],
	statictext: ["AXStaticText", "Text"],
	heading: ["AXHeading"],
	image: ["AXImage"],
};

export type AgentElement = AgentFrame & {
	role: string;
	label: string;
	visible?: boolean;
	web?: boolean;
	container?: AgentFrame;
};

export type AgentHit = AgentFrame & { role: string; label: string };

export type AgentCommand =
	| { cmd: "preflight" }
	| { cmd: "cursor" }
	| { cmd: "arm"; tolerancePx?: number }
	| { cmd: "disarm" }
	| { cmd: "move"; x: number; y: number; ms: number }
	| {
			cmd: "click";
			x: number;
			y: number;
			ms: number;
			button: AgentButton;
			count: 1 | 2 | 3;
			modifiers: AgentModifier[];
	  }
	| {
			cmd: "drag";
			fromX: number;
			fromY: number;
			toX: number;
			toY: number;
			ms: number;
			button: AgentButton;
			modifiers: AgentModifier[];
	  }
	| {
			cmd: "scroll";
			x: number;
			y: number;
			ms: number;
			dx: number;
			dy: number;
			modifiers: AgentModifier[];
	  }
	| { cmd: "type"; text: string; cps: number }
	| { cmd: "key"; key: string; modifiers: AgentModifier[]; repeat: number }
	| { cmd: "raise"; pid: number; windowId: number; frame: AgentFrame }
	| {
			cmd: "set_bounds";
			pid: number;
			windowId: number;
			frame: AgentFrame;
			bounds: AgentFrame;
	  }
	| { cmd: "frontmost_window" }
	| { cmd: "window_info"; windowId: number }
	| { cmd: "at"; pid: number; x: number; y: number }
	| {
			cmd: "find";
			pid: number;
			windowId: number;
			frame: AgentFrame;
			text?: string;
			role?: string;
			limit: number;
			offscreen?: boolean;
	  };

export type AgentResults = {
	preflight: { postEvents: boolean; accessibility: boolean };
	cursor: { x: number; y: number };
	arm: Record<string, never>;
	disarm: Record<string, never>;
	move: Record<string, never>;
	click: Record<string, never>;
	drag: Record<string, never>;
	scroll: Record<string, never>;
	type: Record<string, never>;
	key: Record<string, never>;
	raise: { raised: boolean };
	set_bounds: { frame?: AgentFrame };
	frontmost_window: { window: AgentWindow | null };
	window_info: { window: AgentWindowInfo | null };
	find: { elements: AgentElement[]; truncated: boolean };
	at: { hit: AgentHit | null; parent: AgentHit | null };
};

export type AgentRequest = AgentCommand & { id: number };

export type AgentResponse =
	| ({ id: number; ok: true } & Record<string, unknown>)
	| { id: number; ok: false; error: string };

export type AgentEvent = {
	event: "user-input";
	kind: "move" | "button" | "scroll" | "key";
	escape: boolean;
};

export const AGENT_KEY_NAMES = [
	"enter",
	"tab",
	"escape",
	"backspace",
	"delete",
	"space",
	"up",
	"down",
	"left",
	"right",
	"home",
	"end",
	"pageup",
	"pagedown",
	"minus",
	"equal",
	"leftbracket",
	"rightbracket",
	"backslash",
	"semicolon",
	"quote",
	"comma",
	"period",
	"slash",
	"grave",
	...Array.from({ length: 20 }, (_, index) => `f${index + 1}`),
	...Array.from({ length: 10 }, (_, index) => `keypad${index}`),
	"keypaddecimal",
	"keypadplus",
	"keypadminus",
	"keypadmultiply",
	"keypaddivide",
	"keypadenter",
	"keypadequals",
	"keypadclear",
	..."abcdefghijklmnopqrstuvwxyz0123456789".split(""),
] as const;

export const AGENT_KEY_ALIASES: Record<string, (typeof AGENT_KEY_NAMES)[number]> = {
	return: "enter",
	esc: "escape",
	forwarddelete: "delete",
	del: "delete",
	spacebar: "space",
	arrowup: "up",
	arrowdown: "down",
	arrowleft: "left",
	arrowright: "right",
	uparrow: "up",
	downarrow: "down",
	leftarrow: "left",
	rightarrow: "right",
	pgup: "pageup",
	pgdn: "pagedown",
	backtick: "grave",
	apostrophe: "quote",
	equals: "equal",
	hyphen: "minus",
	dash: "minus",
};
