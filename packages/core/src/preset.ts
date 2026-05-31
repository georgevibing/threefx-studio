import { createDefaultWispySmokeParams, getParameterMetadata } from "./parameters";
import { defaultNodeRegistry } from "./registry";
import { THREEFX_GRAPH_SCHEMA_VERSION, type GraphDocument, type GraphEdge, type GraphNode } from "./types";

const positions = {
  spawnRate: [-760, -340],
  radius: [-760, -250],
  density: [-760, -160],
  riseSpeed: [-760, 60],
  turbulence: [-760, 300],
  curlStrength: [-760, 390],
  color: [-760, 650],
  opacity: [-760, 740],
  quality: [-250, -500],
  worldPosition: [-250, -380],
} as const satisfies Record<string, readonly [number, number]>;

function node(type: string, id: string, position: readonly [number, number]): GraphNode {
  return defaultNodeRegistry.instantiate(type, id, position);
}

function parameterNode(parameterId: string, id: string, position: readonly [number, number]): GraphNode {
  const parameter = getParameterMetadata(parameterId);
  if (!parameter) {
    throw new Error(`Unknown Wispy Smoke parameter '${parameterId}'.`);
  }
  return {
    ...defaultNodeRegistry.instantiate(`parameter.${parameter.type}`, id, position, {
      value: parameter.defaultValue,
    }),
    label: parameter.label,
  };
}

function edge(
  id: string,
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string,
): GraphEdge {
  return { id, source, sourcePort, target, targetPort };
}

export function createWispySmokeGraph(): GraphDocument {
  const nodes: GraphNode[] = [
    node("output.three-webgpu", "output", [940, 120]),
    node("emitter.sphere", "emitter", [-420, -160]),
    node("field.curl", "curl_field", [-420, 240]),
    node("field.fbm", "detail_field", [-420, 520]),
    node("force.buoyancy", "buoyancy", [-120, 20]),
    node("force.vortex", "vortex", [-120, 260]),
    node("simulation.fluid-grid", "fluid_solver", [230, 100]),
    node("render.volume", "volume_render", [560, 100]),
    node("render.source-glow", "source_glow", [560, 520]),
    node("debug.view", "debug_view", [560, -240]),
    node("transform.object", "transform", [80, -380]),
    node("quality.preset", "quality_preset", [80, -500]),
    parameterNode("spawnRate", "param_spawnRate", positions.spawnRate),
    parameterNode("radius", "param_radius", positions.radius),
    parameterNode("density", "param_density", positions.density),
    parameterNode("riseSpeed", "param_riseSpeed", positions.riseSpeed),
    parameterNode("turbulence", "param_turbulence", positions.turbulence),
    parameterNode("curlStrength", "param_curlStrength", positions.curlStrength),
    parameterNode("color", "param_color", positions.color),
    parameterNode("opacity", "param_opacity", positions.opacity),
    parameterNode("quality", "param_quality", positions.quality),
    parameterNode("worldPosition", "param_worldPosition", positions.worldPosition),
  ];

  const edges: GraphEdge[] = [
    edge("flow_emitter_solver", "emitter", "flowOut", "fluid_solver", "flowIn"),
    edge("flow_solver_render", "fluid_solver", "flowOut", "volume_render", "flowIn"),
    edge("flow_render_glow", "volume_render", "flowOut", "source_glow", "flowIn"),
    edge("flow_glow_output", "source_glow", "flowOut", "output", "flowIn"),
    edge("spawnRate_to_emitter", "param_spawnRate", "value", "emitter", "spawnRate"),
    edge("radius_to_emitter", "param_radius", "value", "emitter", "radius"),
    edge("density_to_emitter", "param_density", "value", "emitter", "density"),
    edge("riseSpeed_to_buoyancy", "param_riseSpeed", "value", "buoyancy", "riseSpeed"),
    edge("turbulence_to_curl", "param_turbulence", "value", "curl_field", "turbulence"),
    edge("curl_to_curl", "param_curlStrength", "value", "curl_field", "curlStrength"),
    edge("emitter_to_buoyancy", "emitter", "emitter", "buoyancy", "emitter"),
    edge("emitter_to_solver", "emitter", "emitter", "fluid_solver", "emitter"),
    edge("emitter_to_glow", "emitter", "emitter", "source_glow", "emitter"),
    edge("buoyancy_to_solver", "buoyancy", "force", "fluid_solver", "force"),
    edge("vortex_to_solver", "vortex", "force", "fluid_solver", "force"),
    edge("curl_to_solver", "curl_field", "field", "fluid_solver", "field"),
    edge("detail_to_solver", "detail_field", "field", "fluid_solver", "field"),
    edge("solver_to_render", "fluid_solver", "simulation", "volume_render", "simulation"),
    edge("solver_to_debug", "fluid_solver", "simulation", "debug_view", "simulation"),
    edge("color_to_render", "param_color", "value", "volume_render", "color"),
    edge("opacity_to_render", "param_opacity", "value", "volume_render", "opacity"),
    edge("volume_to_output", "volume_render", "render", "output", "effect"),
    edge("glow_to_output", "source_glow", "render", "output", "effect"),
    edge("debug_to_output", "debug_view", "render", "output", "effect"),
    edge("quality_to_preset", "param_quality", "value", "quality_preset", "quality"),
    edge("position_to_transform", "param_worldPosition", "value", "transform", "worldPosition"),
  ];

  return {
    schemaVersion: THREEFX_GRAPH_SCHEMA_VERSION,
    kind: "ThreeFXGraph",
    effectType: "wispy-smoke",
    name: "Wispy Smoke",
    nodes,
    edges,
    parameters: createDefaultWispySmokeParams(),
    viewport: { x: 120, y: 80, zoom: 0.82 },
  };
}
