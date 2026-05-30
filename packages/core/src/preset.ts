import { createDefaultWispySmokeParams } from "./parameters";
import { defaultNodeRegistry } from "./registry";
import { THREEFX_GRAPH_SCHEMA_VERSION, type GraphDocument, type GraphEdge, type GraphNode } from "./types";

const positions = {
  spawnRate: [-720, -300],
  lifetime: [-720, -210],
  radius: [-720, -120],
  density: [-720, 40],
  dissipation: [-720, 130],
  turbulence: [-720, 290],
  curlStrength: [-720, 380],
  riseSpeed: [-720, 540],
  wind: [-720, 630],
  color: [-720, 780],
  opacity: [-720, 870],
  softness: [-720, 960],
  quality: [-190, -390],
  worldPosition: [-190, -270],
} as const satisfies Record<string, readonly [number, number]>;

function node(type: string, id: string, position: readonly [number, number]): GraphNode {
  return defaultNodeRegistry.instantiate(type, id, position);
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
    node("output.three-webgpu", "output", [720, 160]),
    node("emitter.volume", "emitter", [-260, -160]),
    node("noise.curl", "curl_noise", [-260, 310]),
    node("force.buoyancy", "buoyancy", [20, 80]),
    node("simulation.advection", "advection", [300, 160]),
    node("render.volume", "volume_render", [520, 160]),
    node("transform.object", "transform", [70, -250]),
    node("quality.preset", "quality_preset", [70, -390]),
    node("parameter.spawnRate", "param_spawnRate", positions.spawnRate),
    node("parameter.lifetime", "param_lifetime", positions.lifetime),
    node("parameter.radius", "param_radius", positions.radius),
    node("parameter.density", "param_density", positions.density),
    node("parameter.dissipation", "param_dissipation", positions.dissipation),
    node("parameter.turbulence", "param_turbulence", positions.turbulence),
    node("parameter.curlStrength", "param_curlStrength", positions.curlStrength),
    node("parameter.riseSpeed", "param_riseSpeed", positions.riseSpeed),
    node("parameter.wind", "param_wind", positions.wind),
    node("parameter.color", "param_color", positions.color),
    node("parameter.opacity", "param_opacity", positions.opacity),
    node("parameter.softness", "param_softness", positions.softness),
    node("parameter.quality", "param_quality", positions.quality),
    node("parameter.worldPosition", "param_worldPosition", positions.worldPosition),
  ];

  const edges: GraphEdge[] = [
    edge("flow_emitter_advection", "emitter", "flowOut", "advection", "flowIn"),
    edge("flow_advection_render", "advection", "flowOut", "volume_render", "flowIn"),
    edge("flow_render_output", "volume_render", "flowOut", "output", "flowIn"),
    edge("spawnRate_to_emitter", "param_spawnRate", "value", "emitter", "spawnRate"),
    edge("lifetime_to_emitter", "param_lifetime", "value", "emitter", "lifetime"),
    edge("radius_to_emitter", "param_radius", "value", "emitter", "radius"),
    edge("emitter_to_buoyancy", "emitter", "emitter", "buoyancy", "emitter"),
    edge("riseSpeed_to_buoyancy", "param_riseSpeed", "value", "buoyancy", "riseSpeed"),
    edge("wind_to_buoyancy", "param_wind", "value", "buoyancy", "wind"),
    edge("turbulence_to_noise", "param_turbulence", "value", "curl_noise", "turbulence"),
    edge("curl_to_noise", "param_curlStrength", "value", "curl_noise", "curlStrength"),
    edge("emitter_to_advection", "emitter", "emitter", "advection", "emitter"),
    edge("force_to_advection", "buoyancy", "force", "advection", "force"),
    edge("field_to_advection", "curl_noise", "field", "advection", "field"),
    edge("density_to_advection", "param_density", "value", "advection", "density"),
    edge("dissipation_to_advection", "param_dissipation", "value", "advection", "dissipation"),
    edge("simulation_to_render", "advection", "simulation", "volume_render", "simulation"),
    edge("color_to_render", "param_color", "value", "volume_render", "color"),
    edge("opacity_to_render", "param_opacity", "value", "volume_render", "opacity"),
    edge("softness_to_render", "param_softness", "value", "volume_render", "softness"),
    edge("render_to_output", "volume_render", "render", "output", "effect"),
    edge("quality_to_preset", "param_quality", "value", "quality_preset", "quality"),
    edge("position_to_transform", "param_worldPosition", "value", "transform", "position"),
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
