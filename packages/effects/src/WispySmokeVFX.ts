import * as THREE from "three/webgpu";
import type { IUniform } from "three";
import type { Node, UniformNode } from "three/webgpu";
import type StorageBufferNodeBase from "three/src/nodes/accessors/StorageBufferNode.js";
import {
  Break,
  Fn,
  If,
  attributeArray,
  clamp as nodeClamp,
  dot,
  float,
  instanceIndex,
  int,
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
import {
  DisposableGroup,
  isWebGPURenderer,
  resolveQualityProfile,
  type RuntimeBackend,
  type VFXEffect,
} from "@threefx/runtime";
import { normalizeWispySmokeParams } from "./wispySmokeDefaults";
import type {
  WispySmokeVFXOptions,
  WispySmokeVFXParams,
  WispySmokeVFXStats,
} from "./wispySmokeTypes";

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

interface VolumeBounds {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

interface FluidUniforms {
  readonly absorption: UniformNode<"float", number>;
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
  readonly smokeColor: UniformNode<"color", THREE.Color>;
  readonly sourceRate: UniformNode<"float", number>;
  readonly sourceTemperature: UniformNode<"float", number>;
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
  readonly detailScale: Node<"float">;
  readonly detailSpeed: Node<"float">;
  readonly detailStrength: Node<"float">;
  readonly emissionColor: Node<"color">;
  readonly emissionIntensity: Node<"float">;
  readonly opacity: Node<"float">;
  readonly scattering: Node<"float">;
  readonly shadowSamples: Node<"float">;
  readonly smokeColor: Node<"color">;
  readonly steps: Node<"float">;
  readonly texture: Texture3DNode;
  readonly time: Node<"float">;
}

interface ComputeRenderer {
  compute(computeNode: object | readonly object[], dispatchSize?: number | readonly number[]): void | Promise<void>;
}

const QUALITY_RANK: Record<WispySmokeVFXParams["quality"], number> = {
  low: 0,
  medium: 1,
  high: 2,
  cinematic: 3,
};

const COMPAT_VERTEX_SHADER = `
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
`;

const COMPAT_FRAGMENT_SHADER = `
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
  vec3 color = mix(uColor * 0.72, source, vAlpha * 0.28);
  gl_FragColor = vec4(color, alpha);
}
`;

const VOLUME_RAYMARCH = Fn(
  ({
    absorption,
    detailScale,
    detailSpeed,
    detailStrength,
    emissionColor,
    emissionIntensity,
    opacity,
    scattering,
    shadowSamples,
    smokeColor,
    steps,
    texture,
    time,
  }: SmokeRaymarchArgs) => {
    const finalColor = vec4(0).toVar();
    const lightDir = vec3(0.36, 0.82, 0.18).normalize();

    RaymarchingBox(steps, ({ positionRay }) => {
      const uvw = positionRay.add(0.5).clamp(0.001, 0.999);
      const packed = texture.sample(uvw).toVar();
      const baseDensity = float(packed.r).toVar();
      const temperature = float(packed.g).toVar();
      const bakedLight = float(packed.b).toVar();
      const heightRamp = uvw.y;

      const detailCoord = uvw
        .mul(detailScale)
        .add(vec3(time.mul(detailSpeed).mul(0.13), time.mul(detailSpeed).mul(-0.19), time.mul(detailSpeed).mul(0.11)));
      const grainA = detailCoord.x
        .mul(12.9898)
        .add(detailCoord.y.mul(78.233))
        .add(detailCoord.z.mul(37.719))
        .sin()
        .mul(43758.5453)
        .fract();
      const grainB = detailCoord.x
        .add(4.17)
        .mul(24.32)
        .add(detailCoord.y.mul(31.13))
        .add(detailCoord.z.mul(91.73))
        .sin()
        .mul(24634.6345)
        .fract();
      const detail = grainA.mul(0.62).add(grainB.mul(0.38));
      const detailMod = detail.sub(0.5).mul(detailStrength).add(1).clamp(0.12, 1.8);
      const floorFade = nodeSmoothstep(0.015, 0.14, heightRamp);
      const density = baseDensity.mul(detailMod).mul(floorFade).toVar();

      const shadowA = texture.sample(uvw.add(lightDir.mul(0.035)).clamp(0.001, 0.999)).r;
      const shadowB = texture.sample(uvw.add(lightDir.mul(0.075)).clamp(0.001, 0.999)).r;
      const shadowC = texture.sample(uvw.add(lightDir.mul(0.12)).clamp(0.001, 0.999)).r;
      const shadowDensity = shadowA.add(shadowB).add(shadowC).div(3);
      const selfShadow = shadowDensity
        .mul(absorption)
        .mul(float(0.18).add(shadowSamples.mul(0.018)))
        .negate()
        .exp()
        .clamp(0.35, 1);
      const beerAlpha = density.mul(absorption).mul(0.14).negate().exp().oneMinus();
      const sampleAlpha = beerAlpha.mul(opacity).clamp(0, 0.96).toVar();
      const heightScatter = nodeSmoothstep(0.08, 0.9, heightRamp).mul(0.28).add(0.72);
      const smokeScatter = smokeColor.rgb
        .mul(scattering)
        .mul(heightScatter)
        .mul(selfShadow)
        .mul(bakedLight.mul(0.55).add(0.62));
      const sourceGlow = emissionColor.rgb
        .mul(emissionIntensity)
        .mul(temperature)
        .mul(nodeSmoothstep(0.08, 0.88, heightRamp).oneMinus())
        .mul(1.35);
      const sampleColor = smokeScatter.add(sourceGlow).toVar();
      const contribution = finalColor.a.oneMinus().mul(sampleAlpha);

      finalColor.rgb.addAssign(contribution.mul(sampleColor));
      finalColor.a.addAssign(contribution);

      If(finalColor.a.greaterThanEqual(0.97), () => {
        Break();
      });
    });

    return finalColor;
  },
);

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function sampleCurve(curve: WispySmokeVFXParams["opacityRamp"], time: number): number {
  const ordered = [...curve].sort((left, right) => left.time - right.time);
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const previous = ordered[index];
    const next = ordered[index + 1];
    if (previous && next && time >= previous.time && time <= next.time) {
      const local = clamp((time - previous.time) / Math.max(0.0001, next.time - previous.time), 0, 1);
      return previous.value + (next.value - previous.value) * smoothstep(0, 1, local);
    }
  }
  return ordered[ordered.length - 1]?.value ?? 1;
}

function hasComputeRenderer(renderer: unknown): renderer is ComputeRenderer {
  return Boolean(renderer && typeof renderer === "object" && "compute" in renderer);
}

function disposeStorageBuffer(node: Vec4StorageBuffer | FloatStorageBuffer): void {
  const value = (node as { readonly value?: { dispose?: () => void } }).value;
  value?.dispose?.();
}

function resolveFluidBounds(params: WispySmokeVFXParams): VolumeBounds {
  const windSpread = Math.hypot(params.wind[0], params.wind[2]) * params.lifetime * 0.42;
  const sourceSpread = params.radius * 4 + params.size * 1.65 + params.turbulence * 0.42 + windSpread;
  const width = Math.max(1.4, sourceSpread, params.height * 0.38);
  return {
    depth: width,
    height: Math.max(0.75, params.height),
    width,
  };
}

function resolveEffectiveGridResolution(params: WispySmokeVFXParams): WispySmokeVFXParams["gridResolution"] {
  return QUALITY_RANK[params.gridResolution] <= QUALITY_RANK[params.quality]
    ? params.gridResolution
    : params.quality;
}

function resolveRenderSteps(params: WispySmokeVFXParams): number {
  const profile = resolveQualityProfile(resolveEffectiveGridResolution(params));
  return Math.max(16, Math.round(profile.maxRaySteps * params.renderStepScale));
}

class FluidGrid3D {
  readonly cells: number;
  readonly grid: readonly [number, number, number];
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

  constructor(params: WispySmokeVFXParams) {
    const profile = resolveQualityProfile(resolveEffectiveGridResolution(params));
    this.grid = profile.volumeGrid;
    this.cells = this.grid[0] * this.grid[1] * this.grid[2];
    this.bounds = resolveFluidBounds(params);
    this.uniforms = createFluidUniforms(params);

    this.densityA = attributeArray(this.cells, "vec4");
    this.densityB = attributeArray(this.cells, "vec4");
    this.velocityA = attributeArray(this.cells, "vec4");
    this.velocityB = attributeArray(this.cells, "vec4");
    this.pressureA = attributeArray(this.cells, "float");
    this.pressureB = attributeArray(this.cells, "float");
    this.divergence = attributeArray(this.cells, "float");

    this.renderTexture = new THREE.Storage3DTexture(this.grid[0], this.grid[1], this.grid[2]);
    this.renderTexture.format = THREE.RGBAFormat;
    this.renderTexture.type = THREE.UnsignedByteType;
    this.renderTexture.minFilter = THREE.LinearFilter;
    this.renderTexture.magFilter = THREE.LinearFilter;
    this.renderTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.renderTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.renderTexture.wrapR = THREE.ClampToEdgeWrapping;

    const cloud = VOLUME_RAYMARCH({
      absorption: this.uniforms.absorption,
      detailScale: this.uniforms.detailScale,
      detailSpeed: this.uniforms.detailSpeed,
      detailStrength: this.uniforms.detailStrength,
      emissionColor: this.uniforms.emissionColor,
      emissionIntensity: this.uniforms.emissionIntensity,
      opacity: this.uniforms.opacity,
      scattering: this.uniforms.scattering,
      shadowSamples: this.uniforms.shadowSamples,
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
    this.material.blending = THREE.NormalBlending;

    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "WispySmokeVFXEulerianFluidVolume";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.applyBounds(params);

    this.clearNode = this.createClearNode();
    this.pressureClearNode = this.createPressureClearNode();
    this.sourceNodes = [
      this.createSourceNode(this.densityA, this.velocityA),
      this.createSourceNode(this.densityB, this.velocityB),
    ];
    this.advectNodes = [
      this.createAdvectNode(this.densityA, this.velocityA, this.densityB, this.velocityB),
      this.createAdvectNode(this.densityB, this.velocityB, this.densityA, this.velocityA),
    ];
    this.buoyancyNodes = [
      this.createBuoyancyNode(this.densityA, this.velocityA),
      this.createBuoyancyNode(this.densityB, this.velocityB),
    ];
    this.vorticityNodes = [
      this.createVorticityNode(this.velocityA, this.velocityB),
      this.createVorticityNode(this.velocityB, this.velocityA),
    ];
    this.divergenceNodes = [
      this.createDivergenceNode(this.velocityA),
      this.createDivergenceNode(this.velocityB),
    ];
    this.jacobiNodes = [
      this.createJacobiNode(this.pressureA, this.pressureB),
      this.createJacobiNode(this.pressureB, this.pressureA),
    ];
    this.projectionNodes = [
      [
        this.createProjectionNode(this.velocityA, this.velocityB, this.pressureA),
        this.createProjectionNode(this.velocityA, this.velocityB, this.pressureB),
      ],
      [
        this.createProjectionNode(this.velocityB, this.velocityA, this.pressureA),
        this.createProjectionNode(this.velocityB, this.velocityA, this.pressureB),
      ],
    ];
    this.packNodes = [
      this.createPackNode(this.densityA, this.velocityA),
      this.createPackNode(this.densityB, this.velocityB),
    ];
  }

  updateParams(params: WispySmokeVFXParams): void {
    this.applyBounds(params);
    this.uniforms.absorption.value = params.absorption;
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
    this.uniforms.shadowSamples.value = params.shadowQuality;
    this.uniforms.smokeColor.value.set(params.color);
    this.uniforms.sourceRate.value = params.spawnRate * params.density * 0.03;
    this.uniforms.sourceTemperature.value = params.sourceTemperature;
    this.uniforms.steps.value = resolveRenderSteps(params);
    this.uniforms.turbulence.value = params.turbulence;
    this.uniforms.velocityDissipation.value = params.velocityDissipation;
    this.uniforms.vorticity.value = params.vorticityConfinement;
    this.uniforms.wind.value.set(params.wind[0], params.wind[1], params.wind[2]);
  }

  step(renderer: unknown, params: WispySmokeVFXParams, deltaSeconds: number, elapsedSeconds: number): void {
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

    const pressureIterations = resolvePressureIterations(params);
    dispatch(this.sourceNodes[this.activeBuffer]);
    dispatch(this.advectNodes[this.activeBuffer]);
    this.activeBuffer = this.activeBuffer === 0 ? 1 : 0;
    dispatch(this.buoyancyNodes[this.activeBuffer]);
    dispatch(this.vorticityNodes[this.activeBuffer]);
    this.activeBuffer = this.activeBuffer === 0 ? 1 : 0;
    dispatch(this.divergenceNodes[this.activeBuffer]);
    dispatch(this.pressureClearNode);

    let pressureBuffer: 0 | 1 = 0;
    for (let index = 0; index < pressureIterations; index += 1) {
      dispatch(this.jacobiNodes[pressureBuffer]);
      pressureBuffer = pressureBuffer === 0 ? 1 : 0;
    }

    dispatch(this.projectionNodes[this.activeBuffer][pressureBuffer]);
    this.activeBuffer = this.activeBuffer === 0 ? 1 : 0;
    dispatch(this.packNodes[this.activeBuffer]);

    this.lastSolverPasses = passes;
    this.lastSimulationMs = performance.now() - started;
  }

  getStats(params: WispySmokeVFXParams): Pick<
    WispySmokeVFXStats,
    "gridCells" | "gridResolution" | "pressureIterations" | "simulationMs" | "solverPasses"
  > {
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

  private applyBounds(params: WispySmokeVFXParams): void {
    const bounds = resolveFluidBounds(params);
    this.bounds = bounds;
    this.mesh.position.set(0, bounds.height * 0.5, 0);
    this.mesh.scale.set(bounds.width, bounds.height, bounds.depth);
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
      textureStore(this.renderTexture, this.cellTextureCoord(), vec4(0)).toWriteOnly();
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Clear") as object;
  }

  private createPressureClearNode(): object {
    return Fn(() => {
      this.pressureA.element(instanceIndex).assign(0);
      this.pressureB.element(instanceIndex).assign(0);
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Pressure Clear") as object;
  }

  private createSourceNode(density: Vec4StorageBuffer, velocity: Vec4StorageBuffer): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const uvw = this.cellUVW(coord);
      const sourceCenter = vec3(0.5, this.uniforms.radius.mul(0.72).add(0.035), 0.5);
      const sourceDelta = uvw.sub(sourceCenter).mul(vec3(1, 1.35, 1));
      const dist = dot(sourceDelta, sourceDelta).sqrt();
      const sourceMask = nodeSmoothstep(this.uniforms.radius.mul(0.32), this.uniforms.radius, dist).oneMinus();
      const currentDensity = density.element(instanceIndex);
      const currentVelocity = velocity.element(instanceIndex);
      const injectedDensity = this.uniforms.sourceRate.mul(this.uniforms.dt).mul(sourceMask);
      const injectedTemperature = this.uniforms.sourceTemperature.mul(sourceMask).mul(this.uniforms.dt);
      density.element(instanceIndex).assign(
        vec4(
          currentDensity.x.add(injectedDensity).clamp(0, 1),
          currentDensity.y.add(injectedTemperature).clamp(0, 1),
          0,
          1,
        ),
      );
      velocity.element(instanceIndex).assign(
        vec4(
          currentVelocity.x,
          currentVelocity.y.add(this.uniforms.riseSpeed.mul(sourceMask).mul(this.uniforms.dt)),
          currentVelocity.z,
          0,
        ),
      );
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Source") as object;
  }

  private createAdvectNode(
    readDensity: Vec4StorageBuffer,
    readVelocity: Vec4StorageBuffer,
    writeDensity: Vec4StorageBuffer,
    writeVelocity: Vec4StorageBuffer,
  ): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const velocity = readVelocity.element(instanceIndex);
      const backCoord = coord
        .toVec3()
        .sub(velocity.xyz.mul(this.uniforms.dt).mul(this.grid[0] * 0.48))
        .clamp(vec3(0), vec3(this.grid[0] - 1, this.grid[1] - 1, this.grid[2] - 1));
      const sampleIndex = this.linearIndex(int(backCoord.x), int(backCoord.y), int(backCoord.z));
      const advectedDensity = readDensity.element(sampleIndex);
      const advectedVelocity = readVelocity.element(sampleIndex);
      const neighborAverage = this.neighborDensityAverage(readDensity, coord);
      const diffusionAmount = this.uniforms.diffusion.mul(this.uniforms.dt).clamp(0, 0.35);
      const densityValue = advectedDensity.x
        .mix(neighborAverage, diffusionAmount)
        .mul(float(1).sub(this.uniforms.densityDissipation.mul(this.uniforms.dt)).clamp(0, 1));
      const temperature = advectedDensity.y.mul(float(1).sub(this.uniforms.densityDissipation.mul(this.uniforms.dt).mul(0.7)).clamp(0, 1));
      writeDensity.element(instanceIndex).assign(vec4(densityValue.clamp(0, 1), temperature.clamp(0, 1), 0, 1));
      writeVelocity.element(instanceIndex).assign(
        vec4(
          advectedVelocity.xyz.mul(float(1).sub(this.uniforms.velocityDissipation.mul(this.uniforms.dt)).clamp(0, 1)),
          0,
        ),
      );
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Advect") as object;
  }

  private createBuoyancyNode(density: Vec4StorageBuffer, velocity: Vec4StorageBuffer): object {
    return Fn(() => {
      const densitySample = density.element(instanceIndex);
      const currentVelocity = velocity.element(instanceIndex);
      const lift = densitySample.y.mul(this.uniforms.riseSpeed).mul(this.uniforms.buoyancy);
      const windForce = this.uniforms.wind.mul(float(0.18).add(densitySample.x.mul(0.42)));
      const nextVelocity = currentVelocity.xyz.add(vec3(windForce.x, lift.add(windForce.y), windForce.z).mul(this.uniforms.dt));
      velocity.element(instanceIndex).assign(vec4(nextVelocity, 0));
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Buoyancy") as object;
  }

  private createVorticityNode(readVelocity: Vec4StorageBuffer, writeVelocity: Vec4StorageBuffer): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const center = readVelocity.element(instanceIndex).xyz;
      const left = readVelocity.element(this.linearIndex(coord.x.sub(1), coord.y, coord.z)).xyz;
      const right = readVelocity.element(this.linearIndex(coord.x.add(1), coord.y, coord.z)).xyz;
      const down = readVelocity.element(this.linearIndex(coord.x, coord.y.sub(1), coord.z)).xyz;
      const up = readVelocity.element(this.linearIndex(coord.x, coord.y.add(1), coord.z)).xyz;
      const back = readVelocity.element(this.linearIndex(coord.x, coord.y, coord.z.sub(1))).xyz;
      const front = readVelocity.element(this.linearIndex(coord.x, coord.y, coord.z.add(1))).xyz;
      const curl = vec3(
        up.z.sub(down.z).sub(front.y.sub(back.y)),
        front.x.sub(back.x).sub(right.z.sub(left.z)),
        right.y.sub(left.y).sub(up.x.sub(down.x)),
      ).mul(0.5);
      const uvw = this.cellUVW(coord);
      const phase = uvw.mul(this.uniforms.detailScale).add(vec3(this.uniforms.time.mul(0.19)));
      const turbulenceForce = vec3(
        phase.y.mul(9.1).add(phase.z.mul(4.7)).sin(),
        phase.x.mul(5.3).add(phase.z.mul(3.9)).cos().mul(0.25),
        phase.x.mul(7.7).sub(phase.y.mul(6.2)).cos(),
      ).mul(this.uniforms.turbulence);
      const nextVelocity = center.add(curl.mul(this.uniforms.vorticity).add(turbulenceForce.mul(this.uniforms.curlStrength)).mul(this.uniforms.dt));
      writeVelocity.element(instanceIndex).assign(vec4(nextVelocity, 0));
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Vorticity") as object;
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
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Divergence") as object;
  }

  private createJacobiNode(readPressure: FloatStorageBuffer, writePressure: FloatStorageBuffer): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const left = readPressure.element(this.linearIndex(coord.x.sub(1), coord.y, coord.z));
      const right = readPressure.element(this.linearIndex(coord.x.add(1), coord.y, coord.z));
      const down = readPressure.element(this.linearIndex(coord.x, coord.y.sub(1), coord.z));
      const up = readPressure.element(this.linearIndex(coord.x, coord.y.add(1), coord.z));
      const back = readPressure.element(this.linearIndex(coord.x, coord.y, coord.z.sub(1)));
      const front = readPressure.element(this.linearIndex(coord.x, coord.y, coord.z.add(1)));
      const pressure = left.add(right).add(down).add(up).add(back).add(front).sub(this.divergence.element(instanceIndex)).div(6);
      writePressure.element(instanceIndex).assign(pressure);
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Pressure Jacobi") as object;
  }

  private createProjectionNode(readVelocity: Vec4StorageBuffer, writeVelocity: Vec4StorageBuffer, pressure: FloatStorageBuffer): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const left = pressure.element(this.linearIndex(coord.x.sub(1), coord.y, coord.z));
      const right = pressure.element(this.linearIndex(coord.x.add(1), coord.y, coord.z));
      const down = pressure.element(this.linearIndex(coord.x, coord.y.sub(1), coord.z));
      const up = pressure.element(this.linearIndex(coord.x, coord.y.add(1), coord.z));
      const back = pressure.element(this.linearIndex(coord.x, coord.y, coord.z.sub(1)));
      const front = pressure.element(this.linearIndex(coord.x, coord.y, coord.z.add(1)));
      const gradient = vec3(right.sub(left), up.sub(down), front.sub(back)).mul(0.5);
      const projected = readVelocity.element(instanceIndex).xyz.sub(gradient);
      writeVelocity.element(instanceIndex).assign(vec4(projected, 0));
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Projection") as object;
  }

  private createPackNode(density: Vec4StorageBuffer, velocity: Vec4StorageBuffer): object {
    return Fn(() => {
      const densitySample = density.element(instanceIndex);
      const velocitySample = velocity.element(instanceIndex).xyz;
      const speed = dot(velocitySample, velocitySample).sqrt();
      const light = float(0.74)
        .add(densitySample.y.mul(0.22))
        .add(speed.mul(0.035))
        .sub(densitySample.x.mul(0.28))
        .clamp(0.18, 1);
      textureStore(
        this.renderTexture,
        this.cellTextureCoord(),
        vec4(densitySample.x.clamp(0, 1), densitySample.y.clamp(0, 1), light, 1),
      ).toWriteOnly();
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Render Pack") as object;
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
    return vec3(
      float(coord.x).div(Math.max(1, this.grid[0] - 1)),
      float(coord.y).div(Math.max(1, this.grid[1] - 1)),
      float(coord.z).div(Math.max(1, this.grid[2] - 1)),
    );
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

function createFluidUniforms(params: WispySmokeVFXParams): FluidUniforms {
  const bounds = resolveFluidBounds(params);
  return {
    absorption: uniform(params.absorption),
    buoyancy: uniform(params.buoyantLift),
    curlStrength: uniform(params.curlStrength),
    densityDissipation: uniform(params.densityDissipation),
    detailScale: uniform(params.detailScale),
    detailSpeed: uniform(params.detailSpeed),
    detailStrength: uniform(params.detailStrength),
    diffusion: uniform(params.diffusion),
    dt: uniform(0),
    emissionColor: uniform(new THREE.Color(params.emissionColor)),
    emissionIntensity: uniform(params.emissionIntensity),
    opacity: uniform(params.opacity),
    radius: uniform(resolveSourceRadius(params, bounds)),
    riseSpeed: uniform(params.riseSpeed),
    scattering: uniform(params.scattering),
    shadowSamples: uniform(params.shadowQuality),
    smokeColor: uniform(new THREE.Color(params.color)),
    sourceRate: uniform(params.spawnRate * params.density * 0.03),
    sourceTemperature: uniform(params.sourceTemperature),
    steps: uniform(resolveRenderSteps(params)),
    time: uniform(0),
    turbulence: uniform(params.turbulence),
    velocityDissipation: uniform(params.velocityDissipation),
    vorticity: uniform(params.vorticityConfinement),
    wind: uniform(new THREE.Vector3(params.wind[0], params.wind[1], params.wind[2])),
  };
}

function resolveSourceRadius(params: WispySmokeVFXParams, bounds: VolumeBounds): number {
  return clamp(params.radius / Math.max(0.001, Math.max(bounds.width, bounds.depth)), 0.025, 0.28);
}

function resolvePressureIterations(params: WispySmokeVFXParams): number {
  return Math.max(2, Math.round(params.pressureIterations));
}

export class WispySmokeVFX implements VFXEffect<WispySmokeVFXParams> {
  readonly object3D = new THREE.Group();

  private params: WispySmokeVFXParams;
  private readonly disposables = new DisposableGroup();
  private readonly particles: SmokeParticle[] = [];
  private readonly renderer: unknown;
  private readonly random: () => number;
  private positions = new Float32Array(0);
  private alphas = new Float32Array(0);
  private sizes = new Float32Array(0);
  private angles = new Float32Array(0);
  private backend: RuntimeBackend = "compat";
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private points: THREE.Points;
  private fluid: FluidGrid3D | null = null;
  private spawnCarry = 0;
  private maxParticles = 0;

  constructor(options: WispySmokeVFXOptions = {}) {
    const { position, renderer, ...params } = options;
    this.renderer = renderer;
    const initialParams =
      params.worldPosition || !position ? params : { ...params, worldPosition: position };
    this.params = normalizeWispySmokeParams(initialParams);
    this.backend = this.resolveBackend();
    this.random = mulberry32(this.params.seed);
    this.geometry = this.disposables.add(new THREE.BufferGeometry());
    this.material = this.disposables.add(
      new THREE.ShaderMaterial({
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
        blending: THREE.NormalBlending,
      }),
    );
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.object3D.name = "WispySmokeVFX";
    this.object3D.add(this.points);
    this.applyTransform();
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

  setParams(params: Partial<WispySmokeVFXParams>): void {
    const previousQuality = this.params.quality;
    const previousGridResolution = this.params.gridResolution;
    const previousBackend = this.backend;
    this.params = normalizeWispySmokeParams({ ...this.params, ...params });
    this.backend = this.resolveBackend();
    (this.material.uniforms.uColor as IUniform<THREE.Color>).value.set(this.params.color);
    (this.material.uniforms.uEmissionColor as IUniform<THREE.Color>).value.set(this.params.emissionColor);
    (this.material.uniforms.uEmissionIntensity as IUniform<number>).value = this.params.emissionIntensity;
    (this.material.uniforms.uOpacity as IUniform<number>).value = this.params.opacity;
    (this.material.uniforms.uSoftness as IUniform<number>).value = this.params.softness;
    this.applyTransform();

    if (
      previousQuality !== this.params.quality ||
      previousGridResolution !== this.params.gridResolution ||
      previousBackend !== this.backend
    ) {
      this.disposeFluid();
      this.reallocateCompatibilityParticles();
    }
    this.applyBackendResources();
    this.fluid?.updateParams(this.params);
  }

  getParams(): Readonly<WispySmokeVFXParams> {
    return this.params;
  }

  getStats(): WispySmokeVFXStats {
    const fluidStats = this.fluid?.getStats(this.params);
    const gridProfile = resolveQualityProfile(resolveEffectiveGridResolution(this.params));
    const grid = fluidStats?.gridResolution ?? gridProfile.volumeGrid;
    return {
      backend: this.backend,
      fallbackActive: this.backend !== "webgpu",
      gridCells: fluidStats?.gridCells ?? (this.backend === "webgpu" ? grid[0] * grid[1] * grid[2] : 0),
      gridResolution: grid,
      pressureIterations: fluidStats?.pressureIterations ?? resolvePressureIterations(this.params),
      renderSteps: resolveRenderSteps(this.params),
      requestedBackend: this.params.backendMode,
      simulationMs: fluidStats?.simulationMs ?? 0,
      solverPasses: fluidStats?.solverPasses ?? 0,
    };
  }

  dispose(): void {
    this.disposeFluid();
    this.object3D.remove(this.points);
    this.disposables.dispose();
  }

  private resolveBackend(): RuntimeBackend {
    if (this.params.backendMode === "compat") {
      return "compat";
    }
    if (this.params.backendMode === "webgpu" || this.params.backendMode === "auto") {
      return isWebGPURenderer(this.renderer) ? "webgpu" : "compat";
    }
    return "compat";
  }

  private applyBackendResources(): void {
    this.points.visible = this.backend === "compat";
    if (this.backend === "webgpu") {
      this.ensureFluid();
    }
    if (this.fluid) {
      this.fluid.mesh.visible = this.backend === "webgpu";
    }
  }

  private ensureFluid(): void {
    if (this.fluid) {
      return;
    }
    this.fluid = new FluidGrid3D(this.params);
    this.fluid.mesh.visible = this.backend === "webgpu";
    this.object3D.add(this.fluid.mesh);
  }

  private disposeFluid(): void {
    if (!this.fluid) {
      return;
    }
    this.object3D.remove(this.fluid.mesh);
    this.fluid.dispose();
    this.fluid = null;
  }

  private applyTransform(): void {
    const [x, y, z] = this.params.worldPosition;
    this.object3D.position.set(x, y, z);
  }

  private reallocateCompatibilityParticles(): void {
    const profile = resolveQualityProfile(this.params.quality);
    this.maxParticles = Math.max(
      16,
      Math.min(profile.maxParticles, Math.ceil(this.params.spawnRate * this.params.lifetime * 1.15)),
    );
    this.positions = new Float32Array(this.maxParticles * 3);
    this.alphas = new Float32Array(this.maxParticles);
    this.sizes = new Float32Array(this.maxParticles);
    this.angles = new Float32Array(this.maxParticles);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute("aAngle", new THREE.BufferAttribute(this.angles, 1));
    this.geometry.setDrawRange(0, 0);
    if (this.particles.length > this.maxParticles) {
      this.particles.length = this.maxParticles;
    }
  }

  private spawnParticles(deltaSeconds: number): void {
    this.spawnCarry += this.params.spawnRate * deltaSeconds * 0.72;
    const spawnCount = Math.floor(this.spawnCarry);
    this.spawnCarry -= spawnCount;
    for (let index = 0; index < spawnCount && this.particles.length < this.maxParticles; index += 1) {
      const angle = this.random() * Math.PI * 2;
      const disk = Math.sqrt(this.random()) * Math.max(0.02, this.params.radius);
      this.particles.push({
        age: 0,
        angle: this.random() * Math.PI * 2,
        baseSize: this.params.size * (0.5 + this.random() * 0.55),
        lifetime: this.params.lifetime * (0.72 + this.random() * 0.56),
        velocityX: Math.cos(angle) * this.params.turbulence * 0.14,
        velocityY: this.params.riseSpeed * this.params.buoyantLift * (0.55 + this.random() * 0.28),
        velocityZ: Math.sin(angle) * this.params.turbulence * 0.14,
        x: Math.cos(angle) * disk,
        y: 0.08 + this.random() * this.params.radius,
        z: Math.sin(angle) * disk,
      });
    }
  }

  private integrateParticles(deltaSeconds: number): void {
    const [windX, windY, windZ] = this.params.wind;
    let writeIndex = 0;
    for (const particle of this.particles) {
      particle.age += deltaSeconds;
      const ageRatio = particle.age / Math.max(0.001, particle.lifetime);
      if (ageRatio >= 1 || particle.y > this.params.height) {
        continue;
      }
      const swirl = this.params.curlStrength * (1 - ageRatio) * deltaSeconds;
      const sin = Math.sin(particle.y * 2.1 + particle.angle);
      const cos = Math.cos(particle.y * 1.7 + particle.angle);
      particle.velocityX += sin * swirl * 0.12;
      particle.velocityZ += cos * swirl * 0.12;
      particle.x += (particle.velocityX + windX) * deltaSeconds;
      particle.y += (particle.velocityY + windY + this.params.sourceTemperature * 0.035) * deltaSeconds;
      particle.z += (particle.velocityZ + windZ) * deltaSeconds;
      particle.angle += (0.15 + this.params.curlStrength * 0.22) * deltaSeconds;
      this.particles[writeIndex] = particle;
      writeIndex += 1;
    }
    this.particles.length = writeIndex;
  }

  private writeCompatGeometry(): void {
    let count = 0;
    for (const particle of this.particles) {
      if (count >= this.maxParticles) {
        break;
      }
      const ageRatio = clamp(particle.age / Math.max(0.001, particle.lifetime), 0, 1);
      const lifeFade =
        sampleCurve(this.params.opacityRamp, ageRatio) *
        Math.pow(1 - ageRatio * this.params.densityDissipation, this.params.dissipation);
      const heightFade = 1 - smoothstep(0.82, 1, particle.y / Math.max(0.01, this.params.height));
      this.positions[count * 3] = particle.x;
      this.positions[count * 3 + 1] = particle.y;
      this.positions[count * 3 + 2] = particle.z;
      this.alphas[count] = clamp(this.params.density * lifeFade * heightFade, 0, 1);
      this.sizes[count] = particle.baseSize * (0.45 + ageRatio * 1.8);
      this.angles[count] = particle.angle;
      count += 1;
    }
    this.geometry.setDrawRange(0, count);
    this.geometry.getAttribute("position").needsUpdate = true;
    this.geometry.getAttribute("aAlpha").needsUpdate = true;
    this.geometry.getAttribute("aSize").needsUpdate = true;
    this.geometry.getAttribute("aAngle").needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}
