import { stableJson, type EffectIR, type ParameterMap } from "@threefx/core";

function paramsLiteral(params: ParameterMap): string {
  return JSON.stringify(params, null, 2)
    .replaceAll('"worldPosition": [', '"worldPosition": [')
    .replaceAll('"wind": [', '"wind": [');
}

export function createWispySmokeClassSource(ir: EffectIR, className: string): string {
  return `import * as THREE from "three";

export type WispySmokeQuality = "low" | "medium" | "high" | "cinematic";
export type Vec3 = readonly [number, number, number];

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
  readonly opacity: number;
  readonly size: number;
  readonly radius: number;
  readonly height: number;
  readonly riseSpeed: number;
  readonly turbulence: number;
  readonly curlStrength: number;
  readonly dissipation: number;
  readonly softness: number;
  readonly color: string;
  readonly seed: number;
  readonly quality: WispySmokeQuality;
  readonly worldPosition: Vec3;
  readonly wind: Vec3;
  readonly warmGlow: boolean;
}

export type ${className}Options = Partial<${className}Params> & {
  readonly renderer?: unknown;
  readonly position?: Vec3;
};

const DEFAULT_PARAMS: ${className}Params = ${paramsLiteral(ir.parameterValues)} as ${className}Params;

const QUALITY: Record<WispySmokeQuality, { maxParticles: number }> = {
  low: { maxParticles: 96 },
  medium: { maxParticles: 180 },
  high: { maxParticles: 320 },
  cinematic: { maxParticles: 560 },
};

const VERTEX_SHADER = \`
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
\`;

const FRAGMENT_SHADER = \`
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
  if (alpha < 0.015) discard;
  vec3 color = mix(uColor * 0.62, uColor * 1.18, filamentA);
  gl_FragColor = vec4(color, alpha);
}
\`;

interface Particle {
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
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export class ${className} implements VFXEffect<${className}Params> {
  readonly object3D = new THREE.Group();
  private params: ${className}Params;
  private particles: Particle[] = [];
  private geometry = new THREE.BufferGeometry();
  private material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uColor: { value: new THREE.Color(DEFAULT_PARAMS.color) },
      uOpacity: { value: DEFAULT_PARAMS.opacity },
      uSoftness: { value: DEFAULT_PARAMS.softness },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  private points = new THREE.Points(this.geometry, this.material);
  private positions = new Float32Array(0);
  private alphas = new Float32Array(0);
  private sizes = new Float32Array(0);
  private angles = new Float32Array(0);
  private random: () => number;
  private maxParticles = 0;
  private spawnCarry = 0;
  private emitted = 0;

  constructor(options: ${className}Options = {}) {
    const { position, renderer: _renderer, ...params } = options;
    this.params = { ...DEFAULT_PARAMS, ...params, worldPosition: params.worldPosition ?? position ?? DEFAULT_PARAMS.worldPosition };
    this.random = mulberry32(this.params.seed);
    this.points.frustumCulled = false;
    this.object3D.name = "${className}";
    this.object3D.add(this.points);
    this.applyParams();
    this.reallocate();
  }

  update(deltaSeconds: number, elapsedSeconds = performance.now() / 1000): void {
    const dt = clamp(deltaSeconds, 0, 1 / 15);
    this.material.uniforms.uTime.value = elapsedSeconds;
    this.spawnCarry += this.params.spawnRate * dt;
    const count = Math.floor(this.spawnCarry);
    this.spawnCarry -= count;
    for (let index = 0; index < count && this.particles.length < this.maxParticles; index += 1) {
      this.particles.push(this.createParticle());
    }
    this.integrate(dt, elapsedSeconds);
    this.writeGeometry();
  }

  setParams(params: Partial<${className}Params>): void {
    const quality = this.params.quality;
    const seed = this.params.seed;
    this.params = { ...this.params, ...params };
    this.applyParams();
    if (quality !== this.params.quality) this.reallocate();
    if (seed !== this.params.seed) {
      this.random = mulberry32(this.params.seed);
      this.particles = [];
      this.spawnCarry = 0;
      this.emitted = 0;
    }
  }

  getParams(): Readonly<${className}Params> {
    return this.params;
  }

  dispose(): void {
    this.object3D.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }

  private applyParams(): void {
    const [x, y, z] = this.params.worldPosition;
    this.object3D.position.set(x, y, z);
    this.material.uniforms.uColor.value.set(this.params.color);
    this.material.uniforms.uOpacity.value = this.params.opacity;
    this.material.uniforms.uSoftness.value = this.params.softness;
  }

  private reallocate(): void {
    this.maxParticles = Math.max(16, Math.min(QUALITY[this.params.quality].maxParticles, Math.ceil(this.params.spawnRate * this.params.lifetime * 1.55)));
    this.positions = new Float32Array(this.maxParticles * 3);
    this.alphas = new Float32Array(this.maxParticles);
    this.sizes = new Float32Array(this.maxParticles);
    this.angles = new Float32Array(this.maxParticles);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute("aAngle", new THREE.BufferAttribute(this.angles, 1));
    this.geometry.setDrawRange(0, 0);
  }

  private createParticle(): Particle {
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

  private integrate(deltaSeconds: number, elapsedSeconds: number): void {
    const [windX, windY, windZ] = this.params.wind;
    this.particles = this.particles.filter((particle) => {
      particle.age += deltaSeconds;
      const ageRatio = particle.age / Math.max(0.001, particle.lifetime);
      if (ageRatio >= 1 || particle.y > this.params.height * 1.18) return false;
      const phase = particle.seed * 0.017 + elapsedSeconds * 0.75 + particle.y * 1.6;
      const curl = this.params.curlStrength * (1 - ageRatio * 0.45);
      const wander = this.params.turbulence * (0.35 + ageRatio);
      particle.velocityX += Math.sin(phase) * curl * deltaSeconds;
      particle.velocityZ += Math.cos(phase * 0.83) * curl * deltaSeconds;
      particle.x += (particle.velocityX + windX * wander) * deltaSeconds;
      particle.y += (particle.velocityY + windY + this.params.riseSpeed * 0.18 * (1 - ageRatio)) * deltaSeconds;
      particle.z += (particle.velocityZ + windZ * wander) * deltaSeconds;
      particle.angle += (0.16 + this.params.curlStrength * 0.2) * deltaSeconds;
      return true;
    });
  }

  private writeGeometry(): void {
    let count = 0;
    for (const particle of this.particles) {
      const ageRatio = clamp(particle.age / Math.max(0.001, particle.lifetime), 0, 1);
      const plumeFade = 1 - smoothstep(0.82, 1, particle.y / Math.max(0.01, this.params.height));
      const lifeFade = Math.sin(Math.PI * ageRatio) * Math.pow(1 - ageRatio, this.params.dissipation);
      this.positions[count * 3] = particle.x;
      this.positions[count * 3 + 1] = particle.y;
      this.positions[count * 3 + 2] = particle.z;
      this.alphas[count] = clamp(this.params.density * lifeFade * plumeFade, 0, 1);
      this.sizes[count] = particle.baseSize * (0.42 + ageRatio * 1.65);
      this.angles[count] = particle.angle;
      count += 1;
    }
    this.geometry.setDrawRange(0, count);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAngle.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}
`;
}

export function createUsageSnippet(className: string): string {
  return `import { ${className} } from "./${className}";

const smoke = new ${className}({
  renderer,
  quality: "high",
  worldPosition: [0, 0, 0],
  spawnRate: 96,
  lifetime: 2.4,
  turbulence: 0.35,
  density: 0.8,
  color: "#b9c7cf"
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

This export contains a standalone typed Three.js effect class. It does not depend on React, the builder app, or ThreeFX Studio packages.

\`\`\`ts
${createUsageSnippet(className).trim()}
\`\`\`

Parameter defaults:

\`\`\`json
${JSON.stringify(ir.parameterValues, null, 2)}
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
    schemaVersion: ir.schemaVersion,
  })}\n`;
}
