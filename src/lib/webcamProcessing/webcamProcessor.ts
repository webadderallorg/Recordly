/**
 * WebGL2 webcam processing pipeline: garbage matte → chroma key → spill
 * suppression → color adjustments → composite over a background image.
 *
 * The fragment shader mirrors the reference math in chromaKeyMath.ts exactly
 * (same formulas, same constants) — that module's unit tests are the
 * correctness story for this shader. Output is an offscreen canvas at source
 * resolution with NO mirroring; callers (editor bubble, exporters) keep
 * applying their own crop/cover/mirror layout, unchanged.
 */

import {
	DEFAULT_WEBCAM_COLOR,
	DEFAULT_WEBCAM_GREENSCREEN,
	DEFAULT_WEBCAM_MASK,
	type WebcamColorSettings,
	type WebcamGreenscreenSettings,
	type WebcamMaskSettings,
	type WebcamOverlaySettings,
} from "@/components/video-editor/types";
import {
	hexToRgb01,
	KEY_SOFTNESS_MAX,
	KEY_SOFTNESS_MIN,
	KEY_TOLERANCE_MAX,
	KEY_TOLERANCE_MIN,
	SPILL_FACTOR,
	TEMPERATURE_SHIFT,
} from "./chromaKeyMath";
import { isMaskRenderable, maskSettingsKey, renderMaskToCanvas } from "./maskTexture";

export interface WebcamProcessingSettings {
	greenscreen: WebcamGreenscreenSettings;
	mask: WebcamMaskSettings;
	color: WebcamColorSettings;
}

export function resolveProcessingSettings(
	webcam: Partial<WebcamOverlaySettings> | null | undefined,
): WebcamProcessingSettings {
	return {
		greenscreen: webcam?.greenscreen ?? DEFAULT_WEBCAM_GREENSCREEN,
		mask: webcam?.mask ?? DEFAULT_WEBCAM_MASK,
		color: webcam?.color ?? DEFAULT_WEBCAM_COLOR,
	};
}

function isColorNeutral(color: WebcamColorSettings): boolean {
	return (
		color.brightness === 0 &&
		color.contrast === 0 &&
		color.highlights === 0 &&
		color.shadows === 0 &&
		color.temperature === 0 &&
		color.saturation === 0
	);
}

