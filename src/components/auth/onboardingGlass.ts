// Adapted from Zanwei Guo’s Glass Icon Reveal (MIT). See THIRD_PARTY_NOTICES.md.
import { FRAG, VERT } from "./onboardingGlassShader";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
	const t = clamp01((x - a) / (b - a));
	return t * t * (3 - 2 * t);
};
const smoother = (a: number, b: number, x: number) => {
	const t = clamp01((x - a) / (b - a));
	return t * t * t * (t * (t * 6 - 15) + 10);
};

// Step response of a spring released at t = 0, from 0 toward 1 (damping 1 = no overshoot,
// response = period of the undamped spring, seconds).
function spring(t: number, response: number) {
	if (t <= 0) return 0;
	const w = (2 * Math.PI) / response;
	return 1 - Math.exp(-w * t) * (1 + w * t);
}

function timeToReach(level: number, response: number) {
	let low = 0;
	let high = response * 2;
	for (let i = 0; i < 24; i++) {
		const mid = (low + high) / 2;
		if (spring(mid, response) < level) low = mid;
		else high = mid;
	}
	return high;
}

const RESPONSE = 0.42;
const RELEASE_TIME = 1.7;
const RIPPLE_START = timeToReach(0.85, RESPONSE) - 0.01;
const TILE_START = timeToReach(0.92, RESPONSE) - 0.01;
const REVEAL_DURATION_SECONDS = RELEASE_TIME + 0.95;

// The droplet expands, settles into a rounded tile, then releases the mark.
function frameAt(T: number) {
	const tx = RELEASE_TIME;
	const grow = spring(T + 0.01, RESPONSE);
	const morph = spring(T - TILE_START, 0.4);
	const drop = 1 - smooth(0.05, 1, morph);
	const appear = smooth(0, 0.08, T);
	const drift = 0.08 * spring(T - 0.3, 2.2);
	// A quarter of the zoom goes with the landing droplet, the rest glides slowly so the logo lingers
	// big against the rim, where the glass bends it most.
	const zoomIn = 0.25 * spring(T, 0.7) + 0.75 * smoother(0, 1.6, T);
	const settle = spring(T - 0.5, 2.4);
	const exit = spring(T - tx, 0.95);
	const release = spring(T - tx - 0.05, 0.65);
	const dome = 0.15 * (1 - smooth(0.4, 0.95, grow));
	const view = (1 + (2.25 - 1) * (1 - zoomIn)) * (1 - 0.045 * settle) * mix(1, 0.86, exit);
	const bandW = mix(0.18, 0.4, drop);
	const plateScale = mix(0.2, 1, grow) * (1 + drift) * (1 + 0.14 * release);
	return {
		uPlateScale: plateScale,
		uShapeN: mix(2, 4.8, morph),
		uCornerN: 4.8,
		uOptics: 1 - smooth(0.55, 1, release),
		uPlateAlpha: appear * (1 - smooth(0.45, 1, release)),
		uLogoHalf: 0.64 * view,
		uSheen: 1,
		uSweep: mix(-1.6, 1.6, smoother(0.9, tx - 0.1, T)),
		uLightAng: 0.9 * smoother(0.4, tx + 0.4, T),
		uBold: 0.015 * (1 - zoomIn),
		uBlur: 0.05 * (1 - smooth(0.3, 0.95, grow)),
		uFrost: 1 - smooth(0.5, 0.95, grow),
		uPinch: 0.0684 * smooth(0.1, 0.9, morph) * smooth(0.75, 0.97, zoomIn),
		uTilt: 0.35,
		uDome: dome,
		uDrop: drop,
		uRim: 1 + 0.8 * drop,
		uHalo: 0.46 * (0.5 + 0.5 * drop),
		uGhost: smooth(0, 0.03, T) * (1 - smooth(0.04, 0.08, T)),
		uRipR: 1 + 0.9 * Math.max(0, T - RIPPLE_START),
		uRipA:
			0.75 *
			smooth(RIPPLE_START, RIPPLE_START + 0.06, T) *
			Math.exp(-Math.max(0, T - RIPPLE_START) / 0.6),
		uBare: smooth(tx - 0.25, tx, T),
		uReach: bandW * plateScale,
		uCornerPull: 1.8,
		uStreak: 2.2,
		uWiden: 1.8,
		uSlab: 0.3,
		uEtaSpread: 0.06,
		uFocus: 0.5,
		uFocusK: 1.0,
		uFocusSplit: 0.056 * 1.1,
		uRimLine: 0.09,
		uCornerOn: smooth(0.35, 1, morph),
		uGlow: 0.012 * 1.1,
		uFaceDisp: 0.012 * 1.65,
		uVivid: 0.85,
		uDissolve: release,
		uDisp: 1.65,
		uDouble: 1,
		uBevelW: bandW * (1 - release),
		uSpec: 1,
	};
}
const TEX = 512;

