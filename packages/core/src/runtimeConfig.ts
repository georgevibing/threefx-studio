import { cloneJson } from "./clone";
import { createDefaultWispySmokeParams } from "./parameters";
import { resolveNodeInputValues, resolveWispySmokeParameterValues } from "./parameterResolution";
import { defaultNodeRegistry, type NodeRegistry } from "./registry";
import type {
  CurveValue,
  GraphDocument,
  ParameterMap,
  QualityPreset,
  Vec3,
  WispySmokeAdvectionMode,
  WispySmokeBackendMode,
  WispySmokeBlendMode,
  WispySmokeDebugView,
  WispySmokeRuntimeConfig,
  WispySmokeGridResolution,
} from "./types";

const ADVECTION_MODES = ["nearest", "trilinear", "maccormack"] as const;
const BACKEND_MODES = ["auto", "webgpu", "compat"] as const;
const BLEND_MODES = ["normal", "additive"] as const;
const DEBUG_VIEWS = [
  "final",
  "density",
  "temperature",
  "velocity",
  "divergence",
  "pressure",
  "obstacles",
  "bounds",
] as const;
const GRID_QUALITIES = ["low", "medium", "high", "cinematic"] as const;

function numberValue(values: ParameterMap, id: string, fallback: number): number {
  const value = values[id];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampedNumberValue(
  values: ParameterMap,
  id: string,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, numberValue(values, id, fallback)));
}

function intValue(values: ParameterMap, id: string, fallback: number): number {
  return Math.max(0, Math.round(numberValue(values, id, fallback)));
}

function clampedIntValue(
  values: ParameterMap,
  id: string,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, intValue(values, id, fallback)));
}

function stringOption<const TOptions extends readonly string[]>(
  values: ParameterMap,
  id: string,
  fallback: TOptions[number],
  options: TOptions,
): TOptions[number] {
  const value = values[id];
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as TOptions[number])
    : fallback;
}

function colorValue(values: ParameterMap, id: string, fallback: `#${string}`): `#${string}` {
  const value = values[id];
  return typeof value === "string" && value.startsWith("#") ? (value as `#${string}`) : fallback;
}

function vec3Value(values: ParameterMap, id: string, fallback: Vec3): Vec3 {
  const value = values[id];
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
  ) {
    const [x, y, z] = value as [number, number, number];
    return [x, y, z];
  }
  return fallback;
}

function curveValue(values: ParameterMap, id: string, fallback: CurveValue): CurveValue {
  const value = values[id];
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value.every(
    (entry): entry is { readonly time: number; readonly value: number } =>
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.time === "number" &&
      typeof entry.value === "number",
  )
    ? cloneJson(value)
    : fallback;
}

function valueMap(overrides: ParameterMap | undefined): ParameterMap {
  return cloneJson({
    ...createDefaultWispySmokeParams(),
    ...(overrides ?? {}),
  });
}

