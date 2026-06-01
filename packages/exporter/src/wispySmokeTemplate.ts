import { stableJson, type EffectIR, type ParameterMap } from "@threefx/core";

function paramsLiteral(params: ParameterMap): string {
  return JSON.stringify(params, null, 2)
    .replaceAll('"worldPosition": [', '"worldPosition": [')
    .replaceAll('"wind": [', '"wind": [');
}

function runtimeConfigLiteral(ir: EffectIR): string {
  return JSON.stringify(ir.runtimeConfig, null, 2);
}

export function createWispySmokeClassSource(ir: EffectIR, className: string): string {
  return `import * as THREE from "three/webgpu";
import type { IUniform } from "three";
import type { Node, UniformNode } from "three/webgpu";
import type StorageBufferNodeBase from "three/src/nodes/accessors/StorageBufferNode.js";
import {
  Break,
  Fn,
  If,
  clamp as nodeClamp,
  dot,
  float,
  floor,
  instancedArray,
  instanceIndex,
  int,
  mix,
  smoothstep as nodeSmoothstep,
  texture3D,
  textureStore,
  uniform,
  uint,
  uvec3,
  vec3,
  vec4,
} from "three/tsl";
import { RaymarchingBox } from "three/examples/jsm/tsl/utils/Raymarching.js";

export type WispySmokeQuality = "low" | "medium" | "high" | "cinematic";
export type WispySmokeBackendMode = "auto" | "webgpu" | "compat";
export type WispySmokeGridResolution = "low" | "medium" | "high" | "cinematic";
export type WispySmokeAdvectionMode = "nearest" | "trilinear" | "maccormack";
export type WispySmokeBlendMode = "normal" | "additive";
export type WispySmokeDebugView = "final" | "density" | "temperature" | "velocity" | "divergence" | "pressure" | "obstacles" | "bounds";
export type WispySmokeEmitterShape = "sphere" | "box";
export type WispySmokeFieldType = "curl" | "fbm";
export type WispySmokeForceType = "buoyancy" | "wind" | "vortex";
export type WispySmokeObstacleShape = "sphere" | "box";
export type Vec3 = readonly [number, number, number];
export type CurveKeyframe = { readonly time: number; readonly value: number };
export type CurveValue = readonly CurveKeyframe[];
export type RuntimeBackend = "webgpu" | "compat";

export interface VFXEffect<TParams> {
  readonly object3D: THREE.Object3D;
  update(deltaSeconds: number, elapsedSeconds?: number): void;
  setParams(params: Partial<TParams>): void;
  getParams(): Readonly<TParams>;
  dispose(): void;
}

export interface ${className}Params {
  readonly spawnRate: number;
  readonly lifetime: number;
  readonly density: number;
  readonly baseDensity: number;
  readonly opacity: number;
  readonly opacityRamp: CurveValue;
  readonly size: number;
  readonly radius: number;
  readonly height: number;
  readonly sourcePosition: Vec3;
  readonly sourceScale: Vec3;
  readonly sourceVelocity: Vec3;
  readonly sourceFalloff: number;
  readonly sourceNoiseScale: number;
  readonly sourceNoiseStrength: number;
  readonly riseSpeed: number;
  readonly buoyantLift: number;
  readonly wind: Vec3;
  readonly vortexPosition: Vec3;
  readonly vortexRadius: number;
  readonly vortexStrength: number;
  readonly turbulence: number;
  readonly turbulenceBands: number;
  readonly curlStrength: number;
  readonly vorticityConfinement: number;
  readonly dissipation: number;
  readonly densityDissipation: number;
  readonly velocityDissipation: number;
  readonly pressureIterations: number;
  readonly diffusion: number;
  readonly diffusionIterations: number;
  readonly advectionMode: WispySmokeAdvectionMode;
  readonly sourceTemperature: number;
  readonly plumeTaper: number;
  readonly softness: number;
  readonly color: string;
  readonly emissionColor: string;
  readonly emissionIntensity: number;
  readonly absorption: number;
  readonly scattering: number;
  readonly detailScale: number;
  readonly detailStrength: number;
  readonly detailSpeed: number;
  readonly detailOctaves: number;
  readonly shadowStrength: number;
  readonly blendMode: WispySmokeBlendMode;
  readonly sourceGlowEnabled: boolean;
  readonly sourceGlowColor: string;
  readonly sourceGlowIntensity: number;
  readonly sourceGlowRadius: number;
  readonly sourceGlowSoftness: number;
  readonly seed: number;
  readonly quality: WispySmokeQuality;
  readonly backendMode: WispySmokeBackendMode;
  readonly gridResolution: WispySmokeGridResolution;
  readonly renderStepScale: number;
  readonly shadowQuality: number;
  readonly debugView: WispySmokeDebugView;
  readonly worldPosition: Vec3;
  readonly obstaclePosition: Vec3;
  readonly obstacleScale: Vec3;
  readonly obstacleRadius: number;
  readonly obstacleSoftness: number;
}

export interface ${className}Stats {
  readonly activeDebugView: WispySmokeDebugView;
  readonly advectionMode: WispySmokeAdvectionMode;
  readonly backend: RuntimeBackend;
  readonly diffusionIterations: number;
  readonly emitterCount: number;
  readonly fallbackActive: boolean;
  readonly fieldCount: number;
  readonly forceCount: number;
  readonly gridCells: number;
  readonly gridResolution: Vec3;
  readonly obstacleCount: number;
  readonly pressureIterations: number;
  readonly requestedBackend: WispySmokeBackendMode;
  readonly renderSteps: number;
  readonly simulationMs: number;
  readonly solverPasses: number;
}

export type ${className}Options = Partial<${className}Params> & {
  readonly config?: Partial<WispySmokeRuntimeConfig>;
  readonly renderer?: unknown;
  readonly position?: Vec3;
};

export interface WispySmokeEmitterConfig {
  readonly id: string;
  readonly shape: WispySmokeEmitterShape;
  readonly density: number;
  readonly falloff: number;
  readonly lifetime: number;
  readonly noiseScale: number;
  readonly noiseStrength: number;
  readonly position: Vec3;
  readonly radius: number;
  readonly scale: Vec3;
  readonly spawnRate: number;
  readonly temperature: number;
  readonly velocity: Vec3;
}

export interface WispySmokeForceConfig {
  readonly id: string;
  readonly type: WispySmokeForceType;
  readonly buoyantLift: number;
  readonly position: Vec3;
  readonly radius: number;
  readonly riseSpeed: number;
  readonly strength: number;
  readonly wind: Vec3;
}

export interface WispySmokeFieldConfig {
  readonly id: string;
  readonly type: WispySmokeFieldType;
  readonly bands: number;
  readonly curlStrength: number;
  readonly scale: number;
  readonly speed: number;
  readonly strength: number;
  readonly vorticityConfinement: number;
}

export interface WispySmokeObstacleConfig {
  readonly id: string;
  readonly shape: WispySmokeObstacleShape;
  readonly position: Vec3;
  readonly radius: number;
  readonly scale: Vec3;
  readonly softness: number;
}

export interface WispySmokeRuntimeConfig {
  readonly debug: { readonly view: WispySmokeDebugView };
  readonly emitters: readonly WispySmokeEmitterConfig[];
  readonly fields: readonly WispySmokeFieldConfig[];
  readonly forces: readonly WispySmokeForceConfig[];
  readonly obstacles: readonly WispySmokeObstacleConfig[];
  readonly render: {
    readonly absorption: number;
    readonly baseDensity: number;
    readonly blendMode: WispySmokeBlendMode;
    readonly detailOctaves: number;
    readonly detailScale: number;
    readonly detailSpeed: number;
    readonly detailStrength: number;
    readonly opacity: number;
    readonly opacityRamp: CurveValue;
    readonly plumeTaper: number;
    readonly renderStepScale: number;
    readonly scattering: number;
    readonly shadowQuality: number;
    readonly shadowStrength: number;
    readonly smokeColor: string;
    readonly softness: number;
  };
  readonly solver: {
    readonly advectionMode: WispySmokeAdvectionMode;
    readonly backendMode: WispySmokeBackendMode;
    readonly densityDissipation: number;
    readonly diffusion: number;
    readonly diffusionIterations: number;
    readonly gridResolution: WispySmokeGridResolution;
    readonly pressureIterations: number;
    readonly quality: WispySmokeQuality;
    readonly seed: number;
    readonly velocityDissipation: number;
  };
  readonly sourceGlow: {
    readonly blendMode: WispySmokeBlendMode;
    readonly color: string;
    readonly enabled: boolean;
    readonly intensity: number;
    readonly radius: number;
    readonly softness: number;
  };
  readonly transform: { readonly worldPosition: Vec3 };
}

interface VolumeBounds {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

interface FluidUniforms {
  readonly absorption: UniformNode<"float", number>;
  readonly baseDensity: UniformNode<"float", number>;
  readonly buoyancy: UniformNode<"float", number>;
  readonly curlStrength: UniformNode<"float", number>;
  readonly densityDissipation: UniformNode<"float", number>;
  readonly detailScale: UniformNode<"float", number>;
  readonly detailSpeed: UniformNode<"float", number>;
  readonly detailStrength: UniformNode<"float", number>;
  readonly diffusion: UniformNode<"float", number>;
  readonly dt: UniformNode<"float", number>;
  readonly emissionColor: UniformNode<"color", THREE.Color>;
  readonly emissionIntensity: UniformNode<"float", number>;
  readonly opacity: UniformNode<"float", number>;
  readonly radius: UniformNode<"float", number>;
  readonly riseSpeed: UniformNode<"float", number>;
  readonly scattering: UniformNode<"float", number>;
  readonly shadowSamples: UniformNode<"float", number>;
  readonly shadowStrength: UniformNode<"float", number>;
  readonly smokeColor: UniformNode<"color", THREE.Color>;
  readonly sourceRate: UniformNode<"float", number>;
  readonly sourceTemperature: UniformNode<"float", number>;
  readonly sourceVelocity: UniformNode<"vec3", THREE.Vector3>;
  readonly steps: UniformNode<"float", number>;
  readonly time: UniformNode<"float", number>;
  readonly turbulence: UniformNode<"float", number>;
  readonly velocityDissipation: UniformNode<"float", number>;
  readonly vorticity: UniformNode<"float", number>;
  readonly wind: UniformNode<"vec3", THREE.Vector3>;
}

type Texture3DNode = ReturnType<typeof texture3D>;
type Vec4StorageBuffer = StorageBufferNodeBase<"vec4">;
type FloatStorageBuffer = StorageBufferNodeBase<"float">;

interface SmokeRaymarchArgs {
  readonly [key: string]: unknown;
  readonly absorption: Node<"float">;
  readonly baseDensity: Node<"float">;
  readonly detailScale: Node<"float">;
  readonly detailSpeed: Node<"float">;
  readonly detailStrength: Node<"float">;
  readonly emissionColor: Node<"color">;
  readonly emissionIntensity: Node<"float">;
  readonly opacity: Node<"float">;
  readonly scattering: Node<"float">;
  readonly shadowSamples: Node<"float">;
  readonly shadowStrength: Node<"float">;
  readonly smokeColor: Node<"color">;
  readonly steps: Node<"float">;
  readonly texture: Texture3DNode;
  readonly time: Node<"float">;
}

interface ComputeRenderer {
  compute(computeNode: object | readonly object[], dispatchSize?: number | readonly number[]): void | Promise<void>;
}

interface SmokeParticle {
  age: number;
  angle: number;
  baseSize: number;
  lifetime: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  x: number;
  y: number;
  z: number;
}

const RUNTIME_SOLVER = "eulerian-fluid-grid";
const DEFAULT_PARAMS: ${className}Params = ${paramsLiteral(ir.parameterValues)} as ${className}Params;
const DEFAULT_RUNTIME_CONFIG: WispySmokeRuntimeConfig = ${runtimeConfigLiteral(ir)} as WispySmokeRuntimeConfig;
const SOURCE_DENSITY_RATE_SCALE = 0.012;

const QUALITY: Record<WispySmokeQuality, { maxParticles: number; maxRaySteps: number; volumeGrid: Vec3 }> = {
  low: { maxParticles: 64, maxRaySteps: 48, volumeGrid: [32, 32, 32] },
  medium: { maxParticles: 96, maxRaySteps: 64, volumeGrid: [48, 48, 48] },
  high: { maxParticles: 128, maxRaySteps: 80, volumeGrid: [64, 64, 64] },
  cinematic: { maxParticles: 160, maxRaySteps: 112, volumeGrid: [96, 96, 96] },
};

const QUALITY_RANK: Record<WispySmokeQuality, number> = {
  low: 0,
  medium: 1,
  high: 2,
  cinematic: 3,
};

const COMPAT_VERTEX_SHADER = \`
attribute float aAlpha;
attribute float aAngle;
attribute float aSize;
varying float vAlpha;
varying float vAngle;
void main() {
  vAlpha = aAlpha;
  vAngle = aAngle;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * (260.0 / max(0.01, -mvPosition.z)));
  gl_Position = projectionMatrix * mvPosition;
}
\`;

const COMPAT_FRAGMENT_SHADER = \`
precision highp float;
uniform vec3 uColor;
uniform vec3 uEmissionColor;
uniform float uEmissionIntensity;
uniform float uOpacity;
uniform float uSoftness;
uniform float uTime;
varying float vAlpha;
varying float vAngle;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float s = sin(vAngle);
  float c = cos(vAngle);
  uv = mat2(c, -s, s, c) * uv;
  float radius = length(uv);
  float radial = 1.0 - smoothstep(0.14 + uSoftness * 0.24, 0.5, radius);
  float filament = noise(uv * 7.0 + vec2(uTime * 0.05, -uTime * 0.04));
  float alpha = radial * smoothstep(0.18, 0.82, filament + (0.5 - radius) * 0.8) * vAlpha * uOpacity;
  if (alpha < 0.012) discard;
  vec3 source = mix(uEmissionColor * uEmissionIntensity, uColor, smoothstep(0.2, 0.62, radius));
  gl_FragColor = vec4(mix(uColor * 0.72, source, vAlpha * 0.28), alpha);
}
\`;

const VOLUME_RAYMARCH = Fn(({
  absorption,
  baseDensity,
  debugView,
  detailScale,
  detailSpeed,
  detailStrength,
  emissionColor,
  emissionIntensity,
  opacity,
  scattering,
  shadowSamples: _shadowSamples,
  shadowStrength,
  smokeColor,
  steps,
  texture,
  time,
}: SmokeRaymarchArgs) => {
  const finalColor = vec4(0).toVar();
  const lightDir = vec3(0.4, 0.85, 0.25).normalize();

  RaymarchingBox(steps, ({ positionRay }) => {
    const uvw = positionRay.add(0.5).clamp(0.001, 0.999);
    const packed = texture.sample(uvw);
    const density = packed.r.mul(baseDensity).toVar();
    const temperature = packed.g.mul(0.22);

    const detailCoord = uvw.mul(detailScale).add(vec3(
      time.mul(detailSpeed).mul(0.18),
      time.mul(detailSpeed).mul(-0.26),
      time.mul(detailSpeed).mul(0.13),
    ));
    const detail = valueNoise3D(detailCoord).toVar();
    detail.addAssign(valueNoise3D(detailCoord.mul(2.8)).mul(0.55));
    detail.addAssign(valueNoise3D(detailCoord.mul(5.6)).mul(0.32));
    detail.addAssign(valueNoise3D(detailCoord.mul(11.2)).mul(0.18));
    detail.assign(detail.div(2.05));
    density.assign(density.mul(detail.sub(0.48).mul(detailStrength).add(1).clamp(0.18, 2.4)));

    const heightRamp = uvw.y;
    density.assign(density.mul(nodeSmoothstep(0.03, 0.18, heightRamp)));
    const topFade = nodeSmoothstep(0.78, 0.97, heightRamp).oneMinus();
    density.assign(density.mul(topFade));

    const beer = density.mul(absorption.mul(0.018)).negate().exp().oneMinus();
    const sampleAlpha = beer.mul(opacity.mul(0.82)).mul(topFade.mul(0.6).add(0.4)).clamp(0, 0.38).toVar();
    const shadow = texture.sample(uvw.add(lightDir.mul(0.08)).clamp(0.001, 0.999)).r.mul(0.6)
      .add(texture.sample(uvw.add(lightDir.mul(0.18)).clamp(0.001, 0.999)).r.mul(0.4));
    const selfShadow = shadow.mul(absorption.mul(shadowStrength).mul(0.2)).negate().exp().clamp(0.45, 1);
    const sampleColor = smokeColor.rgb.mul(scattering.mul(0.62)).mul(selfShadow.mul(0.65).add(0.35))
      .add(emissionColor.rgb.mul(emissionIntensity.mul(0.32)).mul(temperature))
      .toVar();

    If(debugView.greaterThan(0.5), () => {
      sampleColor.assign(vec3(density.mul(2.0)));
      sampleAlpha.assign(density.mul(0.7));
    });

    const contribution = finalColor.a.oneMinus().mul(sampleAlpha);
    finalColor.rgb.addAssign(contribution.mul(sampleColor));
    finalColor.a.addAssign(contribution);

    If(finalColor.a.greaterThanEqual(0.92), () => {
      Break();
    });
  });

  return finalColor;
});
function hashVec3(cell: Node<"vec3">): Node<"float"> {
  return cell.x
    .mul(127.1)
    .add(cell.y.mul(311.7))
    .add(cell.z.mul(74.7))
    .sin()
    .mul(43758.5453123)
    .fract();
}

function valueNoise3D(coord: Node<"vec3">): Node<"float"> {
  const cell = floor(coord);
  const frac = coord.sub(cell).clamp(vec3(0), vec3(1));
  const smoothFrac = frac.mul(frac).mul(vec3(3).sub(frac.mul(2)));
  const n000 = hashVec3(cell);
  const n100 = hashVec3(cell.add(vec3(1, 0, 0)));
  const n010 = hashVec3(cell.add(vec3(0, 1, 0)));
  const n110 = hashVec3(cell.add(vec3(1, 1, 0)));
  const n001 = hashVec3(cell.add(vec3(0, 0, 1)));
  const n101 = hashVec3(cell.add(vec3(1, 0, 1)));
  const n011 = hashVec3(cell.add(vec3(0, 1, 1)));
  const n111 = hashVec3(cell.add(vec3(1, 1, 1)));
  const x00 = mix(n000, n100, smoothFrac.x);
  const x10 = mix(n010, n110, smoothFrac.x);
  const x01 = mix(n001, n101, smoothFrac.x);
  const x11 = mix(n011, n111, smoothFrac.x);
  const y0 = mix(x00, x10, smoothFrac.y);
  const y1 = mix(x01, x11, smoothFrac.y);
  return mix(y0, y1, smoothFrac.z);
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isWebGPURenderer(renderer: unknown): boolean {
  return Boolean(renderer && typeof renderer === "object" && (renderer as { readonly isWebGPURenderer?: unknown }).isWebGPURenderer === true);
}

function hasComputeRenderer(renderer: unknown): renderer is ComputeRenderer {
  return Boolean(renderer && typeof renderer === "object" && "compute" in renderer);
}

function normalizeParams(params: Partial<${className}Params> = {}): ${className}Params {
  return {
    ...DEFAULT_PARAMS,
    ...params,
    advectionMode: params.advectionMode ?? DEFAULT_PARAMS.advectionMode,
    backendMode: params.backendMode ?? DEFAULT_PARAMS.backendMode,
    blendMode: params.blendMode ?? DEFAULT_PARAMS.blendMode,
    color: params.color ?? DEFAULT_PARAMS.color,
    debugView: params.debugView ?? DEFAULT_PARAMS.debugView,
    emissionColor: params.emissionColor ?? DEFAULT_PARAMS.emissionColor,
    gridResolution: params.gridResolution ?? DEFAULT_PARAMS.gridResolution,
    obstaclePosition: params.obstaclePosition ?? DEFAULT_PARAMS.obstaclePosition,
    obstacleScale: params.obstacleScale ?? DEFAULT_PARAMS.obstacleScale,
    opacityRamp: params.opacityRamp ?? DEFAULT_PARAMS.opacityRamp,
    quality: params.quality ?? DEFAULT_PARAMS.quality,
    sourceGlowColor: params.sourceGlowColor ?? DEFAULT_PARAMS.sourceGlowColor,
    sourcePosition: params.sourcePosition ?? DEFAULT_PARAMS.sourcePosition,
    sourceScale: params.sourceScale ?? DEFAULT_PARAMS.sourceScale,
    sourceVelocity: params.sourceVelocity ?? DEFAULT_PARAMS.sourceVelocity,
    vortexPosition: params.vortexPosition ?? DEFAULT_PARAMS.vortexPosition,
    worldPosition: params.worldPosition ?? DEFAULT_PARAMS.worldPosition,
    wind: params.wind ?? DEFAULT_PARAMS.wind,
  };
}

function cloneRuntimeConfig(config: WispySmokeRuntimeConfig): WispySmokeRuntimeConfig {
  return JSON.parse(JSON.stringify(config)) as WispySmokeRuntimeConfig;
}

function configFromParams(params: ${className}Params): WispySmokeRuntimeConfig {
  const base = cloneRuntimeConfig(DEFAULT_RUNTIME_CONFIG);
  const emitters = base.emitters.length > 0
    ? base.emitters
    : [{
        density: params.density,
        falloff: params.sourceFalloff,
        id: "emitter",
        lifetime: params.lifetime,
        noiseScale: params.sourceNoiseScale,
        noiseStrength: params.sourceNoiseStrength,
        position: params.sourcePosition,
        radius: params.radius,
        scale: params.sourceScale,
        shape: "sphere" as const,
        spawnRate: params.spawnRate,
        temperature: params.sourceTemperature,
        velocity: params.sourceVelocity,
      }];
  return {
    ...base,
    debug: { view: params.debugView },
    emitters: emitters.map((emitter, index) => index === 0 ? {
      ...emitter,
      density: params.density,
      falloff: params.sourceFalloff,
      lifetime: params.lifetime,
      noiseScale: params.sourceNoiseScale,
      noiseStrength: params.sourceNoiseStrength,
      position: params.sourcePosition,
      radius: params.radius,
      scale: params.sourceScale,
      spawnRate: params.spawnRate,
      temperature: params.sourceTemperature,
      velocity: params.sourceVelocity,
    } : emitter),
    render: {
      ...base.render,
      absorption: params.absorption,
      baseDensity: params.baseDensity,
      blendMode: params.blendMode,
      detailOctaves: params.detailOctaves,
      detailScale: params.detailScale,
      detailSpeed: params.detailSpeed,
      detailStrength: params.detailStrength,
      opacity: params.opacity,
      opacityRamp: params.opacityRamp,
      plumeTaper: params.plumeTaper,
      renderStepScale: params.renderStepScale,
      scattering: params.scattering,
      shadowQuality: params.shadowQuality,
      shadowStrength: params.shadowStrength,
      smokeColor: params.color,
      softness: params.softness,
    },
    solver: {
      ...base.solver,
      advectionMode: params.advectionMode,
      backendMode: params.backendMode,
      densityDissipation: params.densityDissipation,
      diffusion: params.diffusion,
      diffusionIterations: params.diffusionIterations,
      gridResolution: params.gridResolution,
      pressureIterations: params.pressureIterations,
      quality: params.quality,
      seed: params.seed,
      velocityDissipation: params.velocityDissipation,
    },
    sourceGlow: {
      ...base.sourceGlow,
      color: params.sourceGlowColor,
      enabled: false,
      intensity: params.sourceGlowIntensity,
      radius: params.sourceGlowRadius,
      softness: params.sourceGlowSoftness,
    },
    transform: { worldPosition: params.worldPosition },
  };
}

function normalizeRuntimeConfig(params: ${className}Params, config: Partial<WispySmokeRuntimeConfig> | undefined): WispySmokeRuntimeConfig {
  const base = configFromParams(params);
  return {
    ...base,
    ...config,
    debug: { ...base.debug, ...(config?.debug ?? {}) },
    emitters: config?.emitters ?? base.emitters,
    fields: config?.fields ?? base.fields,
    forces: config?.forces ?? base.forces,
    obstacles: config?.obstacles ?? base.obstacles,
    render: { ...base.render, ...(config?.render ?? {}) },
    solver: { ...base.solver, ...(config?.solver ?? {}) },
    sourceGlow: { ...base.sourceGlow, ...(config?.sourceGlow ?? {}), enabled: false },
    transform: { ...base.transform, ...(config?.transform ?? {}) },
  };
}

function resolveFluidBounds(params: ${className}Params): VolumeBounds {
  const windSpread = Math.hypot(params.wind[0], params.wind[2]) * params.lifetime * 0.32;
  const sourceSpread = params.radius * 5.2 + params.turbulence * 0.22 + params.size * 0.32 + windSpread;
  const authoredSize = params.size * 0.96;
  const width = Math.max(4.2, sourceSpread, authoredSize);
  return { depth: width, height: Math.max(0.75, params.height * 1.55), width };
}

function resolveEffectiveGridResolution(params: ${className}Params): WispySmokeGridResolution {
  return QUALITY_RANK[params.gridResolution] <= QUALITY_RANK[params.quality] ? params.gridResolution : params.quality;
}

function resolveRenderSteps(params: ${className}Params): number {
  return Math.max(16, Math.round(QUALITY[resolveEffectiveGridResolution(params)].maxRaySteps * clamp(params.renderStepScale, 0.1, 1.35)));
}

function resolvePressureIterations(params: ${className}Params): number {
  return clamp(Math.round(params.pressureIterations), 4, 40);
}

function resolveSourceRadius(params: ${className}Params, bounds: VolumeBounds): number {
  return clamp(params.radius / Math.max(bounds.width, bounds.depth), 0.02, 0.42);
}

function createFluidUniforms(params: ${className}Params): FluidUniforms {
  const bounds = resolveFluidBounds(params);
  return {
    absorption: uniform(params.absorption),
    baseDensity: uniform(params.baseDensity),
    buoyancy: uniform(params.buoyantLift),
    curlStrength: uniform(params.curlStrength),
    densityDissipation: uniform(params.densityDissipation),
    detailScale: uniform(params.detailScale),
    detailSpeed: uniform(params.detailSpeed),
    detailStrength: uniform(params.detailStrength),
    diffusion: uniform(params.diffusion),
    dt: uniform(1 / 60),
    emissionColor: uniform(new THREE.Color(params.emissionColor)),
    emissionIntensity: uniform(params.emissionIntensity),
    opacity: uniform(params.opacity),
    radius: uniform(resolveSourceRadius(params, bounds)),
    riseSpeed: uniform(params.riseSpeed),
    scattering: uniform(params.scattering),
    shadowSamples: uniform(clamp(params.shadowQuality, 0, 16)),
    shadowStrength: uniform(params.shadowStrength),
    smokeColor: uniform(new THREE.Color(params.color)),
    sourceRate: uniform(params.spawnRate * params.density * SOURCE_DENSITY_RATE_SCALE),
    sourceTemperature: uniform(params.sourceTemperature),
    sourceVelocity: uniform(new THREE.Vector3(params.sourceVelocity[0], params.sourceVelocity[1], params.sourceVelocity[2])),
    steps: uniform(resolveRenderSteps(params)),
    time: uniform(0),
    turbulence: uniform(params.turbulence),
    velocityDissipation: uniform(params.velocityDissipation),
    vorticity: uniform(params.vorticityConfinement),
    wind: uniform(new THREE.Vector3(params.wind[0], params.wind[1], params.wind[2])),
  };
}

function disposeStorageBuffer(node: Vec4StorageBuffer | FloatStorageBuffer): void {
  const value = (node as { readonly value?: { dispose?: () => void } }).value;
  value?.dispose?.();
}

class FluidGrid3D {
  readonly cells: number;
  readonly grid: Vec3;
  readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.NodeMaterial>;

  private bounds: VolumeBounds;
  private readonly clearNode: object;
  private readonly densityA: Vec4StorageBuffer;
  private readonly densityB: Vec4StorageBuffer;
  private readonly velocityA: Vec4StorageBuffer;
  private readonly velocityB: Vec4StorageBuffer;
  private readonly pressureA: FloatStorageBuffer;
  private readonly pressureB: FloatStorageBuffer;
  private readonly divergence: FloatStorageBuffer;
  private readonly renderTexture: THREE.Storage3DTexture;
  private readonly geometry: THREE.BoxGeometry;
  private readonly material: THREE.NodeMaterial;
  private readonly uniforms: FluidUniforms;
  private readonly pressureClearNode: object;
  private readonly sourceNodes: readonly [object, object];
  private readonly advectNodes: readonly [object, object];
  private readonly buoyancyNodes: readonly [object, object];
  private readonly vorticityNodes: readonly [object, object];
  private readonly divergenceNodes: readonly [object, object];
  private readonly jacobiNodes: readonly [object, object];
  private readonly projectionNodes: readonly [readonly [object, object], readonly [object, object]];
  private readonly packNodes: readonly [object, object];
  private activeBuffer: 0 | 1 = 0;
  private hasCleared = false;
  private lastSimulationMs = 0;
  private lastSolverPasses = 0;

  constructor(params: ${className}Params) {
    this.grid = QUALITY[resolveEffectiveGridResolution(params)].volumeGrid;
    this.cells = this.grid[0] * this.grid[1] * this.grid[2];
    this.bounds = resolveFluidBounds(params);
    this.uniforms = createFluidUniforms(params);
    this.densityA = instancedArray(this.cells, "vec4");
    this.densityB = instancedArray(this.cells, "vec4");
    this.velocityA = instancedArray(this.cells, "vec4");
    this.velocityB = instancedArray(this.cells, "vec4");
    this.pressureA = instancedArray(this.cells, "float");
    this.pressureB = instancedArray(this.cells, "float");
    this.divergence = instancedArray(this.cells, "float");
    this.renderTexture = new THREE.Storage3DTexture(this.grid[0], this.grid[1], this.grid[2]);
    this.renderTexture.format = THREE.RGBAFormat;
    this.renderTexture.type = THREE.HalfFloatType;
    this.renderTexture.minFilter = THREE.LinearFilter;
    this.renderTexture.magFilter = THREE.LinearFilter;
    this.renderTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.renderTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.renderTexture.wrapR = THREE.ClampToEdgeWrapping;

    const cloud = VOLUME_RAYMARCH({
      absorption: this.uniforms.absorption,
      baseDensity: this.uniforms.baseDensity,
      detailScale: this.uniforms.detailScale,
      detailSpeed: this.uniforms.detailSpeed,
      detailStrength: this.uniforms.detailStrength,
      emissionColor: this.uniforms.emissionColor,
      emissionIntensity: this.uniforms.emissionIntensity,
      opacity: this.uniforms.opacity,
      scattering: this.uniforms.scattering,
      shadowSamples: this.uniforms.shadowSamples,
      shadowStrength: this.uniforms.shadowStrength,
      smokeColor: this.uniforms.smokeColor,
      steps: this.uniforms.steps,
      texture: texture3D(this.renderTexture, null, 0),
      time: this.uniforms.time,
    });
    this.material = new THREE.MeshBasicNodeMaterial();
    this.material.outputNode = cloud;
    this.material.side = THREE.BackSide;
    this.material.transparent = true;
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.blending = params.blendMode === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "${className}EulerianFluidVolume";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.applyBounds(params);

    this.clearNode = this.createClearNode();
    this.pressureClearNode = this.createPressureClearNode();
    this.sourceNodes = [
      this.createSourceNode(this.densityA, this.velocityA, this.densityB, this.velocityB),
      this.createSourceNode(this.densityB, this.velocityB, this.densityA, this.velocityA),
    ];
    this.advectNodes = [
      this.createAdvectNode(this.densityA, this.velocityA, this.densityB, this.velocityB),
      this.createAdvectNode(this.densityB, this.velocityB, this.densityA, this.velocityA),
    ];
    this.buoyancyNodes = [this.createBuoyancyNode(this.densityA, this.velocityA), this.createBuoyancyNode(this.densityB, this.velocityB)];
    this.vorticityNodes = [this.createVorticityNode(this.velocityA, this.velocityB), this.createVorticityNode(this.velocityB, this.velocityA)];
    this.divergenceNodes = [this.createDivergenceNode(this.velocityA), this.createDivergenceNode(this.velocityB)];
    this.jacobiNodes = [this.createJacobiNode(this.pressureA, this.pressureB), this.createJacobiNode(this.pressureB, this.pressureA)];
    this.projectionNodes = [
      [this.createProjectionNode(this.velocityA, this.velocityB, this.pressureA), this.createProjectionNode(this.velocityA, this.velocityB, this.pressureB)],
      [this.createProjectionNode(this.velocityB, this.velocityA, this.pressureA), this.createProjectionNode(this.velocityB, this.velocityA, this.pressureB)],
    ];
    this.packNodes = [this.createPackNode(this.densityA, this.velocityA), this.createPackNode(this.densityB, this.velocityB)];
  }

  updateParams(params: ${className}Params): void {
    this.applyBounds(params);
    this.uniforms.absorption.value = params.absorption;
    this.uniforms.baseDensity.value = params.baseDensity;
    this.uniforms.buoyancy.value = params.buoyantLift;
    this.uniforms.curlStrength.value = params.curlStrength;
    this.uniforms.densityDissipation.value = params.densityDissipation;
    this.uniforms.detailScale.value = params.detailScale;
    this.uniforms.detailSpeed.value = params.detailSpeed;
    this.uniforms.detailStrength.value = params.detailStrength;
    this.uniforms.diffusion.value = params.diffusion;
    this.uniforms.emissionColor.value.set(params.emissionColor);
    this.uniforms.emissionIntensity.value = params.emissionIntensity;
    this.uniforms.opacity.value = params.opacity;
    this.uniforms.radius.value = resolveSourceRadius(params, this.bounds);
    this.uniforms.riseSpeed.value = params.riseSpeed;
    this.uniforms.scattering.value = params.scattering;
    this.uniforms.shadowSamples.value = clamp(params.shadowQuality, 0, 16);
    this.uniforms.shadowStrength.value = params.shadowStrength;
    this.uniforms.smokeColor.value.set(params.color);
    this.uniforms.sourceRate.value = params.spawnRate * params.density * SOURCE_DENSITY_RATE_SCALE;
    this.uniforms.sourceTemperature.value = params.sourceTemperature;
    this.uniforms.sourceVelocity.value.set(params.sourceVelocity[0], params.sourceVelocity[1], params.sourceVelocity[2]);
    this.uniforms.steps.value = resolveRenderSteps(params);
    this.uniforms.turbulence.value = params.turbulence;
    this.uniforms.velocityDissipation.value = params.velocityDissipation;
    this.uniforms.vorticity.value = params.vorticityConfinement;
    this.uniforms.wind.value.set(params.wind[0], params.wind[1], params.wind[2]);
    this.material.blending = params.blendMode === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending;
  }

  step(renderer: unknown, params: ${className}Params, deltaSeconds: number, elapsedSeconds: number): void {
    this.updateParams(params);
    this.uniforms.dt.value = clamp(deltaSeconds, 0, 1 / 30);
    this.uniforms.time.value = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
    if (!hasComputeRenderer(renderer)) {
      this.lastSimulationMs = 0;
      this.lastSolverPasses = 0;
      return;
    }
    const started = performance.now();
    let passes = 0;
    const dispatch = (node: object): void => {
      renderer.compute(node);
      passes += 1;
    };
    if (!this.hasCleared) {
      dispatch(this.clearNode);
      this.hasCleared = true;
    }
    dispatch(this.advectNodes[this.activeBuffer]);
    this.activeBuffer = this.activeBuffer === 0 ? 1 : 0;
    dispatch(this.sourceNodes[this.activeBuffer]);
    this.activeBuffer = this.activeBuffer === 0 ? 1 : 0;
    dispatch(this.buoyancyNodes[this.activeBuffer]);
    dispatch(this.vorticityNodes[this.activeBuffer]);
    this.activeBuffer = this.activeBuffer === 0 ? 1 : 0;
    dispatch(this.divergenceNodes[this.activeBuffer]);
    dispatch(this.pressureClearNode);
    let pressureBuffer: 0 | 1 = 0;
    for (let index = 0; index < resolvePressureIterations(params); index += 1) {
      dispatch(this.jacobiNodes[pressureBuffer]);
      pressureBuffer = pressureBuffer === 0 ? 1 : 0;
    }
    dispatch(this.projectionNodes[this.activeBuffer][pressureBuffer]);
    this.activeBuffer = this.activeBuffer === 0 ? 1 : 0;
    dispatch(this.packNodes[this.activeBuffer]);
    this.lastSolverPasses = passes;
    this.lastSimulationMs = performance.now() - started;
  }

  getStats(params: ${className}Params): Pick<${className}Stats, "gridCells" | "gridResolution" | "pressureIterations" | "simulationMs" | "solverPasses"> {
    return {
      gridCells: this.cells,
      gridResolution: this.grid,
      pressureIterations: resolvePressureIterations(params),
      simulationMs: this.lastSimulationMs,
      solverPasses: this.lastSolverPasses,
    };
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.renderTexture.dispose();
    disposeStorageBuffer(this.densityA);
    disposeStorageBuffer(this.densityB);
    disposeStorageBuffer(this.velocityA);
    disposeStorageBuffer(this.velocityB);
    disposeStorageBuffer(this.pressureA);
    disposeStorageBuffer(this.pressureB);
    disposeStorageBuffer(this.divergence);
  }

  private applyBounds(params: ${className}Params): void {
    this.bounds = resolveFluidBounds(params);
    this.mesh.position.set(0, this.bounds.height * 0.5, 0);
    this.mesh.scale.set(this.bounds.width, this.bounds.height, this.bounds.depth);
  }

  private createClearNode(): object {
    return Fn(() => {
      this.densityA.element(instanceIndex).assign(vec4(0));
      this.densityB.element(instanceIndex).assign(vec4(0));
      this.velocityA.element(instanceIndex).assign(vec4(0));
      this.velocityB.element(instanceIndex).assign(vec4(0));
      this.pressureA.element(instanceIndex).assign(0);
      this.pressureB.element(instanceIndex).assign(0);
      this.divergence.element(instanceIndex).assign(0);
    })().compute(this.cells).setName("${className} Clear Fluid Grid") as object;
  }

  private createPressureClearNode(): object {
    return Fn(() => {
      this.pressureA.element(instanceIndex).assign(0);
      this.pressureB.element(instanceIndex).assign(0);
    })().compute(this.cells).setName("${className} Clear Pressure") as object;
  }

  private createSourceNode(
    readDensity: Vec4StorageBuffer,
    readVelocity: Vec4StorageBuffer,
    writeDensity: Vec4StorageBuffer,
    writeVelocity: Vec4StorageBuffer,
  ): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const uvw = this.cellUVW(coord);
      const center = vec3(0.5, 0.08, 0.5);
      const dist = uvw.sub(center).length();
      const edge0 = this.uniforms.radius.mul(0.32);
      const sourceMask = nodeSmoothstep(edge0, this.uniforms.radius, dist).oneMinus().clamp(0, 1);
      const noiseCoord = uvw.mul(this.uniforms.detailScale.mul(0.55)).add(vec3(
        this.uniforms.time.mul(0.26),
        this.uniforms.time.mul(-0.34),
        this.uniforms.time.mul(0.21),
      ));
      const sourceNoise = valueNoise3D(noiseCoord).toVar();
      sourceNoise.addAssign(valueNoise3D(noiseCoord.mul(2.3)).mul(0.42));
      sourceNoise.addAssign(valueNoise3D(noiseCoord.mul(4.7)).mul(0.18));
      sourceNoise.assign(sourceNoise.div(1.6));
      const sourceStrands = nodeSmoothstep(0.34, 0.78, sourceNoise.add(sourceMask.mul(0.18))).clamp(0, 1);
      const mask = sourceMask.mul(sourceStrands.mul(0.85).add(0.12));
      const currentDensity = readDensity.element(instanceIndex);
      const currentVelocity = readVelocity.element(instanceIndex);
      const densityDelta = this.uniforms.sourceRate.mul(this.uniforms.dt).mul(mask);
      const temperature = currentDensity.y
        .add(mask.mul(this.uniforms.sourceTemperature).mul(this.uniforms.dt))
        .max(mask.mul(this.uniforms.sourceTemperature).mul(0.45));
      const sourceBaseVelocity = this.uniforms.sourceVelocity.add(vec3(0, this.uniforms.riseSpeed.mul(0.62), 0));
      const sourceBreakupVelocity = vec3(
        valueNoise3D(noiseCoord.add(vec3(11.7, 3.1, 19.4))).sub(0.5),
        valueNoise3D(noiseCoord.add(vec3(7.2, 23.4, 31.1))).sub(0.5).mul(0.12),
        valueNoise3D(noiseCoord.add(vec3(29.3, 17.9, 5.2))).sub(0.5),
      ).mul(this.uniforms.turbulence).mul(0.48);
      const velocityDelta = sourceBaseVelocity
        .add(sourceBreakupVelocity)
        .sub(currentVelocity.xyz.mul(0.2))
        .mul(mask)
        .mul(this.uniforms.dt.mul(3.5));
      writeDensity.element(instanceIndex).assign(vec4(currentDensity.x.add(densityDelta).clamp(0, 1), temperature.clamp(0, 1), currentDensity.z, sourceNoise.sub(0.26).clamp(0, 1).mul(mask)));
      writeVelocity.element(instanceIndex).assign(vec4(currentVelocity.xyz.add(velocityDelta), 0));
    })().compute(this.cells).setName("${className} Source Injection") as object;
  }

  private createAdvectNode(sourceDensity: Vec4StorageBuffer, sourceVelocity: Vec4StorageBuffer, targetDensity: Vec4StorageBuffer, targetVelocity: Vec4StorageBuffer): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const uvw = this.cellUVW(coord);
      const velocity = sourceVelocity.element(instanceIndex).xyz;
      const backCoord = coord.sub(velocity.mul(this.uniforms.dt).mul(vec3(this.grid[0], this.grid[1], this.grid[2])).toIVec3());
      const advectedDensity = sourceDensity.element(this.linearIndex(backCoord.x, backCoord.y, backCoord.z));
      const advectedVelocity = sourceVelocity.element(this.linearIndex(backCoord.x, backCoord.y, backCoord.z));
      const neighborDensity = this.neighborDensityAverage(sourceDensity, coord);
      const topOutflowFade = nodeSmoothstep(0.75, 0.96, uvw.y).oneMinus().clamp(0, 1);
      const densityValue = advectedDensity.x.mul(1 - this.uniforms.densityDissipation.mul(this.uniforms.dt)).mix(neighborDensity, this.uniforms.diffusion).mul(topOutflowFade).clamp(0, 1);
      const temperatureCooling = this.uniforms.densityDissipation.mul(3.2).add(0.18).mul(this.uniforms.dt);
      const temperatureValue = advectedDensity.y.mul(float(1).sub(temperatureCooling).clamp(0, 1)).mul(topOutflowFade).clamp(0, 1);
      targetDensity.element(instanceIndex).assign(vec4(densityValue, temperatureValue, advectedDensity.z.mul(topOutflowFade), advectedDensity.w.mul(topOutflowFade)));
      targetVelocity.element(instanceIndex).assign(vec4(advectedVelocity.xyz.mul(1 - this.uniforms.velocityDissipation.mul(this.uniforms.dt)).mul(topOutflowFade), 0));
    })().compute(this.cells).setName("${className} Semi Lagrangian Advection") as object;
  }

  private createBuoyancyNode(density: Vec4StorageBuffer, velocity: Vec4StorageBuffer): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const uvw = this.cellUVW(coord);
      const densitySample = density.element(instanceIndex);
      const currentVelocity = velocity.element(instanceIndex);
      const active = densitySample.x.add(densitySample.y.mul(0.35)).clamp(0, 1);
      const lift = densitySample.y
        .mul(this.uniforms.riseSpeed)
        .mul(this.uniforms.buoyancy)
        .mul(1.65);
      const windForce = this.uniforms.wind.mul(0.35);
      const radial = vec3(uvw.x.sub(0.5), 0, uvw.z.sub(0.5));
      const radialLength = dot(radial, radial).sqrt().max(0.001);
      const expansion = radial.div(radialLength)
        .mul(active)
        .mul(nodeSmoothstep(0.16, 0.82, uvw.y))
        .mul(this.uniforms.riseSpeed.mul(0.22));
      const nextVelocity = currentVelocity.xyz.add(
        vec3(windForce.x, lift.add(windForce.y), windForce.z).add(expansion).mul(this.uniforms.dt),
      );
      velocity.element(instanceIndex).assign(vec4(nextVelocity, 0));
    })().compute(this.cells).setName("${className} Buoyancy Wind") as object;
  }

  private createVorticityNode(sourceVelocity: Vec4StorageBuffer, targetVelocity: Vec4StorageBuffer): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const left = sourceVelocity.element(this.linearIndex(coord.x.sub(1), coord.y, coord.z)).xyz;
      const right = sourceVelocity.element(this.linearIndex(coord.x.add(1), coord.y, coord.z)).xyz;
      const down = sourceVelocity.element(this.linearIndex(coord.x, coord.y.sub(1), coord.z)).xyz;
      const up = sourceVelocity.element(this.linearIndex(coord.x, coord.y.add(1), coord.z)).xyz;
      const back = sourceVelocity.element(this.linearIndex(coord.x, coord.y, coord.z.sub(1))).xyz;
      const front = sourceVelocity.element(this.linearIndex(coord.x, coord.y, coord.z.add(1))).xyz;
      const curl = vec3(up.z.sub(down.z).sub(front.y.sub(back.y)), front.x.sub(back.x).sub(right.z.sub(left.z)), right.y.sub(left.y).sub(up.x.sub(down.x))).mul(0.5);
      const current = sourceVelocity.element(instanceIndex).xyz;
      const uvw = this.cellUVW(coord);
      const activeMask = dot(curl, curl).sqrt().clamp(0, 1);
      const breakupCoord = uvw.mul(this.uniforms.detailScale.mul(0.32)).add(vec3(
        this.uniforms.time.mul(this.uniforms.detailSpeed).mul(0.18),
        this.uniforms.time.mul(this.uniforms.detailSpeed).mul(-0.24),
        this.uniforms.time.mul(this.uniforms.detailSpeed).mul(0.16),
      ));
      const breakupForce = vec3(
        valueNoise3D(breakupCoord.add(vec3(19.1, 5.7, 2.4))).sub(0.5),
        valueNoise3D(breakupCoord.add(vec3(3.6, 31.8, 11.2))).sub(0.5).mul(0.18),
        valueNoise3D(breakupCoord.add(vec3(23.4, 13.9, 41.7))).sub(0.5),
      ).mul(this.uniforms.turbulence).mul(activeMask).mul(this.uniforms.dt.mul(0.75));
      targetVelocity.element(instanceIndex).assign(vec4(current.add(curl.mul(this.uniforms.vorticity.mul(1.35)).mul(this.uniforms.curlStrength).mul(this.uniforms.dt)).add(breakupForce), 0));
    })().compute(this.cells).setName("${className} Vorticity Confinement") as object;
  }

  private createDivergenceNode(velocity: Vec4StorageBuffer): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const left = velocity.element(this.linearIndex(coord.x.sub(1), coord.y, coord.z)).x;
      const right = velocity.element(this.linearIndex(coord.x.add(1), coord.y, coord.z)).x;
      const down = velocity.element(this.linearIndex(coord.x, coord.y.sub(1), coord.z)).y;
      const up = velocity.element(this.linearIndex(coord.x, coord.y.add(1), coord.z)).y;
      const back = velocity.element(this.linearIndex(coord.x, coord.y, coord.z.sub(1))).z;
      const front = velocity.element(this.linearIndex(coord.x, coord.y, coord.z.add(1))).z;
      this.divergence.element(instanceIndex).assign(right.sub(left).add(up.sub(down)).add(front.sub(back)).mul(0.5));
    })().compute(this.cells).setName("${className} Divergence") as object;
  }

  private createJacobiNode(sourcePressure: FloatStorageBuffer, targetPressure: FloatStorageBuffer): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const pressureSum = sourcePressure.element(this.linearIndex(coord.x.sub(1), coord.y, coord.z))
        .add(sourcePressure.element(this.linearIndex(coord.x.add(1), coord.y, coord.z)))
        .add(sourcePressure.element(this.linearIndex(coord.x, coord.y.sub(1), coord.z)))
        .add(sourcePressure.element(this.linearIndex(coord.x, coord.y.add(1), coord.z)))
        .add(sourcePressure.element(this.linearIndex(coord.x, coord.y, coord.z.sub(1))))
        .add(sourcePressure.element(this.linearIndex(coord.x, coord.y, coord.z.add(1))));
      targetPressure.element(instanceIndex).assign(pressureSum.sub(this.divergence.element(instanceIndex)).div(6));
    })().compute(this.cells).setName("${className} Jacobi Pressure") as object;
  }

  private createProjectionNode(sourceVelocity: Vec4StorageBuffer, targetVelocity: Vec4StorageBuffer, pressure: FloatStorageBuffer): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const pressureGradient = vec3(
        pressure.element(this.linearIndex(coord.x.add(1), coord.y, coord.z)).sub(pressure.element(this.linearIndex(coord.x.sub(1), coord.y, coord.z))),
        pressure.element(this.linearIndex(coord.x, coord.y.add(1), coord.z)).sub(pressure.element(this.linearIndex(coord.x, coord.y.sub(1), coord.z))),
        pressure.element(this.linearIndex(coord.x, coord.y, coord.z.add(1))).sub(pressure.element(this.linearIndex(coord.x, coord.y, coord.z.sub(1)))),
      ).mul(0.5);
      targetVelocity.element(instanceIndex).assign(vec4(sourceVelocity.element(instanceIndex).xyz.sub(pressureGradient), 0));
    })().compute(this.cells).setName("${className} Projection") as object;
  }

  private createPackNode(density: Vec4StorageBuffer, velocity: Vec4StorageBuffer): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const packed = density.element(instanceIndex);
      const speed = dot(velocity.element(instanceIndex).xyz, velocity.element(instanceIndex).xyz).sqrt().clamp(0, 1);
      const neighborDensity = this.neighborDensityAverage(density, coord);
      const renderDensity = packed.x.mul(0.72).add(neighborDensity.mul(0.16)).mul(packed.w.mul(0.28).add(0.72)).clamp(0, 1.55);
      const renderTemperature = packed.y.mul(0.5).add(neighborDensity.mul(0.08)).clamp(0, 1.2);
      textureStore(this.renderTexture, this.cellTextureCoord(), vec4(renderDensity, renderTemperature, speed, packed.w));
    })().compute(this.cells).setName("${className} Render Volume Pack") as object;
  }

  private cellCoord(): Node<"ivec3"> {
    const layerSize = this.grid[0] * this.grid[1];
    const z = int(instanceIndex.div(layerSize));
    const remainder = int(instanceIndex.sub(uint(z.mul(layerSize))));
    const y = int(remainder.div(this.grid[0]));
    const x = int(remainder.sub(y.mul(this.grid[0])));
    return vec3(x, y, z).toIVec3();
  }

  private cellTextureCoord(): Node<"uvec3"> {
    const coord = this.cellCoord();
    return uvec3(uint(coord.x), uint(coord.y), uint(coord.z));
  }

  private cellUVW(coord: Node<"ivec3">): Node<"vec3"> {
    return vec3(float(coord.x).div(Math.max(1, this.grid[0] - 1)), float(coord.y).div(Math.max(1, this.grid[1] - 1)), float(coord.z).div(Math.max(1, this.grid[2] - 1)));
  }

  private linearIndex(x: Node<"int">, y: Node<"int">, z: Node<"int">): Node<"uint"> {
    const clampedX = int(nodeClamp(float(x), 0, this.grid[0] - 1));
    const clampedY = int(nodeClamp(float(y), 0, this.grid[1] - 1));
    const clampedZ = int(nodeClamp(float(z), 0, this.grid[2] - 1));
    return uint(clampedX.add(clampedY.mul(this.grid[0])).add(clampedZ.mul(this.grid[0] * this.grid[1])));
  }

  private neighborDensityAverage(density: Vec4StorageBuffer, coord: Node<"ivec3">): Node<"float"> {
    const left = density.element(this.linearIndex(coord.x.sub(1), coord.y, coord.z)).x;
    const right = density.element(this.linearIndex(coord.x.add(1), coord.y, coord.z)).x;
    const down = density.element(this.linearIndex(coord.x, coord.y.sub(1), coord.z)).x;
    const up = density.element(this.linearIndex(coord.x, coord.y.add(1), coord.z)).x;
    const back = density.element(this.linearIndex(coord.x, coord.y, coord.z.sub(1))).x;
    const front = density.element(this.linearIndex(coord.x, coord.y, coord.z.add(1))).x;
    return left.add(right).add(down).add(up).add(back).add(front).div(6);
  }
}

export class ${className} implements VFXEffect<${className}Params> {
  readonly object3D = new THREE.Group();
  readonly solver = RUNTIME_SOLVER;

  private renderer: unknown;
  private params: ${className}Params;
  private config: WispySmokeRuntimeConfig;
  private configOverride: Partial<WispySmokeRuntimeConfig> | undefined;
  private backend: RuntimeBackend = "compat";
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private readonly sourceGlowGroup = new THREE.Group();
  private sourceGlowMeshes: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
  private fluid: FluidGrid3D | null = null;
  private particles: SmokeParticle[] = [];
  private positions = new Float32Array(0);
  private alphas = new Float32Array(0);
  private sizes = new Float32Array(0);
  private angles = new Float32Array(0);
  private maxParticles = 0;
  private spawnCarry = 0;

  constructor(options: ${className}Options = {}) {
    const { config, position, renderer, ...params } = options;
    this.renderer = renderer;
    this.params = normalizeParams(params.worldPosition || !position ? params : { ...params, worldPosition: position });
    this.configOverride = config;
    this.config = normalizeRuntimeConfig(this.params, config);
    this.backend = this.resolveBackend();
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.ShaderMaterial({
      vertexShader: COMPAT_VERTEX_SHADER,
      fragmentShader: COMPAT_FRAGMENT_SHADER,
      uniforms: {
        uColor: { value: new THREE.Color(this.params.color) },
        uEmissionColor: { value: new THREE.Color(this.params.emissionColor) },
        uEmissionIntensity: { value: this.params.emissionIntensity },
        uOpacity: { value: this.params.opacity },
        uSoftness: { value: this.params.softness },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: this.config.render.blendMode === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.object3D.name = "${className}";
    this.object3D.add(this.points);
    this.sourceGlowGroup.name = "${className}SourceGlow";
    this.sourceGlowGroup.visible = false;
    this.applyTransform();
    this.rebuildSourceGlow();
    this.reallocateCompatibilityParticles();
    this.applyBackendResources();
  }

  update(deltaSeconds: number, elapsedSeconds = performance.now() / 1000): void {
    const dt = clamp(deltaSeconds, 0, 1 / 15);
    (this.material.uniforms.uTime as IUniform<number>).value = elapsedSeconds;
    if (this.backend === "webgpu") {
      this.ensureFluid();
      this.fluid?.step(this.renderer, this.params, dt, elapsedSeconds);
      this.geometry.setDrawRange(0, 0);
      return;
    }
    this.spawnParticles(dt);
    this.integrateParticles(dt);
    this.writeCompatGeometry();
  }

  setParams(params: Partial<${className}Params>): void {
    const previousQuality = this.params.quality;
    const previousGridResolution = this.params.gridResolution;
    const previousBackend = this.backend;
    this.params = normalizeParams({ ...this.params, ...params });
    this.config = normalizeRuntimeConfig(this.params, this.configOverride);
    this.backend = this.resolveBackend();
    (this.material.uniforms.uColor as IUniform<THREE.Color>).value.set(this.params.color);
    (this.material.uniforms.uEmissionColor as IUniform<THREE.Color>).value.set(this.params.emissionColor);
    (this.material.uniforms.uEmissionIntensity as IUniform<number>).value = this.params.emissionIntensity;
    (this.material.uniforms.uOpacity as IUniform<number>).value = this.params.opacity;
    (this.material.uniforms.uSoftness as IUniform<number>).value = this.params.softness;
    this.material.blending = this.config.render.blendMode === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.applyTransform();
    this.rebuildSourceGlow();
    if (previousQuality !== this.params.quality || previousGridResolution !== this.params.gridResolution || previousBackend !== this.backend) {
      this.disposeFluid();
      this.reallocateCompatibilityParticles();
    }
    this.applyBackendResources();
    this.fluid?.updateParams(this.params);
  }

  getParams(): Readonly<${className}Params> {
    return this.params;
  }

  setRuntimeConfig(config: Partial<WispySmokeRuntimeConfig>): void {
    const previousQuality = this.config.solver.quality;
    const previousGridResolution = this.config.solver.gridResolution;
    const previousBackend = this.backend;
    this.configOverride = config;
    this.config = normalizeRuntimeConfig(this.params, config);
    this.backend = this.resolveBackend();
    this.applyTransform();
    this.rebuildSourceGlow();
    if (previousQuality !== this.config.solver.quality || previousGridResolution !== this.config.solver.gridResolution || previousBackend !== this.backend) {
      this.disposeFluid();
      this.reallocateCompatibilityParticles();
    }
    this.applyBackendResources();
  }

  getStats(): ${className}Stats {
    const fluidStats = this.fluid?.getStats(this.params);
    const grid = fluidStats?.gridResolution ?? QUALITY[resolveEffectiveGridResolution(this.params)].volumeGrid;
    return {
      activeDebugView: this.config.debug.view,
      advectionMode: this.config.solver.advectionMode,
      backend: this.backend,
      diffusionIterations: this.config.solver.diffusionIterations,
      emitterCount: this.config.emitters.length,
      fallbackActive: this.backend !== "webgpu",
      fieldCount: this.config.fields.length,
      forceCount: this.config.forces.length,
      gridCells: fluidStats?.gridCells ?? (this.backend === "webgpu" ? grid[0] * grid[1] * grid[2] : 0),
      gridResolution: grid,
      obstacleCount: this.config.obstacles.length,
      pressureIterations: fluidStats?.pressureIterations ?? resolvePressureIterations(this.params),
      renderSteps: resolveRenderSteps(this.params),
      requestedBackend: this.config.solver.backendMode,
      simulationMs: fluidStats?.simulationMs ?? 0,
      solverPasses: fluidStats?.solverPasses ?? 0,
    };
  }

  dispose(): void {
    this.disposeFluid();
    this.disposeSourceGlow();
    this.geometry.dispose();
    this.material.dispose();
  }

  private resolveBackend(): RuntimeBackend {
    if (this.config.solver.backendMode === "compat") return "compat";
    return isWebGPURenderer(this.renderer) ? "webgpu" : "compat";
  }

  private applyBackendResources(): void {
    this.points.visible = this.backend === "compat";
    if (this.backend === "webgpu") this.ensureFluid();
    if (this.fluid) this.fluid.mesh.visible = this.backend === "webgpu";
  }

  private ensureFluid(): void {
    if (this.fluid) return;
    this.fluid = new FluidGrid3D(this.params);
    this.fluid.mesh.visible = this.backend === "webgpu";
    this.object3D.add(this.fluid.mesh);
  }

  private disposeFluid(): void {
    if (!this.fluid) return;
    this.object3D.remove(this.fluid.mesh);
    this.fluid.dispose();
    this.fluid = null;
  }

  private applyTransform(): void {
    const position = this.config.transform.worldPosition;
    this.object3D.position.set(position[0], position[1], position[2]);
  }

  private rebuildSourceGlow(): void {
    this.disposeSourceGlow();
    this.sourceGlowGroup.visible = false;
  }

  private disposeSourceGlow(): void {
    for (const mesh of this.sourceGlowMeshes) {
      this.sourceGlowGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.sourceGlowMeshes = [];
  }

  private reallocateCompatibilityParticles(): void {
    const profile = QUALITY[this.params.quality];
    this.maxParticles = Math.max(16, Math.min(profile.maxParticles, Math.ceil(this.params.spawnRate * this.params.lifetime * 1.15)));
    this.positions = new Float32Array(this.maxParticles * 3);
    this.alphas = new Float32Array(this.maxParticles);
    this.sizes = new Float32Array(this.maxParticles);
    this.angles = new Float32Array(this.maxParticles);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute("aAngle", new THREE.BufferAttribute(this.angles, 1));
    if (this.particles.length > this.maxParticles) this.particles.length = this.maxParticles;
  }

  private spawnParticles(deltaSeconds: number): void {
    this.spawnCarry += this.params.spawnRate * deltaSeconds;
    const spawnCount = Math.floor(this.spawnCarry);
    this.spawnCarry -= spawnCount;
    for (let index = 0; index < spawnCount && this.particles.length < this.maxParticles; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radial = Math.sqrt(Math.random()) * this.params.radius;
      this.particles.push({
        age: 0,
        angle: Math.random() * Math.PI * 2,
        baseSize: this.params.size * (0.7 + Math.random() * 0.8),
        lifetime: this.params.lifetime * (0.74 + Math.random() * 0.4),
        velocityX: Math.cos(angle) * radial * 0.18 + this.params.wind[0],
        velocityY: this.params.riseSpeed * (0.58 + Math.random() * 0.44),
        velocityZ: Math.sin(angle) * radial * 0.18 + this.params.wind[2],
        x: Math.cos(angle) * radial,
        y: 0,
        z: Math.sin(angle) * radial,
      });
    }
  }

  private integrateParticles(deltaSeconds: number): void {
    const next: SmokeParticle[] = [];
    for (const particle of this.particles) {
      particle.age += deltaSeconds;
      if (particle.age >= particle.lifetime) continue;
      const t = particle.age / Math.max(0.001, particle.lifetime);
      const swirl = Math.sin(t * Math.PI * 5 + particle.angle) * this.params.curlStrength * 0.18;
      particle.velocityY += this.params.buoyantLift * deltaSeconds * 0.34;
      particle.x += (particle.velocityX + swirl) * deltaSeconds;
      particle.y += particle.velocityY * deltaSeconds;
      particle.z += (particle.velocityZ - swirl * 0.6) * deltaSeconds;
      next.push(particle);
    }
    this.particles = next;
  }

  private writeCompatGeometry(): void {
    let count = 0;
    for (const particle of this.particles) {
      if (count >= this.maxParticles) break;
      const t = particle.age / Math.max(0.001, particle.lifetime);
      this.positions[count * 3] = particle.x;
      this.positions[count * 3 + 1] = particle.y;
      this.positions[count * 3 + 2] = particle.z;
      this.alphas[count] = (1 - t) * this.params.opacity * 0.45;
      this.sizes[count] = particle.baseSize * (0.6 + t * 1.8);
      this.angles[count] = particle.angle + t * 2.2;
      count += 1;
    }
    this.geometry.setDrawRange(0, count);
    for (const name of ["position", "aAlpha", "aSize", "aAngle"]) {
      const attribute = this.geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (attribute) attribute.needsUpdate = true;
    }
  }
}
`;
}