// Signed distance field from alpha (TinySDF method): + outside, − inside, in texture units.
function buildSdf(alpha: Uint8ClampedArray) {
	const n = TEX * TEX;
	const INF = 1e20;
	const outer = new Float64Array(n);
	const inner = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const a = alpha[i * 4 + 3] / 255;
		if (a >= 1) {
			outer[i] = 0;
			inner[i] = INF;
		} else if (a <= 0) {
			outer[i] = INF;
			inner[i] = 0;
		} else {
			const dd = 0.5 - a;
			outer[i] = dd > 0 ? dd * dd : 0;
			inner[i] = dd < 0 ? dd * dd : 0;
		}
	}
	const f = new Float64Array(TEX);
	const z = new Float64Array(TEX + 1);
	const v = new Uint16Array(TEX);
	edt(outer, f, v, z, INF);
	edt(inner, f, v, z, INF);
	const sdf = new Float32Array(n);
	for (let i = 0; i < n; i++) sdf[i] = (Math.sqrt(outer[i]) - Math.sqrt(inner[i])) / TEX;
	return sdf;
}

function edt(grid: Float64Array, f: Float64Array, v: Uint16Array, z: Float64Array, INF: number) {
	for (let x = 0; x < TEX; x++) edt1d(grid, x, TEX, f, v, z, INF);
	for (let y = 0; y < TEX; y++) edt1d(grid, y * TEX, 1, f, v, z, INF);
}

function edt1d(
	grid: Float64Array,
	offset: number,
	stride: number,
	f: Float64Array,
	v: Uint16Array,
	z: Float64Array,
	INF: number,
) {
	v[0] = 0;
	z[0] = -INF;
	z[1] = INF;
	f[0] = grid[offset];
	for (let q = 1, k = 0, s = 0; q < TEX; q++) {
		f[q] = grid[offset + q * stride];
		const q2 = q * q;
		do {
			const r = v[k];
			s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
		} while (s <= z[k] && --k > -1);
		k++;
		v[k] = q;
		z[k] = s;
		z[k + 1] = INF;
	}
	for (let q = 0, k = 0; q < TEX; q++) {
		while (z[k + 1] < q) k++;
		const r = v[k];
		const qr = q - r;
		grid[offset + q * stride] = f[r] + qr * qr;
	}
}

const BOX = 0.75;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
	const shader = gl.createShader(type);
	if (!shader) throw new Error("Could not allocate onboarding shader");
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
	const message = gl.getShaderInfoLog(shader);
	gl.deleteShader(shader);
	throw new Error(message || "Could not compile onboarding shader");
}