export function createWispySmokeRuntimeConfig(
  overrides: ParameterMap | undefined = undefined,
): WispySmokeRuntimeConfig {
  const values = valueMap(overrides);
  const quality = stringOption(values, "quality", "medium", GRID_QUALITIES) as QualityPreset;
  const backendMode = stringOption(values, "backendMode", "auto", BACKEND_MODES) as WispySmokeBackendMode;
  const gridResolution = stringOption(
    values,
    "gridResolution",
    "medium",
    GRID_QUALITIES,
  ) as WispySmokeGridResolution;
  const advectionMode = stringOption(
    values,
    "advectionMode",
    "trilinear",
    ADVECTION_MODES,
  ) as WispySmokeAdvectionMode;
  const blendMode = stringOption(values, "blendMode", "normal", BLEND_MODES) as WispySmokeBlendMode;
  const debugView = stringOption(values, "debugView", "final", DEBUG_VIEWS) as WispySmokeDebugView;
  const opacityRamp = curveValue(
    values,
    "opacityRamp",
    createDefaultWispySmokeParams().opacityRamp as CurveValue,
  );
  const sourceGlowIntensity = numberValue(values, "sourceGlowIntensity", 0);

  return {
    debug: {
      view: debugView,
    },
    emitters: [
      {
        density: numberValue(values, "density", 0.68),
        falloff: numberValue(values, "sourceFalloff", 0.96),
        id: "emitter",
        lifetime: numberValue(values, "lifetime", 6.5),
        noiseScale: numberValue(values, "sourceNoiseScale", 15),
        noiseStrength: numberValue(values, "sourceNoiseStrength", 1.1),
        position: vec3Value(values, "sourcePosition", [0, 0.48, 0]),
        radius: numberValue(values, "radius", 0.45),
        scale: vec3Value(values, "sourceScale", [0.96, 0.32, 0.96]),
        shape: "sphere",
        spawnRate: numberValue(values, "spawnRate", 1200),
        temperature: numberValue(values, "sourceTemperature", 1.28),
        velocity: vec3Value(values, "sourceVelocity", [0, 0.75, 0]),
      },
    ],
    fields: [
      {
        bands: intValue(values, "turbulenceBands", 4),
        curlStrength: numberValue(values, "curlStrength", 6.4),
        id: "curl_field",
        scale: numberValue(values, "detailScale", 32),
        speed: numberValue(values, "detailSpeed", 0.95),
        strength: numberValue(values, "turbulence", 4.8),
        type: "curl",
        vorticityConfinement: numberValue(values, "vorticityConfinement", 8.5),
      },
    ],
    forces: [
      {
        buoyantLift: numberValue(values, "buoyantLift", 2.6),
        id: "buoyancy",
        position: [0, 0, 0],
        radius: 1,
        riseSpeed: numberValue(values, "riseSpeed", 2.3),
        strength: 1,
        type: "buoyancy",
        wind: vec3Value(values, "wind", [0, 0, 0]),
      },
      {
        buoyantLift: numberValue(values, "buoyantLift", 2.6),
        id: "vortex",
        position: vec3Value(values, "vortexPosition", [0, 0.58, 0]),
        radius: numberValue(values, "vortexRadius", 1.55),
        riseSpeed: numberValue(values, "riseSpeed", 2.3),
        strength: numberValue(values, "vortexStrength", 0),
        type: "vortex",
        wind: [0, 0, 0],
      },
    ],
    obstacles: [],
    render: {
      absorption: numberValue(values, "absorption", 11.8),
      baseDensity: numberValue(values, "baseDensity", 1.18),
      blendMode,
      detailOctaves: Math.max(1, Math.min(5, intValue(values, "detailOctaves", 4))),
      detailScale: numberValue(values, "detailScale", 32),
      detailSpeed: numberValue(values, "detailSpeed", 0.95),
      detailStrength: clampedNumberValue(values, "detailStrength", 7.2, 0, 8),
      opacity: numberValue(values, "opacity", 0.74),
      opacityRamp,
      plumeTaper: numberValue(values, "plumeTaper", 0.56),
      renderStepScale: clampedNumberValue(values, "renderStepScale", 1, 0.1, 1.35),
      scattering: numberValue(values, "scattering", 2.1),
      shadowQuality: clampedIntValue(values, "shadowQuality", 6, 0, 16),
      shadowStrength: numberValue(values, "shadowStrength", 1.15),
      smokeColor: colorValue(values, "color", "#aabbcc"),
      softness: numberValue(values, "softness", 0.82),
    },
    solver: {
      advectionMode,
      backendMode,
      densityDissipation: numberValue(values, "densityDissipation", 0.052),
      diffusion: numberValue(values, "diffusion", 0),
      diffusionIterations: intValue(values, "diffusionIterations", 0),
      gridResolution,
      pressureIterations: clampedIntValue(values, "pressureIterations", 10, 4, 40),
      quality,
      seed: intValue(values, "seed", 1337),
      velocityDissipation: numberValue(values, "velocityDissipation", 0.012),
    },
    sourceGlow: {
      blendMode: "additive",
      color: colorValue(values, "sourceGlowColor", "#ffaa66"),
      enabled: false,
      intensity: sourceGlowIntensity,
      radius: numberValue(values, "sourceGlowRadius", 1.15),
      softness: numberValue(values, "sourceGlowSoftness", 1.1),
    },
    transform: {
      worldPosition: vec3Value(values, "worldPosition", [0, 0, 0]),
    },
  };
}

function nodeValues(graph: GraphDocument, id: string, registry: NodeRegistry): ParameterMap {
  const node = graph.nodes.find((entry) => entry.id === id);
  return node ? resolveNodeInputValues(graph, node, registry) : {};
}

