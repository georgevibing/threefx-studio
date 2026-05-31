import * as THREE from "three/webgpu";
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
import {
  DisposableGroup,
  isWebGPURenderer,
  resolveQualityProfile,
  type RuntimeBackend,
  type VFXEffect,
} from "@threefx/runtime";
import { normalizeWispySmokeParams, normalizeWispySmokeRuntimeConfig } from "./wispySmokeDefaults";
import type {
  WispySmokeVFXOptions,
  WispySmokeVFXParams,
  WispySmokeVFXStats,
} from "./wispySmokeTypes";
import type {
  WispySmokeDebugView,
  WispySmokeEmitterConfig,
  WispySmokeObstacleConfig,
  WispySmokeRuntimeConfig,
} from "@threefx/core";

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
  readonly baseDensity: UniformNode<"float", number>;
  readonly buoyancy: UniformNode<"float", number>;
  readonly curlStrength: UniformNode<"float", number>;
  readonly densityDissipation: UniformNode<"float", number>;
  readonly detailOctaves: UniformNode<"float", number>;
  readonly detailScale: UniformNode<"float", number>;
  readonly detailSpeed: UniformNode<"float", number>;
  readonly detailStrength: UniformNode<"float", number>;
  readonly diffusion: UniformNode<"float", number>;
  readonly dt: UniformNode<"float", number>;
  readonly debugView: UniformNode<"float", number>;
  readonly emissionColor: UniformNode<"color", THREE.Color>;
  readonly emissionIntensity: UniformNode<"float", number>;
  readonly gridScale: UniformNode<"vec3", THREE.Vector3>;
  readonly opacity: UniformNode<"float", number>;
  readonly plumeTaper: UniformNode<"float", number>;
  readonly radius: UniformNode<"float", number>;
  readonly residenceRate: UniformNode<"float", number>;
  readonly riseSpeed: UniformNode<"float", number>;
  readonly scattering: UniformNode<"float", number>;
  readonly shadowSamples: UniformNode<"float", number>;
  readonly shadowStrength: UniformNode<"float", number>;
  readonly smokeColor: UniformNode<"color", THREE.Color>;
  readonly sourceTemperature: UniformNode<"float", number>;
  readonly steps: UniformNode<"float", number>;
  readonly time: UniformNode<"float", number>;
  readonly turbulence: UniformNode<"float", number>;
  readonly velocityDissipation: UniformNode<"float", number>;
  readonly vorticity: UniformNode<"float", number>;
  readonly vortexPosition: UniformNode<"vec3", THREE.Vector3>;
  readonly vortexRadius: UniformNode<"float", number>;
  readonly vortexStrength: UniformNode<"float", number>;
  readonly wind: UniformNode<"vec3", THREE.Vector3>;
}

interface FluidEmitterUniforms {
  readonly density: UniformNode<"float", number>;
  readonly falloff: UniformNode<"float", number>;
  readonly noiseScale: UniformNode<"float", number>;
  readonly noiseStrength: UniformNode<"float", number>;
  readonly position: UniformNode<"vec3", THREE.Vector3>;
  readonly radius: UniformNode<"float", number>;
  readonly scale: UniformNode<"vec3", THREE.Vector3>;
  readonly shape: WispySmokeEmitterConfig["shape"];
  readonly spawnRate: UniformNode<"float", number>;
  readonly temperature: UniformNode<"float", number>;
  readonly velocity: UniformNode<"vec3", THREE.Vector3>;
}

interface FluidObstacleUniforms {
  readonly position: UniformNode<"vec3", THREE.Vector3>;
  readonly radius: UniformNode<"float", number>;
  readonly scale: UniformNode<"vec3", THREE.Vector3>;
  readonly shape: WispySmokeObstacleConfig["shape"];
  readonly softness: UniformNode<"float", number>;
}

type Texture3DNode = ReturnType<typeof texture3D>;
type Vec4StorageBuffer = StorageBufferNodeBase<"vec4">;
type FloatStorageBuffer = StorageBufferNodeBase<"float">;

const SOURCE_DENSITY_RATE_SCALE = 0.032;
const SOURCE_VELOCITY_INJECTION_SCALE = 1.45;

interface SmokeRaymarchArgs {
  readonly [key: string]: unknown;
  readonly absorption: Node<"float">;
  readonly baseDensity: Node<"float">;
  readonly debugView: Node<"float">;
  readonly detailScale: Node<"float">;
  readonly detailSpeed: Node<"float">;
  readonly detailStrength: Node<"float">;
  readonly detailOctaves: Node<"float">;
  readonly emissionColor: Node<"color">;
  readonly emissionIntensity: Node<"float">;
  readonly opacity: Node<"float">;
  readonly plumeTaper: Node<"float">;
  readonly scattering: Node<"float">;
  readonly shadowSamples: Node<"float">;
  readonly shadowStrength: Node<"float">;
  readonly smokeColor: Node<"color">;
  readonly steps: Node<"float">;
  readonly texture: Texture3DNode;
  readonly time: Node<"float">;
}

