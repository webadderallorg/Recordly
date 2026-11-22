import { Filter, GlProgram, GpuProgram } from "pixi.js";

const MAX_SAMPLES = 32;
const DEFAULT_KERNEL_SIZE = 32;

const vertexGlsl = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}`;

const fragmentGlsl = `precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec2 uCenter;
uniform float uStrength;
uniform float uSampleCount;

void main(void)
{
    int samples = int(uSampleCount);
    if (samples <= 0 || uStrength <= 0.0001) {
        finalColor = texture(uTexture, vTextureCoord);
        return;
    }

    vec2 dir = (uCenter * uInputSize.zw - vTextureCoord) * uStrength;
    vec4 acc = vec4(0.0);
    float totalWeight = 0.0;
    float invSamples = 1.0 / uSampleCount;

    for (int i = 0; i < ${MAX_SAMPLES}; i++) {
        if (i >= samples) {
            break;
        }
        float t = (float(i) + 0.5) * invSamples;
        float centered = t - 0.5;
        float weight = 1.0 / (1.0 + 3.0 * centered * centered);
        acc += texture(uTexture, vTextureCoord + dir * (1.0 - t)) * weight;
        totalWeight += weight;
    }

    finalColor = acc / totalWeight;
}`;

const vertexWgsl = `struct GlobalFilterUniforms {
  uInputSize:vec4<f32>,
  uInputPixel:vec4<f32>,
  uInputClamp:vec4<f32>,
  uOutputFrame:vec4<f32>,
  uGlobalFrame:vec4<f32>,
  uOutputTexture:vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;

struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv : vec2<f32>
  };

fn filterVertexPosition(aPosition:vec2<f32>) -> vec4<f32>
{
    var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;

    position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord( aPosition:vec2<f32> ) -> vec2<f32>
{
    return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(
  @location(0) aPosition : vec2<f32>,
) -> VSOutput {
  return VSOutput(
   filterVertexPosition(aPosition),
   filterTextureCoord(aPosition)
  );
}`;

const fragmentWgsl = `struct ZoomBlurUniforms {
  uCenter:vec2<f32>,
  uStrength:f32,
  uSampleCount:f32,
};

struct GlobalFilterUniforms {
  uInputSize:vec4<f32>,
  uInputPixel:vec4<f32>,
  uInputClamp:vec4<f32>,
  uOutputFrame:vec4<f32>,
  uGlobalFrame:vec4<f32>,
  uOutputTexture:vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> zoomBlurUniforms : ZoomBlurUniforms;

@fragment
fn mainFragment(
    @builtin(position) position: vec4<f32>,
    @location(0) uv : vec2<f32>
) -> @location(0) vec4<f32> {
  let samples = i32(zoomBlurUniforms.uSampleCount);
  let strength = zoomBlurUniforms.uStrength;
  if (samples <= 0 || strength <= 0.0001) {
    return textureSampleLevel(uTexture, uSampler, uv, 0.0);
  }

  let dir = (zoomBlurUniforms.uCenter * gfu.uInputSize.zw - uv) * strength;
  var acc = vec4<f32>(0.0);
  var totalWeight:f32 = 0.0;
  let invSamples = 1.0 / zoomBlurUniforms.uSampleCount;

  for (var i:i32 = 0; i < ${MAX_SAMPLES}; i = i + 1) {
    if (i >= samples) {
      break;
    }
    let t = (f32(i) + 0.5) * invSamples;
    let centered = t - 0.5;
    let weight = 1.0 / (1.0 + 3.0 * centered * centered);
    acc = acc + textureSampleLevel(uTexture, uSampler, uv + dir * (1.0 - t), 0.0) * weight;
    totalWeight = totalWeight + weight;
  }

  return acc / totalWeight;
}`;

export interface ZoomBlurOptions {
	strength?: number;
	center?: { x: number; y: number } | number[];
	maxKernelSize?: number;
}

export class ZoomBlurFilter extends Filter {
	private declare uniforms: {
		uCenter: { x: number; y: number };
		uStrength: number;
		uSampleCount: number;
	};

	private _strength = 0;
	private _maxKernelSize = DEFAULT_KERNEL_SIZE;

	constructor(options: ZoomBlurOptions = {}) {
		const gpuProgram = GpuProgram.from({
			vertex: { source: vertexWgsl, entryPoint: "mainVertex" },
			fragment: { source: fragmentWgsl, entryPoint: "mainFragment" },
		});
		const glProgram = GlProgram.from({
			vertex: vertexGlsl,
			fragment: fragmentGlsl,
			name: "zoom-blur-filter",
		});
		super({
			gpuProgram,
			glProgram,
			resources: {
				zoomBlurUniforms: {
					uCenter: { value: { x: 0, y: 0 }, type: "vec2<f32>" },
					uStrength: { value: 0, type: "f32" },
					uSampleCount: { value: DEFAULT_KERNEL_SIZE, type: "f32" },
				},
			},
		});
		this.uniforms = this.resources.zoomBlurUniforms.uniforms;
		this.maxKernelSize = options.maxKernelSize ?? DEFAULT_KERNEL_SIZE;
		this.strength = options.strength ?? 0;
		if (options.center !== undefined) {
			this.center = options.center;
		}
		this.padding = 0;
	}

	get strength(): number {
		return this._strength;
	}
	set strength(value: number) {
		this._strength = value;
		const clamped = Math.min(Math.max(value, 0), 1);
		this.uniforms.uStrength = clamped;
		this.enabled = clamped > 0.0001 && this._maxKernelSize > 0;
	}

	get center(): { x: number; y: number } {
		return this.uniforms.uCenter;
	}
	set center(value: { x: number; y: number } | number[]) {
		const next = Array.isArray(value) ? { x: value[0] ?? 0, y: value[1] ?? 0 } : value;
		this.uniforms.uCenter.x = next.x ?? 0;
		this.uniforms.uCenter.y = next.y ?? 0;
	}

	get centerX(): number {
		return this.uniforms.uCenter.x;
	}
	set centerX(value: number) {
		this.uniforms.uCenter.x = value;
	}

	get centerY(): number {
		return this.uniforms.uCenter.y;
	}
	set centerY(value: number) {
		this.uniforms.uCenter.y = value;
	}

	get maxKernelSize(): number {
		return this._maxKernelSize;
	}
	set maxKernelSize(value: number) {
		this._maxKernelSize = value;
		this.uniforms.uSampleCount = Math.min(Math.max(Math.round(value), 0), MAX_SAMPLES);
		this.enabled = this.uniforms.uStrength > 0.0001 && this.uniforms.uSampleCount > 0;
	}
}