export function createUsageSnippet(className: string): string {
  return `import { ${className} } from "./${className}";

const smoke = new ${className}({
  renderer,
  backendMode: "auto",
  quality: "medium",
  gridResolution: "medium",
  worldPosition: [0, 0, 0],
  spawnRate: 1200,
  lifetime: 6.5,
  radius: 0.45,
  height: 9.5,
  density: 0.68,
  baseDensity: 1.18,
  opacity: 0.74,
  riseSpeed: 2.3,
  buoyantLift: 2.6,
  turbulence: 4.8,
  curlStrength: 6.4,
  vorticityConfinement: 8.5,
  wind: [0, 0, 0],
  sourceVelocity: [0, 0.75, 0],
  vortexStrength: 0,
  pressureIterations: 10,
  diffusion: 0,
  diffusionIterations: 0,
  advectionMode: "trilinear",
  sourceTemperature: 1.28,
  plumeTaper: 0.56,
  emissionColor: "#ffbb77",
  emissionIntensity: 1.25,
  absorption: 11.8,
  scattering: 2.1,
  detailScale: 32,
  detailStrength: 7.2,
  detailSpeed: 0.95,
  detailOctaves: 4,
  sourceGlowEnabled: false,
  sourceGlowColor: "#ffaa66",
  sourceGlowIntensity: 0,
  sourceGlowRadius: 1.15,
  blendMode: "normal",
  renderStepScale: 1,
  shadowQuality: 6,
  shadowStrength: 1.15,
  debugView: "final",
  color: "#aabbcc"
});

scene.add(smoke.object3D);

function frame(deltaSeconds: number, elapsedSeconds: number) {
  smoke.update(deltaSeconds, elapsedSeconds);
}
`;
}

export function createReadmeSnippet(ir: EffectIR, className: string): string {
  return `# ${className}

Generated by ThreeFX Studio from graph \`${ir.graphHash}\`.

This export contains a standalone typed Three.js smoke effect class. The primary path is a WebGPU Eulerian fluid grid solver using TSL compute and a raymarched volume renderer. The compatibility backend is a simpler particle preview for non-WebGPU renderers.

\`\`\`ts
${createUsageSnippet(className).trim()}
\`\`\`

Parameter defaults:

\`\`\`json
${JSON.stringify(ir.parameterValues, null, 2)}
\`\`\`

Runtime config:

\`\`\`json
${JSON.stringify(ir.runtimeConfig, null, 2)}
\`\`\`
`;
}

export function createManifestSource(ir: EffectIR, className: string): string {
  return `${stableJson({
    className,
    effectName: ir.effectName,
    effectType: ir.effectType,
    graphHash: ir.graphHash,
    generatedBy: "ThreeFX Studio",
    runtimeBackend: ir.runtime.backendMode,
    runtimeGridResolution: ir.runtime.gridResolution,
    runtimeSolver: ir.runtime.solver,
    schemaVersion: ir.schemaVersion,
  })}\n`;
}
