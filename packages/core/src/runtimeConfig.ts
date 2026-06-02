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
  WispySmokeEmitterChannel,
  WispySmokeEmitterKind,
  WispySmokeRuntimeConfig,
  WispySmokeGridResolution,
  WispySmokeToneMapping,
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
const TONE_MAPPINGS = ["renderer", "none", "aces", "agx"] as const;

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

function coreTemperatureValue(values: ParameterMap, fallback: number): number {
  return numberValue(values, "coreTemperature", fallback);
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

function emitterKindForType(type: string): WispySmokeEmitterKind {
  if (type === "emitter.smoke") {
    return "smoke";
  }
  if (type === "emitter.heat") {
    return "heat";
  }
  return "combined";
}

function emitterChannelsForKind(kind: WispySmokeEmitterKind): readonly WispySmokeEmitterChannel[] {
  if (kind === "smoke") {
    return ["density", "velocity"];
  }
  if (kind === "heat") {
    return ["temperature"];
  }
  return ["density", "temperature", "velocity"];
}

function incomingSourceIds(
  graph: GraphDocument,
  targetNodeId: string | undefined,
  targetPort: string,
): ReadonlySet<string> {
  if (!targetNodeId) {
    return new Set();
  }
  return new Set(
    graph.edges
      .filter((edge) => edge.target === targetNodeId && edge.targetPort === targetPort)
      .map((edge) => edge.source),
  );
}

export function createWispySmokeRuntimeConfig(
  overrides: ParameterMap | undefined = undefined,
): WispySmokeRuntimeConfig {
  const values = valueMap(overrides);
  const quality = stringOption(values, "quality", "high", GRID_QUALITIES) as QualityPreset;
  const backendMode = stringOption(values, "backendMode", "auto", BACKEND_MODES) as WispySmokeBackendMode;
  const gridResolution = stringOption(
    values,
    "gridResolution",
    "high",
    GRID_QUALITIES,
  ) as WispySmokeGridResolution;
  const advectionMode = stringOption(
    values,
    "advectionMode",
    "maccormack",
    ADVECTION_MODES,
  ) as WispySmokeAdvectionMode;
  const blendMode = stringOption(values, "blendMode", "normal", BLEND_MODES) as WispySmokeBlendMode;
  const debugView = stringOption(values, "debugView", "final", DEBUG_VIEWS) as WispySmokeDebugView;
  const toneMapping = stringOption(values, "toneMapping", "renderer", TONE_MAPPINGS) as WispySmokeToneMapping;
  const opacityRamp = curveValue(
    values,
    "opacityRamp",
    createDefaultWispySmokeParams().opacityRamp as CurveValue,
  );

  return {
    composite: {
      bloom: {
        enabled: values.bloomEnabled === true,
        radius: clampedNumberValue(values, "bloomRadius", 0.18, 0, 1),
        strength: clampedNumberValue(values, "bloomStrength", 0.35, 0, 10),
        threshold: clampedNumberValue(values, "bloomThreshold", 1, 0, 10),
      },
      layers: [
        {
          blendMode,
          id: "volume_render",
          order: intValue(values, "renderOrder", 10),
          sourceNodeId: "volume_render",
        },
      ],
      toneMapping,
    },
    debug: {
      view: debugView,
    },
    emitters: [
      {
        channels: ["density", "temperature", "velocity"],
        density: numberValue(values, "density", 0.9),
        falloff: numberValue(values, "sourceFalloff", 0.9),
        id: "emitter",
        kind: "combined",
        lifetime: numberValue(values, "lifetime", 8.2),
        noiseScale: numberValue(values, "sourceNoiseScale", 5.2),
        noiseStrength: numberValue(values, "sourceNoiseStrength", 1.65),
        position: vec3Value(values, "sourcePosition", [0, 0.22, 0]),
        radius: numberValue(values, "radius", 0.38),
        scale: vec3Value(values, "sourceScale", [0.92, 0.42, 0.92]),
        shape: "sphere",
        spawnRate: numberValue(values, "spawnRate", 1350),
        temperature: coreTemperatureValue(values, 1.1),
        velocity: vec3Value(values, "sourceVelocity", [0, 0.34, 0]),
      },
    ],
    fields: [
      {
        bands: intValue(values, "turbulenceBands", 4),
        curlStrength: numberValue(values, "curlStrength", 9),
        id: "curl_field",
        scale: numberValue(values, "detailScale", 22),
        speed: numberValue(values, "detailSpeed", 0.45),
        strength: numberValue(values, "turbulence", 5),
        type: "curl",
        vorticityConfinement: numberValue(values, "vorticityConfinement", 16),
      },
    ],
    forces: [
      {
        buoyantLift: numberValue(values, "buoyantLift", 1.4),
        id: "buoyancy",
        position: [0, 0, 0],
        radius: 1,
        riseSpeed: numberValue(values, "riseSpeed", 1.2),
        strength: 1,
        type: "buoyancy",
        wind: vec3Value(values, "wind", [0, 0, 0]),
      },
      {
        buoyantLift: numberValue(values, "buoyantLift", 1.4),
        id: "vortex",
        position: vec3Value(values, "vortexPosition", [0, 0.58, 0]),
        radius: numberValue(values, "vortexRadius", 1.55),
        riseSpeed: numberValue(values, "riseSpeed", 1.2),
        strength: numberValue(values, "vortexStrength", 0),
        type: "vortex",
        wind: [0, 0, 0],
      },
    ],
    obstacles: [],
    render: {
      absorption: numberValue(values, "absorption", 10.8),
      baseDensity: numberValue(values, "baseDensity", 1.85),
      blendMode,
      detailOctaves: Math.max(1, Math.min(5, intValue(values, "detailOctaves", 4))),
      detailScale: numberValue(values, "detailScale", 22),
      detailSpeed: numberValue(values, "detailSpeed", 0.45),
      detailStrength: clampedNumberValue(values, "detailStrength", 4.4, 0, 100),
      emissionThreshold: clampedNumberValue(values, "emissionThreshold", 0.72, 0, 10),
      flowWarpStrength: clampedNumberValue(values, "flowWarpStrength", 1.65, 0, 20),
      lightDirection: vec3Value(values, "lightDirection", [0.35, 0.85, 0.25]),
      opacity: numberValue(values, "opacity", 0.86),
      opacityRamp,
      phaseAnisotropy: clampedNumberValue(values, "phaseAnisotropy", 0.32, -0.5, 0.85),
      plumeTaper: numberValue(values, "plumeTaper", 0.12),
      renderStepScale: clampedNumberValue(values, "renderStepScale", 1.1, 0.1, 1.35),
      scattering: numberValue(values, "scattering", 2.15),
      shadowQuality: clampedIntValue(values, "shadowQuality", 8, 0, 16),
      shadowStrength: numberValue(values, "shadowStrength", 1.65),
      smokeColor: colorValue(values, "color", "#b8bcc0"),
      softness: numberValue(values, "softness", 0.78),
    },
    solver: {
      advectionMode,
      backendMode,
      densityDissipation: numberValue(values, "densityDissipation", 0.06),
      diffusion: numberValue(values, "diffusion", 0),
      diffusionIterations: intValue(values, "diffusionIterations", 0),
      gridResolution,
      pressureIterations: clampedIntValue(values, "pressureIterations", 16, 4, 80),
      quality,
      seed: intValue(values, "seed", 1337),
      velocityDissipation: numberValue(values, "velocityDissipation", 0.015),
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
  const solverNode = nodes.find((node) => node.type === "simulation.fluid-grid");
  const connectedEmitterIds = incomingSourceIds(graph, solverNode?.id, "emitter");
  const emitters = nodes
    .filter(
      (node) =>
        (node.type === "emitter.sphere" ||
          node.type === "emitter.box" ||
          node.type === "emitter.smoke" ||
          node.type === "emitter.heat") &&
        connectedEmitterIds.has(node.id),
    )
    .map((node) => {
      const values = valueMap({ ...parameterValues, ...resolveNodeInputValues(graph, node, registry) });
      const kind = emitterKindForType(node.type);
      return {
        channels: emitterChannelsForKind(kind),
        density: kind === "heat" ? 0 : numberValue(values, "density", 0.9),
        falloff: numberValue(values, "sourceFalloff", 0.9),
        id: node.id,
        kind,
        lifetime: numberValue(values, "lifetime", 8.2),
        noiseScale: numberValue(values, "sourceNoiseScale", 5.2),
        noiseStrength: numberValue(values, "sourceNoiseStrength", 1.65),
        position: vec3Value(values, "sourcePosition", [0, 0.22, 0]),
        radius: numberValue(values, "radius", 0.38),
        scale: vec3Value(values, "sourceScale", [0.92, 0.42, 0.92]),
        shape: node.type === "emitter.box" ? "box" : "sphere",
        spawnRate: numberValue(values, "spawnRate", 1350),
        temperature: kind === "smoke" ? 0 : coreTemperatureValue(values, 1.1),
        velocity: kind === "heat" ? ([0, 0, 0] as const) : vec3Value(values, "sourceVelocity", [0, 0.34, 0]),
      } as const;
    });
  const fields = nodes
    .filter((node) => node.type === "field.curl" || node.type === "field.fbm")
    .map((node) => {
      const values = valueMap({ ...parameterValues, ...resolveNodeInputValues(graph, node, registry) });
      return {
        bands: intValue(values, "turbulenceBands", 4),
        curlStrength: numberValue(values, "curlStrength", 9),
        id: node.id,
        scale: node.type === "field.fbm" ? numberValue(values, "detailScale", 18) : numberValue(values, "detailScale", 18),
        speed: numberValue(values, "detailSpeed", 0.45),
        strength:
          node.type === "field.fbm"
            ? clampedNumberValue(values, "detailStrength", 4.4, 0, 100)
            : numberValue(values, "turbulence", 5),
        type: node.type === "field.fbm" ? "fbm" : "curl",
        vorticityConfinement: numberValue(values, "vorticityConfinement", 16),
      } as const;
    });
  const forces = nodes
    .filter((node) => node.type === "force.buoyancy" || node.type === "force.wind" || node.type === "force.vortex")
    .map((node) => {
      const values = valueMap({ ...parameterValues, ...resolveNodeInputValues(graph, node, registry) });
      const type = node.type === "force.vortex" ? "vortex" : node.type === "force.wind" ? "wind" : "buoyancy";
      return {
        buoyantLift: numberValue(values, "buoyantLift", 1.4),
        id: node.id,
        position: vec3Value(values, "vortexPosition", [0, 0.58, 0]),
        radius: numberValue(values, "vortexRadius", 1.55),
        riseSpeed: numberValue(values, "riseSpeed", 1.2),
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

  const renderNode = nodes.find((node) => node.type === "render.volume");
  const compositeNode = nodes.find((node) => node.type === "render.composite");
  const debugNode = nodes.find((node) => node.type === "debug.view");
  const transformNode = nodes.find((node) => node.type === "transform.object");
  const solverValues = valueMap({ ...parameterValues, ...(solverNode ? nodeValues(graph, solverNode.id, registry) : {}) });
  const renderValues = valueMap({ ...parameterValues, ...(renderNode ? nodeValues(graph, renderNode.id, registry) : {}) });
  const compositeValues = valueMap({
    ...parameterValues,
    ...(compositeNode ? nodeValues(graph, compositeNode.id, registry) : {}),
  });
  const debugValues = valueMap({ ...parameterValues, ...(debugNode ? nodeValues(graph, debugNode.id, registry) : {}) });
  const transformValues = valueMap({
    ...parameterValues,
    ...(transformNode ? nodeValues(graph, transformNode.id, registry) : {}),
  });
  const layerSourceIds = (
    compositeNode
      ? graph.edges.filter((edge) => edge.target === compositeNode.id && edge.targetPort === "layers")
      : graph.edges.filter((edge) => edge.target === "output" && edge.targetPort === "effect")
  )
    .map((edge) => edge.source)
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .filter((id) => nodes.some((node) => node.id === id && node.type !== "render.composite"));
  const compositeLayers = layerSourceIds
    .map((sourceNodeId) => {
      const sourceNode = nodes.find((node) => node.id === sourceNodeId);
      const values = sourceNode ? valueMap({ ...parameterValues, ...nodeValues(graph, sourceNode.id, registry) }) : valueMap(parameterValues);
      const fallbackOrder = sourceNode?.type === "debug.view" ? 30 : 10;
      return {
        blendMode: stringOption(values, "blendMode", base.render.blendMode, BLEND_MODES) as WispySmokeBlendMode,
        id: sourceNodeId,
        order: intValue(values, "renderOrder", fallbackOrder),
        sourceNodeId,
      };
    })
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

  return {
    ...base,
    composite: {
      bloom: {
        enabled: compositeValues.bloomEnabled === true,
        radius: clampedNumberValue(compositeValues, "bloomRadius", base.composite.bloom.radius, 0, 1),
        strength: clampedNumberValue(
          compositeValues,
          "bloomStrength",
          base.composite.bloom.strength,
          0,
          10,
        ),
        threshold: clampedNumberValue(
          compositeValues,
          "bloomThreshold",
          base.composite.bloom.threshold,
          0,
          10,
        ),
      },
      layers: compositeLayers.length > 0 ? compositeLayers : base.composite.layers,
      toneMapping: stringOption(
        compositeValues,
        "toneMapping",
        base.composite.toneMapping,
        TONE_MAPPINGS,
      ) as WispySmokeToneMapping,
    },
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
      detailStrength: clampedNumberValue(renderValues, "detailStrength", base.render.detailStrength, 0, 100),
      emissionThreshold: clampedNumberValue(
        renderValues,
        "emissionThreshold",
        base.render.emissionThreshold,
        0,
        10,
      ),
      flowWarpStrength: clampedNumberValue(
        renderValues,
        "flowWarpStrength",
        base.render.flowWarpStrength,
        0,
        20,
      ),
      lightDirection: vec3Value(renderValues, "lightDirection", base.render.lightDirection),
      opacity: numberValue(renderValues, "opacity", base.render.opacity),
      opacityRamp: curveValue(renderValues, "opacityRamp", base.render.opacityRamp),
      phaseAnisotropy: clampedNumberValue(
        renderValues,
        "phaseAnisotropy",
        base.render.phaseAnisotropy,
        -0.5,
        0.85,
      ),
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
        80,
      ),
      quality: stringOption(solverValues, "quality", base.solver.quality, GRID_QUALITIES) as QualityPreset,
      seed: intValue(solverValues, "seed", base.solver.seed),
      velocityDissipation: numberValue(solverValues, "velocityDissipation", base.solver.velocityDissipation),
    },
    transform: {
      worldPosition: vec3Value(transformValues, "worldPosition", base.transform.worldPosition),
    },
  };
}