function createProgram(gl: WebGL2RenderingContext) {
	const program = gl.createProgram();
	if (!program) throw new Error("Could not allocate onboarding program");
	try {
		for (const [type, source] of [
			[gl.VERTEX_SHADER, VERT],
			[gl.FRAGMENT_SHADER, FRAG],
		] as const) {
			const shader = compileShader(gl, type, source);
			gl.attachShader(program, shader);
			gl.deleteShader(shader);
		}
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(gl.getProgramInfoLog(program) || "Could not link onboarding program");
		}
		return program;
	} catch (error) {
		gl.deleteProgram(program);
		throw error;
	}
}

export async function loadOnboardingLogo(url: string) {
	const image = new Image();
	image.src = url;
	await image.decode();

	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = TEX;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("Could not rasterize the Recordly icon");
	const inset = (TEX * (1 - BOX)) / 2;
	context.drawImage(image, inset, inset, TEX * BOX, TEX * BOX);
	return { artwork: canvas, sdf: buildSdf(context.getImageData(0, 0, TEX, TEX).data) };
}

function setTextureSampling(gl: WebGL2RenderingContext, minFilter: number) {
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function playOnboardingGlass(
	canvas: HTMLCanvasElement,
	logo: Awaited<ReturnType<typeof loadOnboardingLogo>>,
	onFinish: () => void,
	onContextLost: () => void,
) {
	const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false });
	if (!gl) throw new Error("WebGL 2 is unavailable");
	const program = createProgram(gl);
	const buffer = gl.createBuffer();
	const distanceTexture = gl.createTexture();
	const artworkTexture = gl.createTexture();
	let animation = 0;
	const dispose = () => {
		cancelAnimationFrame(animation);
		canvas.removeEventListener("webglcontextlost", onContextLost);
		gl.deleteTexture(distanceTexture);
		gl.deleteTexture(artworkTexture);
		gl.deleteBuffer(buffer);
		gl.deleteProgram(program);
	};
	gl.useProgram(program);
	try {
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const position = gl.getAttribLocation(program, "aPos");
		gl.enableVertexAttribArray(position);
		gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

		gl.bindTexture(gl.TEXTURE_2D, distanceTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, TEX, TEX, 0, gl.RED, gl.FLOAT, logo.sdf);
		setTextureSampling(gl, gl.LINEAR);

		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, artworkTexture);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, logo.artwork);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		gl.generateMipmap(gl.TEXTURE_2D);
		setTextureSampling(gl, gl.LINEAR_MIPMAP_LINEAR);
		gl.activeTexture(gl.TEXTURE0);

		const uniform = (name: string) => gl.getUniformLocation(program, name);
		gl.uniform1i(uniform("uSdf"), 0);
		gl.uniform1i(uniform("uArtwork"), 1);
		gl.uniform1f(uniform("uTextureSize"), TEX);
		gl.uniform1f(uniform("uBoxFrac"), BOX);
		gl.uniform3f(uniform("uBg"), 0.12, 0.14, 0.2);
		const center = uniform("uCenter");
		const tile = uniform("uTile");
		const frameUniforms = Object.keys(frameAt(0)).map((name) => ({
			name: name as keyof ReturnType<typeof frameAt>,
			location: uniform(name),
		}));
		let start: number | undefined;
		const tick = (now: number) => {
			start ??= now;
			const time = Math.min(REVEAL_DURATION_SECONDS, (now - start) / 1000);
			const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
			const size = Math.max(1, Math.round(canvas.clientWidth * ratio));
			if (canvas.width !== size || canvas.height !== size)
				canvas.width = canvas.height = size;
			gl.viewport(0, 0, size, size);
			gl.uniform2f(center, size / 2, size / 2);
			gl.uniform1f(tile, size * 0.58);
			const frame = frameAt(time);
			for (const { name, location } of frameUniforms) gl.uniform1f(location, frame[name]);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			if (time < REVEAL_DURATION_SECONDS) animation = requestAnimationFrame(tick);
			else onFinish();
		};
		canvas.addEventListener("webglcontextlost", onContextLost);
		animation = requestAnimationFrame(tick);
		return dispose;
	} catch (error) {
		dispose();
		throw error;
	}
}