interface ComputeRenderer {
  compute(
    computeNode: object | readonly object[],
    dispatchSize?: number | readonly number[],
  ): void | Promise<void>;
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
    baseDensity,
    debugView,
    detailOctaves,
    detailScale,
    detailSpeed,
    detailStrength,
    emissionColor,
    emissionIntensity,
    opacity,
    plumeTaper,
    scattering,
    shadowSamples,
    shadowStrength,
    smokeColor,
    steps,
    texture,
    time,
  }: SmokeRaymarchArgs) => {
    const finalColor = vec4(0).toVar();
    const lightDir = vec3(0.36, 0.82, 0.18).normalize();

    RaymarchingBox(steps, ({ positionRay }) => {
      const baseUVW = positionRay.add(0.5).clamp(0.001, 0.999);
      const heightRamp = baseUVW.y;
      const lowFrequencyCoord = baseUVW
        .mul(detailScale.mul(0.19))
        .add(
          vec3(
            time.mul(detailSpeed).mul(0.08),
            time.mul(detailSpeed).mul(-0.13),
            time.mul(detailSpeed).mul(0.06),
          ),
        );
      const domainWarp = vec3(
        valueNoise3D(lowFrequencyCoord.add(vec3(3.1, 11.7, 5.4))).sub(0.5),
        valueNoise3D(lowFrequencyCoord.add(vec3(19.4, 2.6, 31.2))).sub(0.5).mul(0.45),
        valueNoise3D(lowFrequencyCoord.add(vec3(7.8, 29.1, 13.5))).sub(0.5),
      )
        .mul(detailStrength)
        .mul(0.055)
        .mul(nodeSmoothstep(0.05, 0.9, heightRamp));
      const macroCurlWarp = vec3(
        heightRamp.mul(7.2).add(time.mul(detailSpeed).mul(0.42)).sin(),
        float(0),
        heightRamp.mul(5.7).sub(time.mul(detailSpeed).mul(0.31)).cos(),
      )
        .mul(detailStrength)
        .mul(0.018)
        .mul(nodeSmoothstep(0.16, 0.82, heightRamp));
      const uvw = baseUVW.add(domainWarp).add(macroCurlWarp).clamp(0.001, 0.999);
      const packed = texture.sample(uvw).toVar();
      const lateralSampleWeight = nodeSmoothstep(0.08, 0.88, heightRamp).clamp(0, 1);
      const densitySideA = texture.sample(
        uvw.add(vec3(0.038, 0.008, -0.026).mul(lateralSampleWeight)).clamp(0.001, 0.999),
      ).r;
      const densitySideB = texture.sample(
        uvw.add(vec3(-0.03, -0.006, 0.038).mul(lateralSampleWeight)).clamp(0.001, 0.999),
      ).r;
      const densitySideC = texture.sample(
        uvw.add(vec3(0.02, 0.012, 0.032).mul(lateralSampleWeight)).clamp(0.001, 0.999),
      ).r;
      const upperSpread = nodeSmoothstep(0.04, 0.82, heightRamp).clamp(0, 1);
      const spreadPhase = heightRamp.mul(7.1).add(time.mul(detailSpeed).mul(0.28));
      const spreadPhaseB = spreadPhase.add(2.09);
      const spreadPhaseC = spreadPhase.add(4.18);
      const spreadPhaseD = spreadPhase.add(5.32);
      const densitySideD = texture.sample(
        uvw
          .add(
            vec3(spreadPhase.sin().mul(0.066), 0.018, spreadPhase.cos().mul(0.042)).mul(
              upperSpread,
            ),
          )
          .clamp(0.001, 0.999),
      ).r;
      const densitySideE = texture.sample(
        uvw
          .add(
            vec3(spreadPhaseB.sin().mul(0.052), 0.014, spreadPhaseB.cos().mul(0.064)).mul(
              upperSpread,
            ),
          )
          .clamp(0.001, 0.999),
      ).r;
      const densitySideF = texture.sample(
        uvw
          .add(
            vec3(spreadPhaseC.sin().mul(0.066), 0.01, spreadPhaseC.cos().mul(0.044)).mul(
              upperSpread,
            ),
          )
          .clamp(0.001, 0.999),
      ).r;
      const densitySideG = texture.sample(
        uvw
          .add(
            vec3(spreadPhaseD.sin().mul(0.04), 0.006, spreadPhaseD.cos().mul(0.068)).mul(
              upperSpread,
            ),
          )
          .clamp(0.001, 0.999),
      ).r;
      const gridDensity = float(packed.r)
        .mul(mix(float(0.66), float(0.44), upperSpread))
        .add(densitySideA.max(densitySideB).mul(mix(float(0.28), float(0.34), upperSpread)))
        .add(densitySideC.mul(0.1))
        .add(densitySideD.max(densitySideE).mul(upperSpread).mul(0.18))
        .add(densitySideF.max(densitySideG).mul(upperSpread).mul(0.16))
        .clamp(0, 2.5)
        .toVar();
      const temperature = float(packed.g).toVar();
      const speed = float(packed.b).mul(8).clamp(0, 8).toVar();
      const residence = float(packed.a).toVar();
      const bakedLight = float(0.74)
        .add(temperature.mul(0.22))
        .add(speed.mul(0.035))
        .sub(gridDensity.mul(0.28))
        .clamp(0.18, 1);
      const densityDx = texture.sample(uvw.add(vec3(0.018, 0, 0)).clamp(0.001, 0.999)).r.sub(
        texture.sample(uvw.sub(vec3(0.018, 0, 0)).clamp(0.001, 0.999)).r,
      );
      const densityDy = texture.sample(uvw.add(vec3(0, 0.018, 0)).clamp(0.001, 0.999)).r.sub(
        texture.sample(uvw.sub(vec3(0, 0.018, 0)).clamp(0.001, 0.999)).r,
      );
      const densityDz = texture.sample(uvw.add(vec3(0, 0, 0.018)).clamp(0.001, 0.999)).r.sub(
        texture.sample(uvw.sub(vec3(0, 0, 0.018)).clamp(0.001, 0.999)).r,
      );
      const densityGradient = densityDx
        .mul(densityDx)
        .add(densityDy.mul(densityDy))
        .add(densityDz.mul(densityDz))
        .sqrt();

      const warpPhase = uvw
        .mul(detailScale.mul(0.37))
        .add(
          vec3(
            time.mul(detailSpeed).mul(0.07),
            time.mul(detailSpeed).mul(-0.05),
            time.mul(detailSpeed).mul(0.09),
          ),
        );
      const warp = vec3(
        warpPhase.y.mul(3.1).add(warpPhase.z.mul(1.7)).sin(),
        warpPhase.z.mul(2.6).add(warpPhase.x.mul(1.9)).cos(),
        warpPhase.x.mul(2.9).sub(warpPhase.y.mul(1.5)).sin(),
      ).mul(0.34);
      const detailCoord = uvw
        .mul(detailScale)
        .add(warp)
        .add(
          vec3(
            time.mul(detailSpeed).mul(0.13),
            time.mul(detailSpeed).mul(-0.19),
            time.mul(detailSpeed).mul(0.11),
          ),
        );
      const detail = float(0).toVar();
      const amplitude = float(0.58).toVar();
      const frequency = float(1).toVar();
      for (let octave = 0; octave < 5; octave += 1) {
        If(detailOctaves.greaterThan(octave), () => {
          const octaveCoord = detailCoord.mul(frequency);
          const valueNoise = valueNoise3D(octaveCoord);
          const ridge = valueNoise.sub(0.5).mul(2).abs().oneMinus().clamp(0, 1);
          const cellular = valueNoise3D(octaveCoord.add(vec3(17.31, 41.17, 9.23)).mul(1.37))
            .sub(valueNoise)
            .abs()
            .oneMinus()
            .clamp(0, 1);
          detail.addAssign(
            valueNoise
              .mul(0.48)
              .add(ridge.mul(0.36))
              .add(cellular.mul(0.16))
              .mul(amplitude),
          );
          frequency.mulAssign(2.03);
          amplitude.mulAssign(0.52);
        });
      }
      const detailMod = detail.sub(0.38).mul(detailStrength).add(1).clamp(0.05, 2.8);
      const floorFade = nodeSmoothstep(0.0, 0.055, heightRamp);
      const ceilingFade = nodeSmoothstep(0.92, 0.998, heightRamp).oneMinus().clamp(0, 1);
      const sideEdge = uvw.x
        .min(uvw.z)
        .min(uvw.x.oneMinus())
        .min(uvw.z.oneMinus());
      const sideFade = nodeSmoothstep(0.018, 0.105, sideEdge).clamp(0, 1);
      const radial = uvw.x
        .sub(0.5)
        .mul(uvw.x.sub(0.5))
        .add(uvw.z.sub(0.5).mul(uvw.z.sub(0.5)))
        .sqrt();
      const upperWispWeight = nodeSmoothstep(0.24, 0.88, heightRamp).clamp(0, 1);
      const plumeNoise = valueNoise3D(
        uvw
          .mul(detailScale.mul(0.14))
          .add(vec3(time.mul(detailSpeed).mul(0.06), time.mul(detailSpeed).mul(-0.04), 17.3)),
      )
        .sub(0.5)
        .mul(0.12);
      const plumeRadius = mix(
        float(0.18),
        float(0.4),
        nodeSmoothstep(0.07, 0.82, heightRamp),
      )
        .add(plumeNoise)
        .clamp(0.08, 0.5);
      const plumeSoftness = mix(float(0.17), float(0.3), upperWispWeight);
      const plumeFade = nodeSmoothstep(plumeRadius, plumeRadius.add(plumeSoftness), radial)
        .oneMinus()
        .clamp(0, 1);
      const edgeBreakup = nodeSmoothstep(
        0.08,
        0.72,
        gridDensity.mul(1.35).add(detail.sub(0.48).mul(detailStrength.mul(0.24))),
      ).clamp(0.08, 1.2);
      const edgeInfluence = nodeSmoothstep(0.12, 1.25, gridDensity).oneMinus();
      const taperInfluence = plumeTaper
        .clamp(0, 1)
        .mul(mix(float(0.46), float(0.22), upperWispWeight));
      const noisyResidence = residence.add(detail.sub(0.5).mul(0.28)).clamp(0, 1);
      const residenceKeep = float(1)
        .sub(nodeSmoothstep(0.5, 1, noisyResidence))
        .clamp(0.12, 1);
      const ageFade = mix(
        float(1),
        residenceKeep,
        nodeSmoothstep(0.18, 0.86, heightRamp),
      );
      const erosionNoise = detail
        .add(valueNoise3D(detailCoord.mul(0.53).add(vec3(43.1, 9.7, 21.8))).mul(0.36))
        .sub(gridDensity.mul(0.08));
      const erosionMask = nodeSmoothstep(0.32, 0.96, erosionNoise).clamp(0.025, 1);
      const edgeSheetMask = mix(float(1), erosionMask, edgeInfluence.mul(0.72)).clamp(0.045, 1);
      const upperSheetMask = mix(float(1), erosionMask, upperWispWeight.mul(0.88)).clamp(0.025, 1);
      const upperDensityFade = mix(
        float(1),
        float(0.56),
        upperWispWeight.mul(0.74),
      ).clamp(0.42, 1);
      const sheetErosion = edgeSheetMask.mul(upperSheetMask).mul(upperDensityFade);
      const fineFilaments = nodeSmoothstep(
        0.4,
        0.92,
        detail
          .add(valueNoise3D(detailCoord.mul(1.71).add(vec3(8.2, 51.4, 14.7))).mul(0.22))
          .sub(0.24),
      )
        .clamp(0.12, 1);
      const rollCoord = uvw
        .mul(detailScale.mul(0.21))
        .add(
          vec3(
            heightRamp.mul(2.2).add(time.mul(detailSpeed).mul(0.06)),
            time.mul(detailSpeed).mul(-0.08),
            heightRamp.mul(-1.8).add(time.mul(detailSpeed).mul(0.05)),
          ),
        );
      const billowMask = nodeSmoothstep(
        0.24,
        0.78,
        valueNoise3D(rollCoord)
          .mul(0.62)
          .add(valueNoise3D(rollCoord.mul(1.77).add(vec3(9.1, 27.4, 3.8))).mul(0.38)),
      ).clamp(0.12, 1.05);
      const filamentMask = nodeSmoothstep(
        0.34,
        0.84,
        detail.add(gridDensity.mul(0.08)),
      )
        .mul(mix(float(1), fineFilaments, upperWispWeight.mul(0.58)))
        .mul(mix(float(1), billowMask, upperWispWeight.mul(0.5)))
        .clamp(0.045, 1);
      const gradientRim = nodeSmoothstep(0.018, 0.18, densityGradient.mul(3.8)).clamp(0, 1);
      const interiorFade = mix(
        float(0.16),
        float(1),
        gradientRim.add(fineFilaments.mul(0.5)).clamp(0, 1),
      );
      const denseCoreFade = mix(
        float(1),
        float(0.16),
        nodeSmoothstep(0.32, 1.18, gridDensity).mul(gradientRim.oneMinus()),
      );
      const density = gridDensity
        .mul(baseDensity)
        .mul(detailMod)
        .mul(floorFade)
        .mul(ceilingFade)
        .mul(sideFade)
        .mul(mix(float(0.72), float(1), nodeSmoothstep(0.1, 0.32, heightRamp)))
        .mul(mix(float(1), plumeFade, taperInfluence))
        .mul(edgeBreakup)
        .mul(sheetErosion)
        .mul(filamentMask)
        .mul(interiorFade)
        .mul(denseCoreFade)
        .mul(ageFade)
        .clamp(0, 1.25)
        .toVar();

      const shadowA = texture.sample(uvw.add(lightDir.mul(0.035)).clamp(0.001, 0.999)).r;
      const shadowB = texture.sample(uvw.add(lightDir.mul(0.075)).clamp(0.001, 0.999)).r;
      const shadowC = texture.sample(uvw.add(lightDir.mul(0.12)).clamp(0.001, 0.999)).r;
      const shadowDensity = shadowA.add(shadowB).add(shadowC).div(3);
      const selfShadow = shadowDensity
        .mul(absorption)
        .mul(float(0.2).add(shadowSamples.mul(0.024)).mul(shadowStrength))
        .negate()
        .exp()
        .clamp(0.12, 1);
      const beerAlpha = density.mul(absorption).mul(0.011).negate().exp().oneMinus();
      const sampleAlpha = beerAlpha.mul(opacity).clamp(0, 0.2).toVar();
      const heightScatter = nodeSmoothstep(0.08, 0.9, heightRamp).mul(0.38).add(0.78);
      const upperCool = smokeColor.rgb.mul(vec3(1.2, 1.28, 1.36));
      const lowerDense = smokeColor.rgb.mul(vec3(0.72, 0.76, 0.82));
      const heightTone = mix(lowerDense, upperCool, nodeSmoothstep(0.18, 0.82, heightRamp));
      const denseTone = smokeColor.rgb.mul(vec3(0.62, 0.66, 0.72));
      const smokeTone = mix(heightTone, denseTone, density.mul(0.12).clamp(0, 0.46));
      const smokeScatter = smokeTone
        .mul(scattering)
        .mul(heightScatter)
        .mul(selfShadow)
        .mul(bakedLight.mul(0.48).add(0.78));
      const thermalEmission = emissionColor.rgb
        .mul(emissionIntensity)
        .mul(temperature)
        .mul(nodeSmoothstep(0.08, 0.88, heightRamp).oneMinus())
        .mul(0.14);
      const sampleColor = smokeScatter.add(thermalEmission).toVar();
      If(debugView.greaterThan(0.5), () => {
        sampleColor.assign(vec3(density));
        sampleAlpha.assign(density.mul(0.72).clamp(0, 0.9));
      });
      If(debugView.greaterThan(1.5), () => {
        sampleColor.assign(
          vec3(temperature.mul(1.5), temperature.mul(0.42), temperature.mul(0.08)),
        );
        sampleAlpha.assign(temperature.mul(0.82).clamp(0, 0.9));
      });
      If(debugView.greaterThan(2.5), () => {
        sampleColor.assign(vec3(speed.mul(0.18), speed.mul(0.62), speed));
        sampleAlpha.assign(speed.mul(0.45).clamp(0, 0.85));
      });
      If(debugView.greaterThan(6.5), () => {
        const edge = uvw.x
          .min(uvw.y)
          .min(uvw.z)
          .min(uvw.x.oneMinus())
          .min(uvw.y.oneMinus())
          .min(uvw.z.oneMinus());
        const bounds = float(1).sub(nodeSmoothstep(0.005, 0.035, edge));
        sampleColor.assign(vec3(bounds));
        sampleAlpha.assign(bounds.mul(0.72));
      });
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

function curlNoiseField3D(coord: Node<"vec3">): Node<"vec3"> {
  const epsilon = 0.16;
  const offsetX = vec3(epsilon, 0, 0);
  const offsetY = vec3(0, epsilon, 0);
  const offsetZ = vec3(0, 0, epsilon);
  const fieldOffsetA = vec3(13.7, 3.1, 29.4);
  const fieldOffsetB = vec3(41.2, 17.6, 5.8);
  const fieldOffsetC = vec3(7.3, 53.1, 19.9);
  const dA_dy = valueNoise3D(coord.add(offsetY).add(fieldOffsetA)).sub(
    valueNoise3D(coord.sub(offsetY).add(fieldOffsetA)),
  );
  const dA_dz = valueNoise3D(coord.add(offsetZ).add(fieldOffsetA)).sub(
    valueNoise3D(coord.sub(offsetZ).add(fieldOffsetA)),
  );
  const dB_dx = valueNoise3D(coord.add(offsetX).add(fieldOffsetB)).sub(
    valueNoise3D(coord.sub(offsetX).add(fieldOffsetB)),
  );
  const dB_dz = valueNoise3D(coord.add(offsetZ).add(fieldOffsetB)).sub(
    valueNoise3D(coord.sub(offsetZ).add(fieldOffsetB)),
  );
  const dC_dx = valueNoise3D(coord.add(offsetX).add(fieldOffsetC)).sub(
    valueNoise3D(coord.sub(offsetX).add(fieldOffsetC)),
  );
  const dC_dy = valueNoise3D(coord.add(offsetY).add(fieldOffsetC)).sub(
    valueNoise3D(coord.sub(offsetY).add(fieldOffsetC)),
  );
  const curl = vec3(
    dC_dy.sub(dB_dz),
    dA_dz.sub(dC_dx),
    dB_dx.sub(dA_dy),
  ).div(epsilon * 2);
  return curl.div(dot(curl, curl).sqrt().max(0.0001));
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
      const local = clamp(
        (time - previous.time) / Math.max(0.0001, next.time - previous.time),
        0,
        1,
      );
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

function debugViewIndex(view: WispySmokeDebugView): number {
  return [
    "final",
    "density",
    "temperature",
    "velocity",
    "divergence",
    "pressure",
    "obstacles",
    "bounds",
  ].indexOf(view);
}

function vectorFromTuple(value: readonly [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(value[0], value[1], value[2]);
}

function primaryField(config: WispySmokeRuntimeConfig): WispySmokeRuntimeConfig["fields"][number] {
  return (
    config.fields[0] ?? normalizeWispySmokeRuntimeConfig(normalizeWispySmokeParams()).fields[0]!
  );
}

function primaryForce(config: WispySmokeRuntimeConfig): WispySmokeRuntimeConfig["forces"][number] {
  const fallback = normalizeWispySmokeRuntimeConfig(normalizeWispySmokeParams()).forces[0]!;
  const buoyancy = config.forces.find((force) => force.type === "buoyancy") ?? fallback;
  const windForces = config.forces.filter((force) => force.type === "wind");
  const wind =
    windForces.length > 0
      ? windForces.reduce(
          (sum, force) =>
            [
              sum[0] + force.wind[0] * force.strength,
              sum[1] + force.wind[1] * force.strength,
              sum[2] + force.wind[2] * force.strength,
            ] as [number, number, number],
          [0, 0, 0] as [number, number, number],
        )
      : buoyancy.wind;
  return {
    ...buoyancy,
    wind,
  };
}

function primaryVortexForce(
  config: WispySmokeRuntimeConfig,
): WispySmokeRuntimeConfig["forces"][number] {
  const fallback = normalizeWispySmokeRuntimeConfig(normalizeWispySmokeParams()).forces[0]!;
  return (
    config.forces.find((force) => force.type === "vortex") ?? {
      ...fallback,
      id: "vortex_disabled",
      radius: 1,
      strength: 0,
      type: "vortex",
    }
  );
}

function resolveFluidBounds(params: WispySmokeVFXParams): VolumeBounds {
  const windSpread = Math.hypot(params.wind[0], params.wind[2]) * params.lifetime * 0.32;
  const sourceSpread =
    params.radius * 8 + params.turbulence * 0.32 + params.size * 0.35 + windSpread;
  const authoredSize = params.size * 1.08;
  const width = Math.max(3.1, sourceSpread, authoredSize, params.height * 0.42);
  return {
    depth: width,
    height: Math.max(0.75, params.height),
    width,
  };
}

function resolveEffectiveConfigGridResolution(
  config: WispySmokeRuntimeConfig,
): WispySmokeVFXParams["gridResolution"] {
  return QUALITY_RANK[config.solver.gridResolution] <= QUALITY_RANK[config.solver.quality]
    ? config.solver.gridResolution
    : config.solver.quality;
}

function resolveConfigRenderSteps(config: WispySmokeRuntimeConfig): number {
  const profile = resolveQualityProfile(resolveEffectiveConfigGridResolution(config));
  return Math.max(16, Math.round(profile.maxRaySteps * config.render.renderStepScale));
}

class FluidGrid3D {
  readonly cells: number;
  readonly grid: readonly [number, number, number];
  readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.NodeMaterial>;

  private bounds: VolumeBounds;
  private config: WispySmokeRuntimeConfig;
  private readonly clearNode: object;
  private readonly curl: Vec4StorageBuffer;
  private readonly densityA: Vec4StorageBuffer;
  private readonly densityB: Vec4StorageBuffer;
  private readonly diffusionNodes: readonly [object, object];
  private readonly velocityA: Vec4StorageBuffer;
  private readonly velocityB: Vec4StorageBuffer;
  private readonly obstacleMask: FloatStorageBuffer;
  private readonly pressureA: FloatStorageBuffer;
  private readonly pressureB: FloatStorageBuffer;
  private readonly divergence: FloatStorageBuffer;
  private readonly renderTexture: THREE.Storage3DTexture;
  private readonly geometry: THREE.BoxGeometry;
  private readonly material: THREE.NodeMaterial;
  private readonly uniforms: FluidUniforms;
  private readonly emitterUniforms: readonly FluidEmitterUniforms[];
  private readonly obstacleUniforms: readonly FluidObstacleUniforms[];
  private readonly obstacleClearNode: object;
  private readonly obstacleNodes: readonly object[];
  private readonly pressureClearNode: object;
  private readonly sourceNodes: readonly [readonly object[], readonly object[]];
  private readonly advectNodes: readonly [object, object];
  private readonly buoyancyNodes: readonly [object, object];
  private readonly curlNodes: readonly [object, object];
  private readonly confinementNodes: readonly [object, object];
  private readonly divergenceNodes: readonly [object, object];
  private readonly jacobiNodes: readonly [object, object];
  private readonly projectionNodes: readonly [readonly [object, object], readonly [object, object]];
  private readonly packNodes: readonly [object, object];
  private activeBuffer: 0 | 1 = 0;
  private hasCleared = false;
  private lastSimulationMs = 0;
  private lastSolverPasses = 0;

  constructor(params: WispySmokeVFXParams, config: WispySmokeRuntimeConfig) {
    const profile = resolveQualityProfile(resolveEffectiveConfigGridResolution(config));
    this.grid = profile.volumeGrid;
    this.cells = this.grid[0] * this.grid[1] * this.grid[2];
    this.bounds = resolveFluidBounds(params);
    this.config = config;
    this.uniforms = createFluidUniforms(params, config);
    this.emitterUniforms = createEmitterUniforms(config, this.bounds);
    this.obstacleUniforms = createObstacleUniforms(config, this.bounds);

    this.densityA = instancedArray(this.cells, "vec4");
    this.densityB = instancedArray(this.cells, "vec4");
    this.velocityA = instancedArray(this.cells, "vec4");
    this.velocityB = instancedArray(this.cells, "vec4");
    this.curl = instancedArray(this.cells, "vec4");
    this.obstacleMask = instancedArray(this.cells, "float");
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
      debugView: this.uniforms.debugView,
      detailOctaves: this.uniforms.detailOctaves,
      detailScale: this.uniforms.detailScale,
      detailSpeed: this.uniforms.detailSpeed,
      detailStrength: this.uniforms.detailStrength,
      emissionColor: this.uniforms.emissionColor,
      emissionIntensity: this.uniforms.emissionIntensity,
      opacity: this.uniforms.opacity,
      plumeTaper: this.uniforms.plumeTaper,
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
    this.material.blending =
      config.render.blendMode === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending;

    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "WispySmokeVFXEulerianFluidVolume";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.applyBounds(params);

    this.clearNode = this.createClearNode();
    this.obstacleClearNode = this.createObstacleClearNode();
    this.obstacleNodes = this.obstacleUniforms.map((_, index) => this.createObstacleNode(index));
    this.pressureClearNode = this.createPressureClearNode();
    this.sourceNodes = [
      this.emitterUniforms.map((_, index) =>
        this.createSourceNode(index, this.densityA, this.velocityA, this.densityB, this.velocityB),
      ),
      this.emitterUniforms.map((_, index) =>
        this.createSourceNode(index, this.densityB, this.velocityB, this.densityA, this.velocityA),
      ),
    ];
    this.advectNodes = [
      this.createAdvectNode(this.densityA, this.velocityA, this.densityB, this.velocityB),
      this.createAdvectNode(this.densityB, this.velocityB, this.densityA, this.velocityA),
    ];
    this.diffusionNodes = [
      this.createDiffusionNode(this.densityA, this.velocityA, this.densityB, this.velocityB),
      this.createDiffusionNode(this.densityB, this.velocityB, this.densityA, this.velocityA),
    ];
    this.buoyancyNodes = [
      this.createBuoyancyNode(this.densityA, this.velocityA),
      this.createBuoyancyNode(this.densityB, this.velocityB),
    ];
    this.curlNodes = [this.createCurlNode(this.velocityA), this.createCurlNode(this.velocityB)];
    this.confinementNodes = [
      this.createConfinementNode(this.densityA, this.velocityA, this.velocityB),
      this.createConfinementNode(this.densityB, this.velocityB, this.velocityA),
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

  updateParams(params: WispySmokeVFXParams, config: WispySmokeRuntimeConfig): void {
    this.config = config;
    this.applyBounds(params);
    const field = primaryField(config);
    const force = primaryForce(config);
    const vortex = primaryVortexForce(config);
    this.uniforms.absorption.value = params.absorption;
    this.uniforms.baseDensity.value = config.render.baseDensity;
    this.uniforms.buoyancy.value = force.buoyantLift;
    this.uniforms.curlStrength.value = field.curlStrength;
    this.uniforms.densityDissipation.value = config.solver.densityDissipation;
    this.uniforms.debugView.value = debugViewIndex(config.debug.view);
    this.uniforms.detailOctaves.value = config.render.detailOctaves;
    this.uniforms.detailScale.value = config.render.detailScale;
    this.uniforms.detailSpeed.value = config.render.detailSpeed;
    this.uniforms.detailStrength.value = config.render.detailStrength;
    this.uniforms.diffusion.value = config.solver.diffusion;
    this.uniforms.emissionColor.value.set(params.emissionColor);
    this.uniforms.emissionIntensity.value = params.emissionIntensity;
    this.uniforms.opacity.value = config.render.opacity;
    this.uniforms.plumeTaper.value = config.render.plumeTaper;
    this.uniforms.radius.value = resolveSourceRadius(params, this.bounds);
    this.uniforms.residenceRate.value = 1 / Math.max(0.25, params.lifetime);
    this.uniforms.riseSpeed.value = force.riseSpeed;
    this.uniforms.scattering.value = config.render.scattering;
    this.uniforms.shadowSamples.value = config.render.shadowQuality;
    this.uniforms.shadowStrength.value = config.render.shadowStrength;
    this.uniforms.smokeColor.value.set(config.render.smokeColor);
    this.uniforms.sourceTemperature.value = params.sourceTemperature;
    this.uniforms.steps.value = resolveConfigRenderSteps(config);
    this.uniforms.turbulence.value = field.strength;
    this.uniforms.velocityDissipation.value = config.solver.velocityDissipation;
    this.uniforms.vorticity.value = field.vorticityConfinement;
    this.uniforms.vortexPosition.value.copy(localPositionToUVW(vortex.position, this.bounds, 0.08));
    this.uniforms.vortexRadius.value = clamp(
      vortex.radius / Math.max(0.001, Math.max(this.bounds.width, this.bounds.depth)),
      0.01,
      0.8,
    );
    this.uniforms.vortexStrength.value = vortex.strength;
    this.uniforms.wind.value.set(force.wind[0], force.wind[1], force.wind[2]);
    this.material.blending =
      config.render.blendMode === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.updateEmitterUniforms(config);
    this.updateObstacleUniforms(config);
  }

  private updateEmitterUniforms(config: WispySmokeRuntimeConfig): void {
    const emitters = config.emitters.slice(0, this.emitterUniforms.length);
    for (let index = 0; index < this.emitterUniforms.length; index += 1) {
      const uniformSet = this.emitterUniforms[index];
      if (!uniformSet) {
        continue;
      }
      const emitter = emitters[index] ?? config.emitters[0];
      if (!emitter) {
        uniformSet.spawnRate.value = 0;
        continue;
      }
      uniformSet.density.value = emitter.density;
      uniformSet.falloff.value = emitter.falloff;
      uniformSet.noiseScale.value = emitter.noiseScale;
      uniformSet.noiseStrength.value = emitter.noiseStrength;
      uniformSet.position.value.copy(sourceCenterForEmitter(emitter, this.bounds));
      uniformSet.radius.value = sourceRadiusForEmitter(emitter, this.bounds);
      uniformSet.scale.value.set(emitter.scale[0], emitter.scale[1], emitter.scale[2]);
      uniformSet.spawnRate.value = emitter.spawnRate * emitter.density * SOURCE_DENSITY_RATE_SCALE;
      uniformSet.temperature.value = emitter.temperature;
      uniformSet.velocity.value.set(emitter.velocity[0], emitter.velocity[1], emitter.velocity[2]);
    }
  }

  private updateObstacleUniforms(config: WispySmokeRuntimeConfig): void {
    const obstacles = config.obstacles.slice(0, this.obstacleUniforms.length);
    for (let index = 0; index < this.obstacleUniforms.length; index += 1) {
      const uniformSet = this.obstacleUniforms[index];
      if (!uniformSet) {
        continue;
      }
      const obstacle = obstacles[index];
      if (!obstacle) {
        uniformSet.radius.value = 0;
        continue;
      }
      uniformSet.position.value.copy(localPositionToUVW(obstacle.position, this.bounds, 0.5));
      uniformSet.radius.value = clamp(
        obstacle.radius / Math.max(0.001, Math.max(this.bounds.width, this.bounds.depth)),
        0.01,
        0.45,
      );
      uniformSet.scale.value.set(obstacle.scale[0], obstacle.scale[1], obstacle.scale[2]);
      uniformSet.softness.value = obstacle.softness;
    }
  }

  step(
    renderer: unknown,
    params: WispySmokeVFXParams,
    config: WispySmokeRuntimeConfig,
    deltaSeconds: number,
    elapsedSeconds: number,
  ): void {
    this.updateParams(params, config);
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

    const pressureIterations = resolvePressureIterations(config);
    const diffusionIterations =
      config.solver.diffusion > 0 ? Math.max(0, Math.round(config.solver.diffusionIterations)) : 0;
    dispatch(this.obstacleClearNode);
    for (const obstacleNode of this.obstacleNodes) {
      dispatch(obstacleNode);
    }
    dispatch(this.advectNodes[this.activeBuffer]);
    this.activeBuffer = this.activeBuffer === 0 ? 1 : 0;
    for (let index = 0; index < diffusionIterations; index += 1) {
      dispatch(this.diffusionNodes[this.activeBuffer]);
      this.activeBuffer = this.activeBuffer === 0 ? 1 : 0;
    }
    for (let index = 0; index < this.emitterUniforms.length; index += 1) {
      const sourceNode = this.sourceNodes[this.activeBuffer][index];
      if (sourceNode) {
        dispatch(sourceNode);
        this.activeBuffer = this.activeBuffer === 0 ? 1 : 0;
      }
    }
    dispatch(this.buoyancyNodes[this.activeBuffer]);
    dispatch(this.curlNodes[this.activeBuffer]);
    dispatch(this.confinementNodes[this.activeBuffer]);
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

  getStats(
    config: WispySmokeRuntimeConfig,
  ): Pick<
    WispySmokeVFXStats,
    | "diffusionIterations"
    | "gridCells"
    | "gridResolution"
    | "pressureIterations"
    | "simulationMs"
    | "solverPasses"
  > {
    return {
      diffusionIterations: config.solver.diffusionIterations,
      gridCells: this.cells,
      gridResolution: this.grid,
      pressureIterations: resolvePressureIterations(config),
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
    disposeStorageBuffer(this.curl);
    disposeStorageBuffer(this.obstacleMask);
    disposeStorageBuffer(this.pressureA);
    disposeStorageBuffer(this.pressureB);
    disposeStorageBuffer(this.divergence);
  }

  private applyBounds(params: WispySmokeVFXParams): void {
    const bounds = resolveFluidBounds(params);
    this.bounds = bounds;
    this.mesh.position.set(0, bounds.height * 0.5, 0);
    this.mesh.scale.set(bounds.width, bounds.height, bounds.depth);
    this.uniforms.gridScale.value.copy(gridScaleForBounds(this.grid, bounds));
  }

  private createClearNode(): object {
    return Fn(() => {
      this.densityA.element(instanceIndex).assign(vec4(0));
      this.densityB.element(instanceIndex).assign(vec4(0));
      this.velocityA.element(instanceIndex).assign(vec4(0));
      this.velocityB.element(instanceIndex).assign(vec4(0));
      this.curl.element(instanceIndex).assign(vec4(0));
      this.obstacleMask.element(instanceIndex).assign(0);
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

  private createObstacleClearNode(): object {
    return Fn(() => {
      this.obstacleMask.element(instanceIndex).assign(0);
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Obstacle Clear") as object;
  }

  private createObstacleNode(obstacleIndex: number): object {
    return Fn(() => {
      const obstacle = this.obstacleUniforms[obstacleIndex]!;
      const coord = this.cellCoord();
      const uvw = this.cellUVW(coord);
      const delta = uvw.sub(obstacle.position).div(obstacle.scale.max(vec3(0.001)));
      const dist =
        obstacle.shape === "sphere"
          ? dot(delta, delta).sqrt()
          : delta.abs().x.max(delta.abs().y).max(delta.abs().z);
      const mask = nodeSmoothstep(
        obstacle.radius,
        obstacle.radius.add(obstacle.softness),
        dist,
      ).oneMinus();
      this.obstacleMask
        .element(instanceIndex)
        .assign(this.obstacleMask.element(instanceIndex).max(mask).clamp(0, 1));
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Obstacle Mask") as object;
  }

  private createSourceNode(
    emitterIndex: number,
    readDensity: Vec4StorageBuffer,
    readVelocity: Vec4StorageBuffer,
    writeDensity: Vec4StorageBuffer,
    writeVelocity: Vec4StorageBuffer,
  ): object {
    return Fn(() => {
      const emitter = this.emitterUniforms[emitterIndex]!;
      const coord = this.cellCoord();
      const uvw = this.cellUVW(coord);
      const openMask = this.obstacleMask.element(instanceIndex).oneMinus().clamp(0, 1);
      const sourceDelta = uvw.sub(emitter.position).div(emitter.scale.max(vec3(0.001)));
      const dist =
        emitter.shape === "sphere"
          ? dot(sourceDelta, sourceDelta).sqrt()
          : sourceDelta.abs().x.max(sourceDelta.abs().y).max(sourceDelta.abs().z);
      const edge0 = emitter.radius.mul(float(1).sub(emitter.falloff.mul(0.82)).clamp(0.015, 0.92));
      const sourceMask = nodeSmoothstep(edge0, emitter.radius, dist).oneMinus();
      const coreMask = nodeSmoothstep(
        emitter.radius.mul(0.08),
        emitter.radius.mul(0.48),
        dist,
      ).oneMinus();
      const noiseCoord = uvw
        .mul(emitter.noiseScale)
        .add(
          vec3(
            this.uniforms.time.mul(0.41),
            this.uniforms.time.mul(-0.29),
            this.uniforms.time.mul(0.23),
          ),
        );
      const sourceNoise = valueNoise3D(noiseCoord)
        .sub(0.5)
        .mul(emitter.noiseStrength)
        .add(1)
        .clamp(0.18, 1.75);
      const sourcePulse = valueNoise3D(
        noiseCoord.mul(0.38).add(vec3(0, this.uniforms.time.mul(0.35), 23.7)),
      )
        .mul(0.38)
        .add(0.72)
        .clamp(0.52, 1.12);
      const shellBias = mix(
        float(0.28),
        float(1.22),
        nodeSmoothstep(emitter.radius.mul(0.16), emitter.radius.mul(0.86), dist),
      );
      const lateralA = valueNoise3D(noiseCoord.add(vec3(11.7, 3.1, 19.4))).sub(0.5).mul(2);
      const lateralB = valueNoise3D(noiseCoord.add(vec3(29.3, 17.9, 5.2))).sub(0.5).mul(2);
      const verticalNoise = valueNoise3D(noiseCoord.add(vec3(7.2, 23.4, 31.1))).sub(0.5);
      const sourceBreakupVelocity = vec3(lateralA, verticalNoise.mul(0.18), lateralB).mul(
        emitter.noiseStrength.mul(this.uniforms.turbulence).mul(0.76),
      );
      const sourceRadial = vec3(sourceDelta.x, 0, sourceDelta.z);
      const sourceRadialDistance = dot(sourceRadial, sourceRadial).sqrt();
      const sourceTangent = vec3(sourceRadial.z.negate(), 0, sourceRadial.x).div(
        sourceRadialDistance.max(0.001),
      );
      const sourceRingMask = nodeSmoothstep(
        emitter.radius.mul(0.18),
        emitter.radius.mul(0.72),
        sourceRadialDistance,
      )
        .mul(
          nodeSmoothstep(
            emitter.radius.mul(0.72),
            emitter.radius.mul(1.18),
            sourceRadialDistance,
          ).oneMinus(),
        )
        .mul(nodeSmoothstep(emitter.radius.mul(0.08), emitter.radius.mul(0.78), sourceDelta.y.abs()).oneMinus());
      const sourceRingPhase = valueNoise3D(noiseCoord.mul(0.73).add(vec3(3.7, 17.1, 29.4)))
        .sub(0.5)
        .mul(2);
      const sourceRadialDir = sourceRadial.div(sourceRadialDistance.max(0.001));
      const sourceOutflowVelocity = sourceRadialDir
        .mul(sourceRingMask.max(sourceMask.mul(0.35)))
        .mul(sourceNoise)
        .mul(this.uniforms.turbulence)
        .mul(0.36);
      const sourceCurlVelocity = sourceTangent
        .mul(sourceRingMask)
        .mul(sourceRingPhase)
        .mul(this.uniforms.curlStrength)
        .mul(this.uniforms.turbulence)
        .mul(0.12);
      const sourceCurlNoise = curlNoiseField3D(
        uvw.mul(this.uniforms.detailScale.mul(0.52)).add(
          vec3(
            this.uniforms.time.mul(0.18),
            this.uniforms.time.mul(-0.27),
            this.uniforms.time.mul(0.14),
          ),
        ),
      )
        .mul(sourceMask.max(coreMask.mul(0.7)))
        .mul(this.uniforms.curlStrength)
        .mul(this.uniforms.turbulence)
        .mul(0.2);
      const sourceBaseVelocity = emitter.velocity.add(vec3(0, this.uniforms.riseSpeed.mul(0.14), 0));
      const sourceSpeed = dot(sourceBaseVelocity, sourceBaseVelocity).sqrt();
      const flowDir = sourceBaseVelocity.div(sourceSpeed.max(0.001));
      const flowDelta = uvw.sub(emitter.position);
      const axialDistance = dot(flowDelta, flowDir).max(0);
      const radialDelta = flowDelta.sub(flowDir.mul(axialDistance));
      const radialDistance = dot(radialDelta, radialDelta).sqrt();
      const wakeLength = emitter.radius.mul(
        emitter.falloff.mul(1.6).add(sourceSpeed.mul(0.28)).add(1.15),
      );
      const wakeRadialMask = nodeSmoothstep(
        emitter.radius.mul(0.34),
        emitter.radius.mul(1.12),
        radialDistance,
      ).oneMinus();
      const wakeAxialMask = nodeSmoothstep(0, emitter.radius.mul(0.18), axialDistance).mul(
        nodeSmoothstep(wakeLength.mul(0.3), wakeLength, axialDistance).oneMinus(),
      );
      const wakeNoise = valueNoise3D(noiseCoord.mul(0.62).add(vec3(41.3, 7.4, 19.2)))
        .sub(0.5)
        .mul(emitter.noiseStrength.mul(0.7))
        .add(1)
        .clamp(0.35, 1.45);
      const wakeMask = wakeRadialMask.mul(wakeAxialMask).mul(wakeNoise).mul(0.08);
      const shellMask = sourceMask.mul(sourceNoise).mul(sourcePulse).mul(shellBias);
      const mask = shellMask.max(coreMask.mul(0.18)).max(wakeMask).mul(openMask);
      const densityDelta = emitter.spawnRate.mul(this.uniforms.dt).mul(mask);
      const currentDensity = readDensity.element(instanceIndex);
      const currentVelocity = readVelocity.element(instanceIndex);
      const sourceRefresh = mask.clamp(0, 1);
      const nextAge = currentDensity.z.mul(sourceRefresh.oneMinus()).clamp(0, 1);
      const nextTemperature = currentDensity.y
        .add(emitter.temperature.mul(mask).mul(this.uniforms.dt).mul(2.2))
        .max(emitter.temperature.mul(mask).mul(0.38));
      const sourceVelocity = sourceBaseVelocity
        .add(sourceBreakupVelocity)
        .add(sourceOutflowVelocity)
        .add(sourceCurlVelocity)
        .add(sourceCurlNoise);
      const velocityDelta = sourceVelocity
        .sub(currentVelocity.xyz.mul(0.44))
        .mul(mask)
        .mul(this.uniforms.dt)
        .mul(SOURCE_VELOCITY_INJECTION_SCALE);
      writeDensity
        .element(instanceIndex)
        .assign(
          vec4(
            currentDensity.x.add(densityDelta).mul(openMask).clamp(0, 2.5),
            nextTemperature.mul(openMask).clamp(0, 2),
            nextAge.mul(openMask),
            1,
          ),
        );
      writeVelocity
        .element(instanceIndex)
        .assign(vec4(currentVelocity.xyz.add(velocityDelta).mul(openMask), 0));
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
        .sub(velocity.xyz.mul(this.uniforms.dt).mul(this.uniforms.gridScale))
        .clamp(vec3(0), vec3(this.grid[0] - 1, this.grid[1] - 1, this.grid[2] - 1));
      const advectedDensity =
        this.config.solver.advectionMode === "nearest"
          ? readDensity.element(
              this.linearIndex(int(backCoord.x), int(backCoord.y), int(backCoord.z)),
            )
          : this.sampleVec4(readDensity, backCoord);
      const advectedVelocity =
        this.config.solver.advectionMode === "nearest"
          ? readVelocity.element(
              this.linearIndex(int(backCoord.x), int(backCoord.y), int(backCoord.z)),
            )
          : this.sampleVec4(readVelocity, backCoord);
      const correctedDensity = advectedDensity.toVar();
      const correctedVelocity = advectedVelocity.toVar();
      if (this.config.solver.advectionMode === "maccormack") {
        const forwardCoord = backCoord
          .add(advectedVelocity.xyz.mul(this.uniforms.dt).mul(this.uniforms.gridScale))
          .clamp(vec3(0), vec3(this.grid[0] - 1, this.grid[1] - 1, this.grid[2] - 1));
        const reverseDensity = this.sampleVec4(readDensity, forwardCoord);
        const reverseVelocity = this.sampleVec4(readVelocity, forwardCoord);
        correctedDensity.assign(
          advectedDensity.add(readDensity.element(instanceIndex).sub(reverseDensity).mul(0.5)),
        );
        correctedVelocity.assign(
          advectedVelocity.add(readVelocity.element(instanceIndex).sub(reverseVelocity).mul(0.5)),
        );
      }
      const openMask = this.obstacleMask.element(instanceIndex).oneMinus().clamp(0, 1);
      const uvw = this.cellUVW(coord);
      const topOutflowFade = nodeSmoothstep(0.88, 0.998, uvw.y).oneMinus().clamp(0, 1);
      const sideEdge = uvw.x
        .min(uvw.z)
        .min(uvw.x.oneMinus())
        .min(uvw.z.oneMinus());
      const sideOutflowFade = nodeSmoothstep(0.018, 0.09, sideEdge).clamp(0, 1);
      const outflowFade = topOutflowFade.mul(sideOutflowFade);
      const densityValue = correctedDensity.x
        .mul(float(1).sub(this.uniforms.densityDissipation.mul(this.uniforms.dt)).clamp(0, 1))
        .mul(outflowFade);
      const temperatureCooling = this.uniforms.densityDissipation
        .mul(1.35)
        .add(0.07)
        .mul(this.uniforms.dt);
      const temperature = correctedDensity.y
        .mul(float(1).sub(temperatureCooling).clamp(0, 1))
        .mul(outflowFade);
      const age = correctedDensity.z
        .add(this.uniforms.dt.mul(this.uniforms.residenceRate))
        .mul(outflowFade)
        .clamp(0, 1);
      writeDensity
        .element(instanceIndex)
        .assign(
          vec4(
            densityValue.mul(openMask).clamp(0, 2.5),
            temperature.mul(openMask).clamp(0, 2),
            age.mul(openMask),
            1,
          ),
        );
      writeVelocity
        .element(instanceIndex)
        .assign(
          vec4(
            correctedVelocity.xyz
              .mul(
                float(1).sub(this.uniforms.velocityDissipation.mul(this.uniforms.dt)).clamp(0, 1),
              )
              .mul(outflowFade)
              .mul(openMask),
            0,
          ),
        );
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Advect") as object;
  }

  private createDiffusionNode(
    readDensity: Vec4StorageBuffer,
    readVelocity: Vec4StorageBuffer,
    writeDensity: Vec4StorageBuffer,
    writeVelocity: Vec4StorageBuffer,
  ): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const current = readDensity.element(instanceIndex);
      const neighborAverage = this.neighborDensityAverage(readDensity, coord);
      const amount = this.uniforms.diffusion.mul(this.uniforms.dt).clamp(0, 0.35);
      const openMask = this.obstacleMask.element(instanceIndex).oneMinus().clamp(0, 1);
      writeDensity
        .element(instanceIndex)
        .assign(
          vec4(
            current.x.mix(neighborAverage, amount).mul(openMask).clamp(0, 2.5),
            current.y.mix(neighborAverage, amount.mul(0.35)).mul(openMask).clamp(0, 2),
            current.z.mul(openMask).clamp(0, 1),
            1,
          ),
        );
      writeVelocity.element(instanceIndex).assign(readVelocity.element(instanceIndex));
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Diffusion") as object;
  }

  private createBuoyancyNode(density: Vec4StorageBuffer, velocity: Vec4StorageBuffer): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const uvw = this.cellUVW(coord);
      const densitySample = density.element(instanceIndex);
      const currentVelocity = velocity.element(instanceIndex);
      const activeMask = densitySample.x.mul(0.45).add(densitySample.y.mul(0.65)).clamp(0, 1.35);
      const lift = densitySample.y
        .mul(this.uniforms.riseSpeed)
        .mul(this.uniforms.buoyancy)
        .mul(float(0.42).add(activeMask.mul(0.74)));
      const windForce = this.uniforms.wind.mul(float(0.12).add(activeMask.mul(0.58)));
      const vortexDelta = uvw.sub(this.uniforms.vortexPosition);
      const vortexDistance = vortexDelta.x
        .mul(vortexDelta.x)
        .add(vortexDelta.z.mul(vortexDelta.z))
        .sqrt();
      const tangent = vec3(vortexDelta.z.negate(), 0, vortexDelta.x).div(
        vortexDistance.max(0.001),
      );
      const vortexRadialMask = nodeSmoothstep(
        this.uniforms.vortexRadius.mul(0.18),
        this.uniforms.vortexRadius,
        vortexDistance,
      ).oneMinus();
      const vortexVerticalMask = nodeSmoothstep(
        this.uniforms.vortexRadius.mul(0.12),
        this.uniforms.vortexRadius.mul(1.2),
        vortexDelta.y.abs(),
      ).oneMinus();
      const vortexForce = tangent
        .mul(this.uniforms.vortexStrength)
        .mul(vortexRadialMask)
        .mul(vortexVerticalMask)
        .mul(activeMask.add(0.18));
      const shearPhase = uvw
        .mul(this.uniforms.detailScale.mul(0.22))
        .add(
          vec3(
            this.uniforms.time.mul(0.43),
            this.uniforms.time.mul(-0.31),
            this.uniforms.time.mul(0.37),
          ),
        );
      const shearForce = vec3(
        shearPhase.y.mul(4.7).add(shearPhase.z.mul(2.9)).sin(),
        shearPhase.x.mul(3.1).add(shearPhase.z.mul(2.4)).cos().mul(0.18),
        shearPhase.x.mul(4.3).sub(shearPhase.y.mul(3.7)).cos(),
      )
        .mul(this.uniforms.turbulence)
        .mul(this.uniforms.curlStrength)
        .mul(activeMask)
        .mul(0.16);
      const detailForce = vec3(
        valueNoise3D(shearPhase.mul(1.7).add(vec3(13.4, 2.1, 29.7))).sub(0.5),
        valueNoise3D(shearPhase.mul(1.35).add(vec3(5.8, 37.2, 11.6))).sub(0.5).mul(0.28),
        valueNoise3D(shearPhase.mul(1.9).add(vec3(41.3, 17.5, 3.4))).sub(0.5),
      )
        .mul(this.uniforms.turbulence)
        .mul(activeMask)
        .mul(0.2);
      const curlNoiseForce = curlNoiseField3D(
        uvw.mul(this.uniforms.detailScale.mul(0.42)).add(
          vec3(
            this.uniforms.time.mul(0.16),
            this.uniforms.time.mul(-0.24),
            this.uniforms.time.mul(0.12),
          ),
        ),
      )
        .mul(this.uniforms.turbulence)
        .mul(this.uniforms.curlStrength)
        .mul(activeMask)
        .mul(0.42);
      const rollForce = curlNoiseField3D(
        uvw.mul(this.uniforms.detailScale.mul(0.16)).add(
          vec3(
            this.uniforms.time.mul(0.08),
            this.uniforms.time.mul(-0.11),
            this.uniforms.time.mul(0.09),
          ),
        ),
      )
        .mul(vec3(1.05, 0.22, 1.05))
        .mul(this.uniforms.turbulence)
        .mul(this.uniforms.curlStrength)
        .mul(activeMask)
        .mul(0.58);
      const sourceRadial = vec3(uvw.x.sub(0.5), 0, uvw.z.sub(0.5));
      const sourceRadialDistance = dot(sourceRadial, sourceRadial).sqrt();
      const sourceRadialDir = sourceRadial.div(sourceRadialDistance.max(0.001));
      const expansionHeight = nodeSmoothstep(0.08, 0.28, uvw.y)
        .mul(nodeSmoothstep(0.38, 0.72, uvw.y).oneMinus())
        .clamp(0, 1);
      const expansionNoise = valueNoise3D(
        uvw.mul(this.uniforms.detailScale.mul(0.19)).add(
          vec3(
            this.uniforms.time.mul(0.1),
            this.uniforms.time.mul(-0.07),
            this.uniforms.time.mul(0.13),
          ),
        ),
      )
        .sub(0.5)
        .mul(0.7)
        .add(1);
      const expansionForce = sourceRadialDir
        .mul(expansionHeight)
        .mul(expansionNoise)
        .mul(activeMask)
        .mul(this.uniforms.turbulence)
        .mul(0.34);
      const nextVelocity = currentVelocity.xyz.add(
        vec3(windForce.x, lift.add(windForce.y), windForce.z)
          .add(vortexForce)
          .add(shearForce)
          .add(detailForce)
          .add(curlNoiseForce)
          .add(rollForce)
          .add(expansionForce)
          .mul(this.uniforms.dt),
      );
      velocity.element(instanceIndex).assign(vec4(nextVelocity, 0));
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Buoyancy") as object;
  }

  private createCurlNode(readVelocity: Vec4StorageBuffer): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const left = readVelocity.element(this.linearIndex(coord.x.sub(1), coord.y, coord.z)).xyz;
      const right = readVelocity.element(this.linearIndex(coord.x.add(1), coord.y, coord.z)).xyz;
      const down = readVelocity.element(this.linearIndex(coord.x, coord.y.sub(1), coord.z)).xyz;
      const up = readVelocity.element(this.linearIndex(coord.x, coord.y.add(1), coord.z)).xyz;
      const back = readVelocity.element(this.linearIndex(coord.x, coord.y, coord.z.sub(1))).xyz;
      const front = readVelocity.element(this.linearIndex(coord.x, coord.y, coord.z.add(1))).xyz;
      const curl = vec3(
        up.z
          .sub(down.z)
          .mul(this.uniforms.gridScale.y)
          .sub(front.y.sub(back.y).mul(this.uniforms.gridScale.z)),
        front.x
          .sub(back.x)
          .mul(this.uniforms.gridScale.z)
          .sub(right.z.sub(left.z).mul(this.uniforms.gridScale.x)),
        right.y
          .sub(left.y)
          .mul(this.uniforms.gridScale.x)
          .sub(up.x.sub(down.x).mul(this.uniforms.gridScale.y)),
      ).mul(0.5);
      this.curl.element(instanceIndex).assign(vec4(curl, dot(curl, curl).sqrt()));
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Curl") as object;
  }

  private createConfinementNode(
    readDensity: Vec4StorageBuffer,
    readVelocity: Vec4StorageBuffer,
    writeVelocity: Vec4StorageBuffer,
  ): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const densitySample = readDensity.element(instanceIndex);
      const center = readVelocity.element(instanceIndex).xyz;
      const left = this.curl.element(this.linearIndex(coord.x.sub(1), coord.y, coord.z)).w;
      const right = this.curl.element(this.linearIndex(coord.x.add(1), coord.y, coord.z)).w;
      const down = this.curl.element(this.linearIndex(coord.x, coord.y.sub(1), coord.z)).w;
      const up = this.curl.element(this.linearIndex(coord.x, coord.y.add(1), coord.z)).w;
      const back = this.curl.element(this.linearIndex(coord.x, coord.y, coord.z.sub(1))).w;
      const front = this.curl.element(this.linearIndex(coord.x, coord.y, coord.z.add(1))).w;
      const curl = this.curl.element(instanceIndex).xyz;
      const gradRaw = vec3(
        right.sub(left).mul(this.uniforms.gridScale.x),
        up.sub(down).mul(this.uniforms.gridScale.y),
        front.sub(back).mul(this.uniforms.gridScale.z),
      ).mul(0.5);
      const grad = gradRaw.div(dot(gradRaw, gradRaw).sqrt().max(0.0001));
      const uvw = this.cellUVW(coord);
      const activeMask = densitySample.x.mul(0.5).add(densitySample.y.mul(0.75)).clamp(0, 1.25);
      const phase = uvw.mul(this.uniforms.detailScale).add(vec3(this.uniforms.time.mul(0.19)));
      const turbulenceForce = vec3(
        phase.y.mul(9.1).add(phase.z.mul(4.7)).sin(),
        phase.x.mul(5.3).add(phase.z.mul(3.9)).cos().mul(0.25),
        phase.x.mul(7.7).sub(phase.y.mul(6.2)).cos(),
      )
        .mul(this.uniforms.turbulence)
        .mul(activeMask);
      const confinementCellSize = float(1).div(
        this.uniforms.gridScale.x
          .max(this.uniforms.gridScale.y)
          .max(this.uniforms.gridScale.z)
          .max(0.001),
      );
      const confinement = grad
        .cross(curl)
        .mul(confinementCellSize)
        .mul(this.uniforms.vorticity)
        .mul(activeMask);
      const openMask = this.obstacleMask.element(instanceIndex).oneMinus().clamp(0, 1);
      const nextVelocity = center
        .add(
          confinement
            .mul(0.6)
            .add(turbulenceForce.mul(this.uniforms.curlStrength).mul(0.45))
            .mul(this.uniforms.dt),
        )
        .mul(openMask);
      writeVelocity.element(instanceIndex).assign(vec4(nextVelocity, 0));
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Vorticity Confinement") as object;
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
      this.divergence
        .element(instanceIndex)
        .assign(
          right
            .sub(left)
            .mul(this.uniforms.gridScale.x)
            .add(up.sub(down).mul(this.uniforms.gridScale.y))
            .add(front.sub(back).mul(this.uniforms.gridScale.z))
            .mul(0.5),
        );
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Divergence") as object;
  }

  private createJacobiNode(
    readPressure: FloatStorageBuffer,
    writePressure: FloatStorageBuffer,
  ): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const left = readPressure.element(this.linearIndex(coord.x.sub(1), coord.y, coord.z));
      const right = readPressure.element(this.linearIndex(coord.x.add(1), coord.y, coord.z));
      const down = readPressure.element(this.linearIndex(coord.x, coord.y.sub(1), coord.z));
      const up = readPressure.element(this.linearIndex(coord.x, coord.y.add(1), coord.z));
      const back = readPressure.element(this.linearIndex(coord.x, coord.y, coord.z.sub(1)));
      const front = readPressure.element(this.linearIndex(coord.x, coord.y, coord.z.add(1)));
      const scaleX2 = this.uniforms.gridScale.x.mul(this.uniforms.gridScale.x);
      const scaleY2 = this.uniforms.gridScale.y.mul(this.uniforms.gridScale.y);
      const scaleZ2 = this.uniforms.gridScale.z.mul(this.uniforms.gridScale.z);
      const pressure = left
        .add(right)
        .mul(scaleX2)
        .add(down.add(up).mul(scaleY2))
        .add(back.add(front).mul(scaleZ2))
        .sub(this.divergence.element(instanceIndex))
        .div(scaleX2.add(scaleY2).add(scaleZ2).mul(2).max(0.0001));
      writePressure.element(instanceIndex).assign(pressure);
    })()
      .compute(this.cells, [64])
      .setName("ThreeFX Fluid Pressure Jacobi") as object;
  }

  private createProjectionNode(
    readVelocity: Vec4StorageBuffer,
    writeVelocity: Vec4StorageBuffer,
    pressure: FloatStorageBuffer,
  ): object {
    return Fn(() => {
      const coord = this.cellCoord();
      const left = pressure.element(this.linearIndex(coord.x.sub(1), coord.y, coord.z));
      const right = pressure.element(this.linearIndex(coord.x.add(1), coord.y, coord.z));
      const down = pressure.element(this.linearIndex(coord.x, coord.y.sub(1), coord.z));
      const up = pressure.element(this.linearIndex(coord.x, coord.y.add(1), coord.z));
      const back = pressure.element(this.linearIndex(coord.x, coord.y, coord.z.sub(1)));
      const front = pressure.element(this.linearIndex(coord.x, coord.y, coord.z.add(1)));
      const gradient = vec3(
        right.sub(left).mul(this.uniforms.gridScale.x),
        up.sub(down).mul(this.uniforms.gridScale.y),
        front.sub(back).mul(this.uniforms.gridScale.z),
      ).mul(0.5);
      const openMask = this.obstacleMask.element(instanceIndex).oneMinus().clamp(0, 1);
      const projected = readVelocity.element(instanceIndex).xyz.sub(gradient).mul(openMask);
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
      textureStore(
        this.renderTexture,
        this.cellTextureCoord(),
        vec4(
          densitySample.x.clamp(0, 2.5),
          densitySample.y.clamp(0, 2),
          speed.clamp(0, 8).div(8),
          densitySample.z.clamp(0, 1),
        ),
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
    return uint(
      clampedX.add(clampedY.mul(this.grid[0])).add(clampedZ.mul(this.grid[0] * this.grid[1])),
    );
  }

  private sampleVec4(buffer: Vec4StorageBuffer, coord: Node<"vec3">): Node<"vec4"> {
    const base = floor(coord);
    const frac = coord.sub(base).clamp(vec3(0), vec3(1));
    const x0 = int(base.x);
    const y0 = int(base.y);
    const z0 = int(base.z);
    const x1 = x0.add(1);
    const y1 = y0.add(1);
    const z1 = z0.add(1);
    const c000 = buffer.element(this.linearIndex(x0, y0, z0));
    const c100 = buffer.element(this.linearIndex(x1, y0, z0));
    const c010 = buffer.element(this.linearIndex(x0, y1, z0));
    const c110 = buffer.element(this.linearIndex(x1, y1, z0));
    const c001 = buffer.element(this.linearIndex(x0, y0, z1));
    const c101 = buffer.element(this.linearIndex(x1, y0, z1));
    const c011 = buffer.element(this.linearIndex(x0, y1, z1));
    const c111 = buffer.element(this.linearIndex(x1, y1, z1));
    const x00 = mix(c000, c100, frac.x);
    const x10 = mix(c010, c110, frac.x);
    const x01 = mix(c001, c101, frac.x);
    const x11 = mix(c011, c111, frac.x);
    const y0Mix = mix(x00, x10, frac.y);
    const y1Mix = mix(x01, x11, frac.y);
    return mix(y0Mix, y1Mix, frac.z);
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

function gridScaleForBounds(
  grid: readonly [number, number, number],
  bounds: VolumeBounds,
): THREE.Vector3 {
  return new THREE.Vector3(
    (grid[0] - 1) / Math.max(0.001, bounds.width),
    (grid[1] - 1) / Math.max(0.001, bounds.height),
    (grid[2] - 1) / Math.max(0.001, bounds.depth),
  );
}

function sourceCenterForEmitter(
  emitter: WispySmokeEmitterConfig,
  bounds: VolumeBounds,
): THREE.Vector3 {
  return localPositionToUVW(emitter.position, bounds, 0.08);
}

function localPositionToUVW(
  position: readonly [number, number, number],
  bounds: VolumeBounds,
  yBias: number,
): THREE.Vector3 {
  return new THREE.Vector3(
    0.5 + position[0] / Math.max(0.001, bounds.width),
    clamp(yBias + position[1] / Math.max(0.001, bounds.height), 0.02, 0.98),
    0.5 + position[2] / Math.max(0.001, bounds.depth),
  );
}

function sourceRadiusForEmitter(emitter: WispySmokeEmitterConfig, bounds: VolumeBounds): number {
  return clamp(emitter.radius / Math.max(0.001, Math.max(bounds.width, bounds.depth)), 0.018, 0.42);
}

function createEmitterUniforms(
  config: WispySmokeRuntimeConfig,
  bounds: VolumeBounds,
): readonly FluidEmitterUniforms[] {
  return config.emitters.slice(0, 4).map((emitter) => ({
    density: uniform(emitter.density),
    falloff: uniform(emitter.falloff),
    noiseScale: uniform(emitter.noiseScale),
    noiseStrength: uniform(emitter.noiseStrength),
    position: uniform(sourceCenterForEmitter(emitter, bounds)),
    radius: uniform(sourceRadiusForEmitter(emitter, bounds)),
    scale: uniform(vectorFromTuple(emitter.scale)),
    shape: emitter.shape,
    spawnRate: uniform(emitter.spawnRate * emitter.density * SOURCE_DENSITY_RATE_SCALE),
    temperature: uniform(emitter.temperature),
    velocity: uniform(vectorFromTuple(emitter.velocity)),
  }));
}

function createObstacleUniforms(
  config: WispySmokeRuntimeConfig,
  bounds: VolumeBounds,
): readonly FluidObstacleUniforms[] {
  return config.obstacles.slice(0, 4).map((obstacle) => ({
    position: uniform(localPositionToUVW(obstacle.position, bounds, 0.5)),
    radius: uniform(
      clamp(obstacle.radius / Math.max(0.001, Math.max(bounds.width, bounds.depth)), 0.01, 0.45),
    ),
    scale: uniform(vectorFromTuple(obstacle.scale)),
    shape: obstacle.shape,
    softness: uniform(obstacle.softness),
  }));
}

function createFluidUniforms(
  params: WispySmokeVFXParams,
  config: WispySmokeRuntimeConfig,
): FluidUniforms {
  const bounds = resolveFluidBounds(params);
  const field = primaryField(config);
  const force = primaryForce(config);
  const vortex = primaryVortexForce(config);
  const profile = resolveQualityProfile(resolveEffectiveConfigGridResolution(config));
  return {
    absorption: uniform(config.render.absorption),
    baseDensity: uniform(config.render.baseDensity),
    buoyancy: uniform(force.buoyantLift),
    curlStrength: uniform(field.curlStrength),
    densityDissipation: uniform(config.solver.densityDissipation),
    debugView: uniform(debugViewIndex(config.debug.view)),
    detailOctaves: uniform(config.render.detailOctaves),
    detailScale: uniform(config.render.detailScale),
    detailSpeed: uniform(config.render.detailSpeed),
    detailStrength: uniform(config.render.detailStrength),
    diffusion: uniform(config.solver.diffusion),
    dt: uniform(0),
    emissionColor: uniform(new THREE.Color(params.emissionColor)),
    emissionIntensity: uniform(params.emissionIntensity),
    gridScale: uniform(gridScaleForBounds(profile.volumeGrid, bounds)),
    opacity: uniform(config.render.opacity),
    plumeTaper: uniform(config.render.plumeTaper),
    radius: uniform(resolveSourceRadius(params, bounds)),
    residenceRate: uniform(1 / Math.max(0.25, params.lifetime)),
    riseSpeed: uniform(force.riseSpeed),
    scattering: uniform(config.render.scattering),
    shadowSamples: uniform(config.render.shadowQuality),
    shadowStrength: uniform(config.render.shadowStrength),
    smokeColor: uniform(new THREE.Color(config.render.smokeColor)),
    sourceTemperature: uniform(params.sourceTemperature),
    steps: uniform(resolveConfigRenderSteps(config)),
    time: uniform(0),
    turbulence: uniform(field.strength),
    velocityDissipation: uniform(config.solver.velocityDissipation),
    vorticity: uniform(field.vorticityConfinement),
    vortexPosition: uniform(localPositionToUVW(vortex.position, bounds, 0.08)),
    vortexRadius: uniform(
      clamp(vortex.radius / Math.max(0.001, Math.max(bounds.width, bounds.depth)), 0.01, 0.8),
    ),
    vortexStrength: uniform(vortex.strength),
    wind: uniform(vectorFromTuple(force.wind)),
  };
}

function resolveSourceRadius(params: WispySmokeVFXParams, bounds: VolumeBounds): number {
  return clamp(params.radius / Math.max(0.001, Math.max(bounds.width, bounds.depth)), 0.025, 0.28);
}

function resolvePressureIterations(config: WispySmokeRuntimeConfig): number {
  return Math.max(2, Math.round(config.solver.pressureIterations));
}

export class WispySmokeVFX implements VFXEffect<WispySmokeVFXParams> {
  readonly object3D = new THREE.Group();

  private params: WispySmokeVFXParams;
  private config: WispySmokeRuntimeConfig;
  private configOverride: Partial<WispySmokeRuntimeConfig> | undefined;
  private readonly disposables = new DisposableGroup();
  private readonly particles: SmokeParticle[] = [];
  private readonly renderer: unknown;
  private readonly random: () => number;
  private readonly sourceGlowGroup = new THREE.Group();
  private readonly sourceGlowMeshes: THREE.Mesh[] = [];
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
  private resourceSignature = "";
  private sourceGlowSignature = "";

  constructor(options: WispySmokeVFXOptions = {}) {
    const { config, position, renderer, ...params } = options;
    this.renderer = renderer;
    this.configOverride = config;
    const initialParams =
      params.worldPosition || !position ? params : { ...params, worldPosition: position };
    this.params = normalizeWispySmokeParams(initialParams);
    this.config = normalizeWispySmokeRuntimeConfig(this.params, config);
    this.backend = this.resolveBackend();
    this.resourceSignature = this.computeResourceSignature();
    this.random = mulberry32(this.params.seed);
    this.geometry = this.disposables.add(new THREE.BufferGeometry());
    this.material = this.disposables.add(
      new THREE.ShaderMaterial({
        vertexShader: COMPAT_VERTEX_SHADER,
        fragmentShader: COMPAT_FRAGMENT_SHADER,
        uniforms: {
          uColor: { value: new THREE.Color(this.config.render.smokeColor) },
          uEmissionColor: { value: new THREE.Color(this.params.emissionColor) },
          uEmissionIntensity: { value: this.params.emissionIntensity },
          uOpacity: { value: this.config.render.opacity },
          uSoftness: { value: this.config.render.softness },
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
    this.sourceGlowGroup.name = "WispySmokeVFXSourceGlow";
    this.object3D.name = "WispySmokeVFX";
    this.object3D.add(this.points);
    this.object3D.add(this.sourceGlowGroup);
    this.applyTransform();
    this.syncSourceGlow();
    this.reallocateCompatibilityParticles();
    this.applyBackendResources();
  }

  update(deltaSeconds: number, elapsedSeconds = performance.now() / 1000): void {
    const dt = clamp(deltaSeconds, 0, 1 / 15);
    (this.material.uniforms.uTime as IUniform<number>).value = elapsedSeconds;
    if (this.backend === "webgpu") {
      this.ensureFluid();
      this.fluid?.step(this.renderer, this.params, this.config, dt, elapsedSeconds);
      this.geometry.setDrawRange(0, 0);
      return;
    }

    this.spawnParticles(dt);
    this.integrateParticles(dt);
    this.writeCompatGeometry();
  }

  private applyState(
    params: WispySmokeVFXParams,
    config: Partial<WispySmokeRuntimeConfig> | undefined,
  ): void {
    const previousBackend = this.backend;
    const previousSignature = this.resourceSignature;
    this.params = params;
    this.configOverride = config;
    this.config = normalizeWispySmokeRuntimeConfig(this.params, config);
    this.backend = this.resolveBackend();
    const nextSignature = this.computeResourceSignature();

    (this.material.uniforms.uColor as IUniform<THREE.Color>).value.set(
      this.config.render.smokeColor,
    );
    (this.material.uniforms.uEmissionColor as IUniform<THREE.Color>).value.set(
      this.params.emissionColor,
    );
    (this.material.uniforms.uEmissionIntensity as IUniform<number>).value =
      this.params.emissionIntensity;
    (this.material.uniforms.uOpacity as IUniform<number>).value = this.config.render.opacity;
    (this.material.uniforms.uSoftness as IUniform<number>).value = this.config.render.softness;
    this.applyTransform();
    this.syncSourceGlow();

    if (previousSignature !== nextSignature || previousBackend !== this.backend) {
      this.disposeFluid();
      this.reallocateCompatibilityParticles();
    }
    this.resourceSignature = nextSignature;
    this.applyBackendResources();
    this.fluid?.updateParams(this.params, this.config);
  }

  setParams(params: Partial<WispySmokeVFXParams>): void {
    this.applyState(normalizeWispySmokeParams({ ...this.params, ...params }), this.configOverride);
  }

  setRuntimeConfig(config: Partial<WispySmokeRuntimeConfig>): void {
    this.applyState(this.params, config);
  }

  setParamsAndRuntimeConfig(
    params: Partial<WispySmokeVFXParams>,
    config: Partial<WispySmokeRuntimeConfig>,
  ): void {
    this.applyState(normalizeWispySmokeParams({ ...this.params, ...params }), config);
  }

  getParams(): Readonly<WispySmokeVFXParams> {
    return this.params;
  }

  getStats(): WispySmokeVFXStats {
    const fluidStats = this.fluid?.getStats(this.config);
    const gridProfile = resolveQualityProfile(resolveEffectiveConfigGridResolution(this.config));
    const grid = fluidStats?.gridResolution ?? gridProfile.volumeGrid;
    return {
      activeDebugView: this.config.debug.view,
      advectionMode: this.config.solver.advectionMode,
      backend: this.backend,
      diffusionIterations:
        fluidStats?.diffusionIterations ?? this.config.solver.diffusionIterations,
      emitterCount: this.config.emitters.length,
      fallbackActive: this.backend !== "webgpu",
      fieldCount: this.config.fields.length,
      forceCount: this.config.forces.length,
      gridCells:
        fluidStats?.gridCells ?? (this.backend === "webgpu" ? grid[0] * grid[1] * grid[2] : 0),
      gridResolution: grid,
      obstacleCount: this.config.obstacles.length,
      pressureIterations: fluidStats?.pressureIterations ?? resolvePressureIterations(this.config),
      renderSteps: resolveConfigRenderSteps(this.config),
      requestedBackend: this.config.solver.backendMode,
      simulationMs: fluidStats?.simulationMs ?? 0,
      solverPasses: fluidStats?.solverPasses ?? 0,
    };
  }

  dispose(): void {
    this.disposeFluid();
    this.disposeSourceGlow();
    this.object3D.remove(this.points);
    this.disposables.dispose();
  }

  private resolveBackend(): RuntimeBackend {
    if (this.config.solver.backendMode === "compat") {
      return "compat";
    }
    if (this.config.solver.backendMode === "webgpu" || this.config.solver.backendMode === "auto") {
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
    this.resourceSignature = this.computeResourceSignature();
    this.fluid = new FluidGrid3D(this.params, this.config);
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

  private computeResourceSignature(): string {
    return JSON.stringify({
      advectionMode: this.config.solver.advectionMode,
      backend: this.backend,
      emitters: this.config.emitters.map((emitter) => emitter.shape),
      grid: resolveEffectiveConfigGridResolution(this.config),
      obstacles: this.config.obstacles.map((obstacle) => obstacle.shape),
      quality: this.config.solver.quality,
    });
  }

  private computeSourceGlowSignature(): string {
    return JSON.stringify({
      emitters: this.config.emitters.map((emitter) => ({
        id: emitter.id,
        position: emitter.position,
        radius: emitter.radius,
      })),
      sourceGlow: this.config.sourceGlow,
    });
  }

  private syncSourceGlow(): void {
    const nextSignature = this.computeSourceGlowSignature();
    if (nextSignature === this.sourceGlowSignature) {
      return;
    }
    this.sourceGlowSignature = nextSignature;
    this.rebuildSourceGlow();
  }

  private rebuildSourceGlow(): void {
    this.disposeSourceGlow();
    if (!this.config.sourceGlow.enabled || this.config.sourceGlow.intensity <= 0) {
      return;
    }
    for (const emitter of this.config.emitters) {
      const geometry = new THREE.SphereGeometry(1, 32, 16);
      const material = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: new THREE.Color(this.config.sourceGlow.color).multiplyScalar(
          Math.max(0, this.config.sourceGlow.intensity),
        ),
        depthTest: true,
        depthWrite: false,
        opacity: clamp(this.config.sourceGlow.intensity * 0.22, 0.04, 0.82),
        transparent: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      const radius = Math.max(0.001, emitter.radius * this.config.sourceGlow.radius);
      mesh.name = "WispySmokeVFXSourceGlowPrimitive";
      mesh.position.set(
        emitter.position[0],
        emitter.position[1] + radius * 0.55,
        emitter.position[2],
      );
      mesh.scale.setScalar(radius * (1 + this.config.sourceGlow.softness * 0.32));
      mesh.renderOrder = 9;
      this.sourceGlowGroup.add(mesh);
      this.sourceGlowMeshes.push(mesh);
    }
  }

  private disposeSourceGlow(): void {
    for (const mesh of this.sourceGlowMeshes) {
      this.sourceGlowGroup.remove(mesh);
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const entry of material) {
          entry.dispose();
        }
      } else {
        material.dispose();
      }
    }
    this.sourceGlowMeshes.length = 0;
  }

  private applyTransform(): void {
    const [x, y, z] = this.config.transform.worldPosition;
    this.object3D.position.set(x, y, z);
  }

  private reallocateCompatibilityParticles(): void {
    const profile = resolveQualityProfile(this.config.solver.quality);
    const emitter = this.config.emitters[0];
    this.maxParticles = Math.max(
      16,
      Math.min(
        profile.maxParticles,
        Math.ceil(
          (emitter?.spawnRate ?? this.params.spawnRate) *
            (emitter?.lifetime ?? this.params.lifetime) *
            1.15,
        ),
      ),
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
    const emitter = this.config.emitters[0];
    const force = primaryForce(this.config);
    const field = primaryField(this.config);
    this.spawnCarry += (emitter?.spawnRate ?? this.params.spawnRate) * deltaSeconds * 0.72;
    const spawnCount = Math.floor(this.spawnCarry);
    this.spawnCarry -= spawnCount;
    for (
      let index = 0;
      index < spawnCount && this.particles.length < this.maxParticles;
      index += 1
    ) {
      const angle = this.random() * Math.PI * 2;
      const radius = Math.max(0.02, emitter?.radius ?? this.params.radius);
      const disk = Math.sqrt(this.random()) * radius;
      this.particles.push({
        age: 0,
        angle: this.random() * Math.PI * 2,
        baseSize: this.params.size * (0.5 + this.random() * 0.55),
        lifetime: (emitter?.lifetime ?? this.params.lifetime) * (0.72 + this.random() * 0.56),
        velocityX: Math.cos(angle) * field.strength * 0.14 + (emitter?.velocity[0] ?? 0),
        velocityY:
          force.riseSpeed * force.buoyantLift * (0.55 + this.random() * 0.28) +
          (emitter?.velocity[1] ?? 0),
        velocityZ: Math.sin(angle) * field.strength * 0.14 + (emitter?.velocity[2] ?? 0),
        x: (emitter?.position[0] ?? 0) + Math.cos(angle) * disk,
        y: (emitter?.position[1] ?? 0.08) + 0.08 + this.random() * radius,
        z: (emitter?.position[2] ?? 0) + Math.sin(angle) * disk,
      });
    }
  }

  private integrateParticles(deltaSeconds: number): void {
    const force = primaryForce(this.config);
    const field = primaryField(this.config);
    const [windX, windY, windZ] = force.wind;
    let writeIndex = 0;
    for (const particle of this.particles) {
      particle.age += deltaSeconds;
      const ageRatio = particle.age / Math.max(0.001, particle.lifetime);
      if (ageRatio >= 1 || particle.y > this.params.height) {
        continue;
      }
      const swirl = field.curlStrength * (1 - ageRatio) * deltaSeconds;
      const sin = Math.sin(particle.y * 2.1 + particle.angle);
      const cos = Math.cos(particle.y * 1.7 + particle.angle);
      particle.velocityX += sin * swirl * 0.12;
      particle.velocityZ += cos * swirl * 0.12;
      particle.x += (particle.velocityX + windX) * deltaSeconds;
      particle.y +=
        (particle.velocityY +
          windY +
          (this.config.emitters[0]?.temperature ?? this.params.sourceTemperature) * 0.035) *
        deltaSeconds;
      particle.z += (particle.velocityZ + windZ) * deltaSeconds;
      particle.angle += (0.15 + field.curlStrength * 0.22) * deltaSeconds;
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
