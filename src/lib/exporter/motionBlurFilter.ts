import { Filter, GlProgram, GpuProgram } from "pixi.js";

const MAX_PAIRS = 8;
const HALF_SIGMA_SPAN = "2.5";
const SPREAD_SCALE = 0.3125;
const MIN_SPEED = 2;

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
uniform vec2 uDelta;
uniform vec2 uShift;
uniform float uPairCount;

void main(void)
{
    int pairs = int(uPairCount);
    if (pairs <= 0 || dot(uDelta, uDelta) == 0.0) {
        finalColor = texture(uTexture, vTextureCoord);
        return;
    }

    vec4 acc = vec4(0.0);
    float totalWeight = 0.0;
    vec2 baseCoord = vTextureCoord + uShift * uInputSize.zw;
    vec2 sigmaStep = uDelta * uInputSize.zw;
    float invPairs = 1.0 / uPairCount;

    for (int i = 0; i < ${MAX_PAIRS}; i++) {
        if (i >= pairs) {
            break;
        }
        float u = (float(i) + 0.5) * invPairs * ${HALF_SIGMA_SPAN};
        float weight = exp(-0.5 * u * u);
        vec2 offset = sigmaStep * u;
        acc += (texture(uTexture, baseCoord + offset) + texture(uTexture, baseCoord - offset)) * weight;
        totalWeight += weight * 2.0;
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

const fragmentWgsl = `struct MotionBlurUniforms {
  uDelta:vec2<f32>,
  uShift:vec2<f32>,
  uPairCount:f32,
  uPadding:vec3<f32>,
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
@group(1) @binding(0) var<uniform> motionBlurUniforms : MotionBlurUniforms;

@fragment
fn mainFragment(
    @builtin(position) position: vec4<f32>,
    @location(0) uv : vec2<f32>
) -> @location(0) vec4<f32> {
  let pairs = i32(motionBlurUniforms.uPairCount);
  if (pairs <= 0 || dot(motionBlurUniforms.uDelta, motionBlurUniforms.uDelta) == 0.0) {
    return textureSampleLevel(uTexture, uSampler, uv, 0.0);
  }

  var acc = vec4<f32>(0.0);
  var totalWeight:f32 = 0.0;
  let baseCoord = uv + motionBlurUniforms.uShift * gfu.uInputSize.zw;
  let sigmaStep = motionBlurUniforms.uDelta * gfu.uInputSize.zw;
  let invPairs = 1.0 / motionBlurUniforms.uPairCount;

  for (var i:i32 = 0; i < ${MAX_PAIRS}; i = i + 1) {
    if (i >= pairs) {
      break;
    }
    let u = (f32(i) + 0.5) * invPairs * ${HALF_SIGMA_SPAN};
    let weight = exp(-0.5 * u * u);
    let offset = sigmaStep * u;
    let pairSum = textureSampleLevel(uTexture, uSampler, baseCoord + offset, 0.0)
      + textureSampleLevel(uTexture, uSampler, baseCoord - offset, 0.0);
    acc = acc + pairSum * weight;
    totalWeight = totalWeight + weight * 2.0;
  }

  return acc / totalWeight;
}`;

export interface MotionBlurOptions {
	velocity?: { x: number; y: number } | number[];
	kernelSize?: number;
	offset?: number;
}

export class MotionBlurFilter extends Filter {
	private declare uniforms: {
		uDelta: { x: number; y: number };
		uShift: { x: number; y: number };
		uPairCount: number;
	};

	private _velocity = { x: 0, y: 0 };
	private _offset = 0;
	private _kernelSize = 5;

	constructor(
		optionsOrVelocity: MotionBlurOptions | { x: number; y: number } | number[] = {},
		kernelSize?: number,
		offset?: number,
	) {
		const gpuProgram = GpuProgram.from({
			vertex: { source: vertexWgsl, entryPoint: "mainVertex" },
			fragment: { source: fragmentWgsl, entryPoint: "mainFragment" },
		});
		const glProgram = GlProgram.from({
			vertex: vertexGlsl,
			fragment: fragmentGlsl,
			name: "motion-blur-filter",
		});
		super({
			gpuProgram,
			glProgram,
			resources: {
				motionBlurUniforms: {
					uDelta: { value: { x: 0, y: 0 }, type: "vec2<f32>" },
					uShift: { value: { x: 0, y: 0 }, type: "vec2<f32>" },
					uPairCount: { value: 0, type: "f32" },
					uPadding: { value: [0, 0, 0], type: "vec3<f32>" },
				},
			},
		});
		this.uniforms = this.resources.motionBlurUniforms.uniforms;

		let resolved: MotionBlurOptions = optionsOrVelocity as MotionBlurOptions;
		if (
			Array.isArray(optionsOrVelocity) ||
			("x" in optionsOrVelocity &&
				"y" in optionsOrVelocity &&
				!("velocity" in optionsOrVelocity))
		) {
			resolved = {
				velocity: optionsOrVelocity as { x: number; y: number } | number[],
				kernelSize,
				offset,
			};
		}

		if (resolved.velocity !== undefined) {
			this.velocity = resolved.velocity;
		}
		this.kernelSize = resolved.kernelSize ?? 5;
		this.offset = resolved.offset ?? 0;
		this.syncUniforms();
	}

	get velocity(): { x: number; y: number } {
		return this._velocity;
	}
	set velocity(value: { x: number; y: number } | number[]) {
		const next = Array.isArray(value) ? { x: value[0] ?? 0, y: value[1] ?? 0 } : value;
		this._velocity = { x: next.x ?? 0, y: next.y ?? 0 };
		this.syncUniforms();
	}

	get velocityX(): number {
		return this._velocity.x;
	}
	set velocityX(value: number) {
		this.velocity = { x: value, y: this._velocity.y };
	}

	get velocityY(): number {
		return this._velocity.y;
	}
	set velocityY(value: number) {
		this.velocity = { x: this._velocity.x, y: value };
	}

	get kernelSize(): number {
		return this._kernelSize;
	}
	set kernelSize(value: number) {
		this._kernelSize = value;
		this.syncUniforms();
	}

	get offset(): number {
		return this._offset;
	}
	set offset(value: number) {
		this._offset = value;
		this.syncUniforms();
	}

	private syncUniforms() {
		const speed = Math.hypot(this._velocity.x, this._velocity.y);
		if (speed < MIN_SPEED || this._kernelSize <= 0) {
			this.uniforms.uDelta.x = 0;
			this.uniforms.uDelta.y = 0;
			this.uniforms.uShift.x = 0;
			this.uniforms.uShift.y = 0;
			this.uniforms.uPairCount = 0;
			this.padding = 0;
			this.enabled = false;
			return;
		}

		this.uniforms.uDelta.x = this._velocity.x * SPREAD_SCALE;
		this.uniforms.uDelta.y = this._velocity.y * SPREAD_SCALE;
		const shiftFactor = -this._offset / speed;
		this.uniforms.uShift.x = this._velocity.x * shiftFactor;
		this.uniforms.uShift.y = this._velocity.y * shiftFactor;
		this.uniforms.uPairCount = Math.min(
			Math.max(Math.ceil(this._kernelSize * 0.5), 3),
			MAX_PAIRS,
		);
		this.padding = Math.ceil(speed * SPREAD_SCALE * 3) + 4;
		this.enabled = true;
	}
}