export function compileWispySmokeRuntimeConfig(
  graph: GraphDocument,
  registry: NodeRegistry = defaultNodeRegistry,
): WispySmokeRuntimeConfig {
  const parameterValues = resolveWispySmokeParameterValues(graph, registry);
  const base = createWispySmokeRuntimeConfig(parameterValues);
  const nodes = [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const emitters = nodes
    .filter((node) => node.type === "emitter.sphere" || node.type === "emitter.box")
    .map((node) => {
      const values = valueMap({ ...parameterValues, ...resolveNodeInputValues(graph, node, registry) });
      return {
        density: numberValue(values, "density", 0.68),
        falloff: numberValue(values, "sourceFalloff", 0.96),
        id: node.id,
        lifetime: numberValue(values, "lifetime", 6.5),
        noiseScale: numberValue(values, "sourceNoiseScale", 15),
        noiseStrength: numberValue(values, "sourceNoiseStrength", 1.1),
        position: vec3Value(values, "sourcePosition", [0, 0.48, 0]),
        radius: numberValue(values, "radius", 0.45),
        scale: vec3Value(values, "sourceScale", [0.96, 0.32, 0.96]),
        shape: node.type === "emitter.box" ? "box" : "sphere",
        spawnRate: numberValue(values, "spawnRate", 1200),
        temperature: numberValue(values, "sourceTemperature", 1.28),
        velocity: vec3Value(values, "sourceVelocity", [0, 0.75, 0]),
      } as const;
    });
  const fields = nodes
    .filter((node) => node.type === "field.curl" || node.type === "field.fbm")
    .map((node) => {
      const values = valueMap({ ...parameterValues, ...resolveNodeInputValues(graph, node, registry) });
      return {
        bands: intValue(values, "turbulenceBands", 4),
        curlStrength: numberValue(values, "curlStrength", 6.4),
        id: node.id,
        scale: node.type === "field.fbm" ? numberValue(values, "detailScale", 32) : numberValue(values, "detailScale", 32),
        speed: numberValue(values, "detailSpeed", 0.95),
        strength:
          node.type === "field.fbm"
            ? clampedNumberValue(values, "detailStrength", 7.2, 0, 8)
            : numberValue(values, "turbulence", 4.8),
        type: node.type === "field.fbm" ? "fbm" : "curl",
        vorticityConfinement: numberValue(values, "vorticityConfinement", 8.5),
      } as const;
    });
  const forces = nodes
    .filter((node) => node.type === "force.buoyancy" || node.type === "force.wind" || node.type === "force.vortex")
    .map((node) => {
      const values = valueMap({ ...parameterValues, ...resolveNodeInputValues(graph, node, registry) });
      const type = node.type === "force.vortex" ? "vortex" : node.type === "force.wind" ? "wind" : "buoyancy";
      return {
        buoyantLift: numberValue(values, "buoyantLift", 2.6),
        id: node.id,
        position: vec3Value(values, "vortexPosition", [0, 0.58, 0]),
        radius: numberValue(values, "vortexRadius", 1.55),
        riseSpeed: numberValue(values, "riseSpeed", 2.3),
        strength: type === "vortex" ? numberValue(values, "vortexStrength", 0) : 1,
        type,
        wind: vec3Value(values, "wind", [0, 0, 0]),
      } as const;
    });
  const obstacles = nodes
    .filter((node) => node.type === "obstacle.sphere" || node.type === "obstacle.box")
    .map((node) => {
      const values = valueMap({ ...parameterValues, ...resolveNodeInputValues(graph, node, registry) });
      return {
        id: node.id,
        position: vec3Value(values, "obstaclePosition", [0, 1.5, 0]),
        radius: numberValue(values, "obstacleRadius", 0.35),
        scale: vec3Value(values, "obstacleScale", [0.7, 0.7, 0.7]),
        shape: node.type === "obstacle.box" ? "box" : "sphere",
        softness: numberValue(values, "obstacleSoftness", 0.08),
      } as const;
    });

  const solverNode = nodes.find((node) => node.type === "simulation.fluid-grid");
  const renderNode = nodes.find((node) => node.type === "render.volume");
  const glowNode = nodes.find((node) => node.type === "render.source-glow");
  const debugNode = nodes.find((node) => node.type === "debug.view");
  const transformNode = nodes.find((node) => node.type === "transform.object");
  const solverValues = valueMap({ ...parameterValues, ...(solverNode ? nodeValues(graph, solverNode.id, registry) : {}) });
  const renderValues = valueMap({ ...parameterValues, ...(renderNode ? nodeValues(graph, renderNode.id, registry) : {}) });
  const glowValues = valueMap({ ...parameterValues, ...(glowNode ? nodeValues(graph, glowNode.id, registry) : {}) });
  const debugValues = valueMap({ ...parameterValues, ...(debugNode ? nodeValues(graph, debugNode.id, registry) : {}) });
  const transformValues = valueMap({
    ...parameterValues,
    ...(transformNode ? nodeValues(graph, transformNode.id, registry) : {}),
  });
  const glowIntensity = numberValue(glowValues, "sourceGlowIntensity", base.sourceGlow.intensity);

  return {
    ...base,
    debug: {
      view: stringOption(debugValues, "debugView", base.debug.view, DEBUG_VIEWS) as WispySmokeDebugView,
    },
    emitters: emitters.length > 0 ? emitters : base.emitters,
    fields: fields.length > 0 ? fields : base.fields,
    forces: forces.length > 0 ? forces : base.forces,
    obstacles,
    render: {
      ...base.render,
      absorption: numberValue(renderValues, "absorption", base.render.absorption),
      baseDensity: numberValue(renderValues, "baseDensity", base.render.baseDensity),
      blendMode: stringOption(renderValues, "blendMode", base.render.blendMode, BLEND_MODES) as WispySmokeBlendMode,
      detailOctaves: Math.max(1, Math.min(5, intValue(renderValues, "detailOctaves", base.render.detailOctaves))),
      detailScale: numberValue(renderValues, "detailScale", base.render.detailScale),
      detailSpeed: numberValue(renderValues, "detailSpeed", base.render.detailSpeed),
      detailStrength: clampedNumberValue(renderValues, "detailStrength", base.render.detailStrength, 0, 8),
      opacity: numberValue(renderValues, "opacity", base.render.opacity),
      opacityRamp: curveValue(renderValues, "opacityRamp", base.render.opacityRamp),
      plumeTaper: numberValue(renderValues, "plumeTaper", base.render.plumeTaper),
      renderStepScale: clampedNumberValue(
        renderValues,
        "renderStepScale",
        base.render.renderStepScale,
        0.1,
        1.35,
      ),
      scattering: numberValue(renderValues, "scattering", base.render.scattering),
      shadowQuality: clampedIntValue(renderValues, "shadowQuality", base.render.shadowQuality, 0, 16),
      shadowStrength: numberValue(renderValues, "shadowStrength", base.render.shadowStrength),
      smokeColor: colorValue(renderValues, "color", base.render.smokeColor),
      softness: numberValue(renderValues, "softness", base.render.softness),
    },
    solver: {
      ...base.solver,
      advectionMode: stringOption(solverValues, "advectionMode", base.solver.advectionMode, ADVECTION_MODES) as WispySmokeAdvectionMode,
      backendMode: stringOption(solverValues, "backendMode", base.solver.backendMode, BACKEND_MODES) as WispySmokeBackendMode,
      densityDissipation: numberValue(solverValues, "densityDissipation", base.solver.densityDissipation),
      diffusion: numberValue(solverValues, "diffusion", base.solver.diffusion),
      diffusionIterations: intValue(solverValues, "diffusionIterations", base.solver.diffusionIterations),
      gridResolution: stringOption(solverValues, "gridResolution", base.solver.gridResolution, GRID_QUALITIES) as WispySmokeGridResolution,
      pressureIterations: clampedIntValue(
        solverValues,
        "pressureIterations",
        base.solver.pressureIterations,
        4,
        40,
      ),
      quality: stringOption(solverValues, "quality", base.solver.quality, GRID_QUALITIES) as QualityPreset,
      seed: intValue(solverValues, "seed", base.solver.seed),
      velocityDissipation: numberValue(solverValues, "velocityDissipation", base.solver.velocityDissipation),
    },
    sourceGlow: {
      blendMode: "additive",
      color: colorValue(glowValues, "sourceGlowColor", base.sourceGlow.color),
      enabled: false,
      intensity: glowIntensity,
      radius: numberValue(glowValues, "sourceGlowRadius", base.sourceGlow.radius),
      softness: numberValue(glowValues, "sourceGlowSoftness", base.sourceGlow.softness),
    },
    transform: {
      worldPosition: vec3Value(transformValues, "worldPosition", base.transform.worldPosition),
    },
  };
}