/** True when any processing stage would change pixels. */
export function isProcessingActive(
	webcam: Partial<WebcamOverlaySettings> | null | undefined,
): boolean {
	if (!webcam) {
		return false;
	}
	const { greenscreen, mask, color } = resolveProcessingSettings(webcam);
	return Boolean(greenscreen.enabled || mask.enabled || !isColorNeutral(color));
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_frame;
uniform sampler2D u_background;
uniform sampler2D u_maskTex;    // white = keep; rendered by maskTexture.ts
uniform bool u_hasBackground;
uniform bool u_keyEnabled;
uniform bool u_maskEnabled;
uniform vec3 u_keyColor;
uniform vec3 u_keyColor2;
uniform bool u_keyColor2Enabled;
uniform float u_keyStrength;
uniform float u_edgeSoftness;
uniform vec4 u_colorAdjust;     // brightness, contrast, highlights, shadows
uniform vec2 u_colorAdjust2;    // temperature, saturation
uniform float u_frameAspect;    // source width / height
uniform float u_backgroundAspect;
uniform bool u_flipBackground;  // compensate for the caller's mirror transform

const float KEY_TOLERANCE_MIN = ${KEY_TOLERANCE_MIN};
const float KEY_TOLERANCE_MAX = ${KEY_TOLERANCE_MAX};
const float KEY_SOFTNESS_MIN = ${KEY_SOFTNESS_MIN};
const float KEY_SOFTNESS_MAX = ${KEY_SOFTNESS_MAX};
const float SPILL_FACTOR = ${SPILL_FACTOR};
const float TEMPERATURE_SHIFT = ${TEMPERATURE_SHIFT};

vec2 rgbToCbCr(vec3 c) {
  return vec2(
    -0.169 * c.r - 0.331 * c.g + 0.5 * c.b,
    0.5 * c.r - 0.419 * c.g - 0.081 * c.b
  );
}

float lumaOf(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

float chromaKeyAlphaFor(vec3 pixel, vec3 keyColor) {
  vec2 p = rgbToCbCr(pixel);
  vec2 k = rgbToCbCr(keyColor);
  float dist = length(p - k);
  float tolerance = mix(KEY_TOLERANCE_MIN, KEY_TOLERANCE_MAX, u_keyStrength);
  float softness = mix(KEY_SOFTNESS_MIN, KEY_SOFTNESS_MAX, u_edgeSoftness);
  return smoothstep(tolerance, tolerance + softness, dist);
}

float chromaKeyAlpha(vec3 pixel) {
  // A pixel matching ANY key color is removed (minimum alpha wins) — two
  // samples cover the bright and shadowed regions of unevenly lit screens.
  float alpha = chromaKeyAlphaFor(pixel, u_keyColor);
  if (u_keyColor2Enabled) {
    alpha = min(alpha, chromaKeyAlphaFor(pixel, u_keyColor2));
  }
  return alpha;
}

vec3 suppressSpill(vec3 pixel, float alpha) {
  float amount = (1.0 - alpha) * SPILL_FACTOR;
  float limit = mix(pixel.g, max(pixel.r, pixel.b), amount);
  return vec3(pixel.r, min(pixel.g, limit), pixel.b);
}

vec3 applyColorAdjustments(vec3 c) {
  float brightness = u_colorAdjust.x;
  float contrast = u_colorAdjust.y;
  float highlights = u_colorAdjust.z;
  float shadows = u_colorAdjust.w;
  float temperature = u_colorAdjust2.x;
  float saturation = u_colorAdjust2.y;

  c += brightness * 0.5;
  c = (c - 0.5) * (1.0 + contrast) + 0.5;

  c.r += temperature * TEMPERATURE_SHIFT;
  c.b -= temperature * TEMPERATURE_SHIFT;

  c = mix(vec3(lumaOf(c)), c, 1.0 + saturation);

  float l = lumaOf(c);
  float highlightWeight = smoothstep(0.5, 1.0, l);
  float shadowWeight = 1.0 - smoothstep(0.0, 0.5, l);
  c += highlights * 0.5 * highlightWeight + shadows * 0.5 * shadowWeight;

  return clamp(c, 0.0, 1.0);
}

vec4 sampleBackground(vec2 uv) {
  if (!u_hasBackground) {
    return vec4(0.0);
  }
  // Cover-fit the background image to the frame aspect.
  vec2 scale = vec2(1.0);
  if (u_backgroundAspect > u_frameAspect) {
    scale.x = u_frameAspect / u_backgroundAspect;
  } else {
    scale.y = u_backgroundAspect / u_frameAspect;
  }
  vec2 bgUv = (uv - 0.5) * scale + 0.5;
  // Callers mirror the composited output for self-view; pre-flip the
  // background so it reads correctly after that mirror (only the camera
  // foreground should appear mirrored, never the replacement image).
  if (u_flipBackground) {
    bgUv.x = 1.0 - bgUv.x;
  }
  return texture(u_background, bgUv);
}

void main() {
  // Frame texture is uploaded top-left origin; v_uv is bottom-left.
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec4 src = texture(u_frame, uv);

  float alpha = 1.0;
  vec3 fg = src.rgb;

  if (u_keyEnabled) {
    alpha = chromaKeyAlpha(fg);
    fg = suppressSpill(fg, alpha);
  }
  if (u_maskEnabled) {
    alpha *= texture(u_maskTex, uv).r;
  }

  fg = applyColorAdjustments(fg);

  vec4 bg = sampleBackground(uv);
  vec3 composited = fg * alpha + bg.rgb * (1.0 - alpha);
  float outAlpha = alpha + bg.a * (1.0 - alpha);
  outColor = vec4(composited, outAlpha);
}`;

export class WebcamProcessor {
	private canvas: HTMLCanvasElement | null = null;
	private gl: WebGL2RenderingContext | null = null;
	private program: WebGLProgram | null = null;
	private frameTexture: WebGLTexture | null = null;
	private backgroundTexture: WebGLTexture | null = null;
	private maskTexture: WebGLTexture | null = null;
	private maskCanvas: HTMLCanvasElement | null = null;
	private maskKey: string | null = null;
	private backgroundImage: ImageBitmap | HTMLImageElement | null = null;
	private backgroundDirty = false;
	private backgroundAspect = 1;
	private uniforms: Record<string, WebGLUniformLocation | null> = {};
	private contextFailed = false;

	setBackgroundImage(image: ImageBitmap | HTMLImageElement | null): void {
		this.backgroundImage = image;
		this.backgroundDirty = true;
		this.backgroundAspect = image && image.height > 0 ? image.width / image.height : 1;
	}

	/**
	 * Process one frame; returns a canvas of (width, height) with the
	 * composited result, or null when WebGL is unavailable.
	 */
	processFrame(
		source: TexImageSource,
		width: number,
		height: number,
		settings: WebcamProcessingSettings,
		options?: { mirrored?: boolean },
	): HTMLCanvasElement | null {
		if (width <= 0 || height <= 0) {
			return null;
		}
		if (!this.ensureContext()) {
			return null;
		}
		const gl = this.gl as WebGL2RenderingContext;
		const canvas = this.canvas as HTMLCanvasElement;

		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		gl.viewport(0, 0, width, height);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.frameTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.backgroundTexture);
		if (this.backgroundDirty) {
			this.backgroundDirty = false;
			if (this.backgroundImage) {
				gl.texImage2D(
					gl.TEXTURE_2D,
					0,
					gl.RGBA,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					this.backgroundImage,
				);
			} else {
				gl.texImage2D(
					gl.TEXTURE_2D,
					0,
					gl.RGBA,
					1,
					1,
					0,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					new Uint8Array([0, 0, 0, 0]),
				);
			}
		}

		const { greenscreen, mask, color } = settings;
		const maskEnabled = mask.enabled && isMaskRenderable(mask);

		gl.activeTexture(gl.TEXTURE2);
		gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
		if (maskEnabled) {
			const maskKey = maskSettingsKey(mask);
			if (maskKey !== this.maskKey) {
				this.maskKey = maskKey;
				const maskCanvas = this.maskCanvas ?? document.createElement("canvas");
				this.maskCanvas = maskCanvas;
				renderMaskToCanvas(mask, maskCanvas);
				// Premultiply so feathered (semi-transparent white) edges land in
				// the red channel the shader samples as coverage.
				gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
				gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
			}
		}

		const keyColor = hexToRgb01(greenscreen.keyColor);
		const keyColor2 = greenscreen.keyColor2 ? hexToRgb01(greenscreen.keyColor2) : null;
		gl.uniform1i(this.uniforms.u_frame, 0);
		gl.uniform1i(this.uniforms.u_background, 1);
		gl.uniform1i(this.uniforms.u_maskTex, 2);
		gl.uniform1i(
			this.uniforms.u_hasBackground,
			greenscreen.enabled && this.backgroundImage ? 1 : 0,
		);
		gl.uniform1i(this.uniforms.u_keyEnabled, greenscreen.enabled ? 1 : 0);
		gl.uniform1i(this.uniforms.u_maskEnabled, maskEnabled ? 1 : 0);
		gl.uniform3f(this.uniforms.u_keyColor, keyColor.r, keyColor.g, keyColor.b);
		gl.uniform3f(
			this.uniforms.u_keyColor2,
			keyColor2?.r ?? 0,
			keyColor2?.g ?? 0,
			keyColor2?.b ?? 0,
		);
		gl.uniform1i(this.uniforms.u_keyColor2Enabled, keyColor2 ? 1 : 0);
		gl.uniform1f(this.uniforms.u_keyStrength, greenscreen.keyStrength);
		gl.uniform1f(this.uniforms.u_edgeSoftness, greenscreen.edgeSoftness);
		gl.uniform4f(
			this.uniforms.u_colorAdjust,
			color.brightness,
			color.contrast,
			color.highlights,
			color.shadows,
		);
		gl.uniform2f(this.uniforms.u_colorAdjust2, color.temperature, color.saturation);
		gl.uniform1f(this.uniforms.u_frameAspect, width / height);
		gl.uniform1f(this.uniforms.u_backgroundAspect, this.backgroundAspect);
		gl.uniform1i(this.uniforms.u_flipBackground, options?.mirrored ? 1 : 0);

		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		return canvas;
	}

	destroy(): void {
		const gl = this.gl;
		if (gl) {
			if (this.frameTexture) gl.deleteTexture(this.frameTexture);
			if (this.backgroundTexture) gl.deleteTexture(this.backgroundTexture);
			if (this.maskTexture) gl.deleteTexture(this.maskTexture);
			if (this.program) gl.deleteProgram(this.program);
		}
		this.gl = null;
		this.canvas = null;
		this.program = null;
		this.frameTexture = null;
		this.backgroundTexture = null;
		this.maskTexture = null;
		this.maskCanvas = null;
		this.maskKey = null;
		this.backgroundImage = null;
		this.uniforms = {};
	}

	private ensureContext(): boolean {
		if (this.gl && this.canvas) {
			return true;
		}
		if (this.contextFailed) {
			return false;
		}
		try {
			const canvas = document.createElement("canvas");
			const gl = canvas.getContext("webgl2", {
				premultipliedAlpha: false,
				preserveDrawingBuffer: true,
			});
			if (!gl) {
				this.contextFailed = true;
				return false;
			}

			const program = gl.createProgram();
			const vs = gl.createShader(gl.VERTEX_SHADER);
			const fs = gl.createShader(gl.FRAGMENT_SHADER);
			if (!program || !vs || !fs) {
				this.contextFailed = true;
				return false;
			}
			gl.shaderSource(vs, VERTEX_SHADER);
			gl.compileShader(vs);
			gl.shaderSource(fs, FRAGMENT_SHADER);
			gl.compileShader(fs);
			gl.attachShader(program, vs);
			gl.attachShader(program, fs);
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
				console.warn(
					"[webcam-processor] shader link failed:",
					gl.getProgramInfoLog(program),
					gl.getShaderInfoLog(vs),
					gl.getShaderInfoLog(fs),
				);
				this.contextFailed = true;
				return false;
			}
			// biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not a React hook
			gl.useProgram(program);

			const quad = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, quad);
			gl.bufferData(
				gl.ARRAY_BUFFER,
				new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
				gl.STATIC_DRAW,
			);
			const positionLocation = gl.getAttribLocation(program, "a_position");
			gl.enableVertexAttribArray(positionLocation);
			gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

			const createTexture = () => {
				const texture = gl.createTexture();
				gl.bindTexture(gl.TEXTURE_2D, texture);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
				return texture;
			};
			this.frameTexture = createTexture();
			this.backgroundTexture = createTexture();
			this.maskTexture = createTexture();
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA,
				1,
				1,
				0,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				new Uint8Array([255, 255, 255, 255]),
			);
			this.maskKey = null;
			this.backgroundDirty = true;

			for (const name of [
				"u_frame",
				"u_background",
				"u_maskTex",
				"u_hasBackground",
				"u_keyEnabled",
				"u_maskEnabled",
				"u_keyColor",
				"u_keyColor2",
				"u_keyColor2Enabled",
				"u_keyStrength",
				"u_edgeSoftness",
				"u_colorAdjust",
				"u_colorAdjust2",
				"u_frameAspect",
				"u_backgroundAspect",
				"u_flipBackground",
			]) {
				this.uniforms[name] = gl.getUniformLocation(program, name);
			}

			canvas.addEventListener("webglcontextlost", (event) => {
				event.preventDefault();
				this.gl = null;
				this.canvas = null;
			});

			this.canvas = canvas;
			this.gl = gl;
			this.program = program;
			return true;
		} catch (error) {
			console.warn("[webcam-processor] WebGL init failed:", error);
			this.contextFailed = true;
			return false;
		}
	}
}
