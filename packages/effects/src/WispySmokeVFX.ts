import * as THREE from "three";
import { DisposableGroup, resolveQualityProfile, type VFXEffect } from "@threefx/runtime";
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
  seed: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  x: number;
  y: number;
  z: number;
}

const VERTEX_SHADER = `
attribute float aAlpha;
attribute float aAngle;
attribute float aSize;
varying float vAlpha;
varying float vAngle;
void main() {
  vAlpha = aAlpha;
  vAngle = aAngle;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * (280.0 / max(0.01, -mvPosition.z)));
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = `
precision highp float;
uniform vec3 uColor;
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
  float radial = 1.0 - smoothstep(0.16 + uSoftness * 0.22, 0.5, radius);
  float filamentA = noise(uv * 6.5 + vec2(uTime * 0.05, -uTime * 0.03));
  float filamentB = noise(uv * 13.0 + vec2(-uTime * 0.025, uTime * 0.04));
  float wisps = smoothstep(0.22, 0.82, filamentA * 0.72 + filamentB * 0.38 + (0.5 - radius) * 0.9);
  float alpha = radial * wisps * vAlpha * uOpacity;

  if (alpha < 0.015) {
    discard;
  }
  vec3 color = mix(uColor * 0.62, uColor * 1.18, filamentA);
  gl_FragColor = vec4(color, alpha);
}
`;

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

function createGlowTexture(size: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create 2D canvas for smoke glow texture.");
  }
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255, 178, 86, 0.72)");
  gradient.addColorStop(0.42, "rgba(255, 121, 45, 0.2)");
  gradient.addColorStop(1, "rgba(255, 121, 45, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export class WispySmokeVFX implements VFXEffect<WispySmokeVFXParams> {
  readonly object3D = new THREE.Group();

  private params: WispySmokeVFXParams;
  private readonly disposables = new DisposableGroup();
  private readonly particles: SmokeParticle[] = [];
  private positions = new Float32Array(0);
  private alphas = new Float32Array(0);
  private sizes = new Float32Array(0);
  private angles = new Float32Array(0);
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private points: THREE.Points;
  private glowSprite: THREE.Sprite | null = null;
  private glowMaterial: THREE.SpriteMaterial | null = null;
  private random: () => number;
  private spawnCarry = 0;
  private emitted = 0;
  private maxParticles = 0;

  constructor(options: WispySmokeVFXOptions = {}) {
    const { position, renderer: _renderer, ...params } = options;
    const initialParams =
      params.worldPosition || !position ? params : { ...params, worldPosition: position };
    this.params = normalizeWispySmokeParams(initialParams);
    this.random = mulberry32(this.params.seed);
    this.geometry = this.disposables.add(new THREE.BufferGeometry());
    this.material = this.disposables.add(
      new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: {
          uColor: { value: new THREE.Color(this.params.color) },
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
    this.reallocateParticles();
    this.configureGlow();
  }

  update(deltaSeconds: number, elapsedSeconds = performance.now() / 1000): void {
    const dt = clamp(deltaSeconds, 0, 1 / 15);
    (this.material.uniforms.uTime as THREE.IUniform<number>).value = elapsedSeconds;
    this.spawnParticles(dt);
    this.integrateParticles(dt, elapsedSeconds);
    this.writeGeometry();
    this.updateGlow();
  }

  setParams(params: Partial<WispySmokeVFXParams>): void {
    const previousQuality = this.params.quality;
    const previousSeed = this.params.seed;
    this.params = normalizeWispySmokeParams({ ...this.params, ...params });
    (this.material.uniforms.uColor as THREE.IUniform<THREE.Color>).value.set(this.params.color);
    (this.material.uniforms.uOpacity as THREE.IUniform<number>).value = this.params.opacity;
    (this.material.uniforms.uSoftness as THREE.IUniform<number>).value = this.params.softness;
    this.applyTransform();
    if (previousQuality !== this.params.quality) {
      this.reallocateParticles();
    }
    if (previousSeed !== this.params.seed) {
      this.random = mulberry32(this.params.seed);
      this.particles.length = 0;
      this.emitted = 0;
      this.spawnCarry = 0;
    }
    this.configureGlow();
  }

  getParams(): Readonly<WispySmokeVFXParams> {
    return this.params;
  }

  getStats(): WispySmokeVFXStats {
    return {
      activeParticles: this.particles.length,
      maxParticles: this.maxParticles,
    };
  }

  dispose(): void {
    this.object3D.remove(this.points);
    if (this.glowSprite) {
      this.object3D.remove(this.glowSprite);
    }
    this.glowMaterial = null;
    this.glowSprite = null;
    this.disposables.dispose();
  }

  private applyTransform(): void {
    const [x, y, z] = this.params.worldPosition;
    this.object3D.position.set(x, y, z);
  }

  private reallocateParticles(): void {
    const profile = resolveQualityProfile(this.params.quality);
    this.maxParticles = Math.max(
      16,
      Math.min(
        profile.maxParticles,
        Math.ceil(this.params.spawnRate * this.params.lifetime * 1.55),
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
    this.spawnCarry += this.params.spawnRate * deltaSeconds;
    const spawnCount = Math.floor(this.spawnCarry);
    this.spawnCarry -= spawnCount;
    for (let index = 0; index < spawnCount; index += 1) {
      if (this.particles.length >= this.maxParticles) {
        break;
      }
      this.particles.push(this.createParticle());
    }
  }

  private createParticle(): SmokeParticle {
    const angle = this.random() * Math.PI * 2;
    const disk = Math.sqrt(this.random()) * this.params.radius;
    const jitter = (this.random() - 0.5) * 0.18;
    const seed = this.params.seed + this.emitted * 37 + Math.floor(this.random() * 1000);
    this.emitted += 1;
    return {
      age: 0,
      angle: this.random() * Math.PI * 2,
      baseSize: this.params.size * (0.72 + this.random() * 0.62),
      lifetime: this.params.lifetime * (0.75 + this.random() * 0.5),
      seed,
      velocityX: Math.cos(angle) * jitter,
      velocityY: this.params.riseSpeed * (0.82 + this.random() * 0.28),
      velocityZ: Math.sin(angle) * jitter,
      x: Math.cos(angle) * disk,
      y: 0,
      z: Math.sin(angle) * disk,
    };
  }

  private integrateParticles(deltaSeconds: number, elapsedSeconds: number): void {
    const live: SmokeParticle[] = [];
    const [windX, windY, windZ] = this.params.wind;
    for (const particle of this.particles) {
      particle.age += deltaSeconds;
      const ageRatio = particle.age / Math.max(0.001, particle.lifetime);
      if (ageRatio >= 1 || particle.y > this.params.height * 1.18) {
        continue;
      }
      const swirlPhase = particle.seed * 0.017 + elapsedSeconds * 0.75 + particle.y * 1.6;
      const curl = this.params.curlStrength * (1 - ageRatio * 0.45);
      const wander = this.params.turbulence * (0.35 + ageRatio);
      particle.velocityX += Math.sin(swirlPhase) * curl * deltaSeconds;
      particle.velocityZ += Math.cos(swirlPhase * 0.83) * curl * deltaSeconds;
      particle.x += (particle.velocityX + windX * wander) * deltaSeconds;
      particle.y +=
        (particle.velocityY + windY + this.params.riseSpeed * 0.18 * (1 - ageRatio)) * deltaSeconds;
      particle.z += (particle.velocityZ + windZ * wander) * deltaSeconds;
      particle.angle += (0.16 + this.params.curlStrength * 0.2) * deltaSeconds;
      live.push(particle);
    }
    this.particles.length = 0;
    this.particles.push(...live);
  }

  private writeGeometry(): void {
    let count = 0;
    for (const particle of this.particles) {
      if (count >= this.maxParticles) {
        break;
      }
      const ageRatio = clamp(particle.age / Math.max(0.001, particle.lifetime), 0, 1);
      const grow = 0.42 + ageRatio * 1.65;
      const plumeFade = 1 - smoothstep(0.82, 1, particle.y / Math.max(0.01, this.params.height));
      const lifeFade =
        Math.sin(Math.PI * ageRatio) * Math.pow(1 - ageRatio, this.params.dissipation);
      this.positions[count * 3] = particle.x;
      this.positions[count * 3 + 1] = particle.y;
      this.positions[count * 3 + 2] = particle.z;
      this.alphas[count] = clamp(this.params.density * lifeFade * plumeFade, 0, 1);
      this.sizes[count] = particle.baseSize * grow;
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

  private configureGlow(): void {
    if (!this.params.warmGlow) {
      if (this.glowSprite) {
        this.object3D.remove(this.glowSprite);
      }
      return;
    }
    if (!this.glowMaterial || !this.glowSprite) {
      const texture = this.disposables.add(
        createGlowTexture(resolveQualityProfile(this.params.quality).textureSize),
      );
      const glowMaterial = this.disposables.add(
        new THREE.SpriteMaterial({
          map: texture,
          color: new THREE.Color("#ff8b3d"),
          depthWrite: false,
          transparent: true,
          opacity: 0.28,
          blending: THREE.AdditiveBlending,
        }),
      );
      this.glowMaterial = glowMaterial;
      this.glowSprite = new THREE.Sprite(glowMaterial);
      this.glowSprite.name = "WispySmokeVFXGlow";
      this.object3D.add(this.glowSprite);
    } else if (!this.object3D.children.includes(this.glowSprite)) {
      this.object3D.add(this.glowSprite);
    }
    this.updateGlow();
  }

  private updateGlow(): void {
    if (!this.glowSprite || !this.glowMaterial) {
      return;
    }
    const scale = Math.max(0.4, this.params.radius * 3.2);
    this.glowSprite.position.set(0, 0.05, 0);
    this.glowSprite.scale.set(scale, scale, 1);
    this.glowMaterial.opacity = this.params.warmGlow
      ? clamp(this.params.opacity * 0.24, 0, 0.35)
      : 0;
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
