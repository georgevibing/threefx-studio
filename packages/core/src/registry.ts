import { cloneJson } from "./clone";
import { parameterTypeToPortType } from "./ports";
import { WISPY_SMOKE_PARAMETER_METADATA } from "./parameters";
import type { GraphNode, NodeDefinition, ParameterMetadata, ParameterMap, Vec2 } from "./types";

const flowIn = { id: "flowIn", label: "In", direction: "input", type: "flow" } as const;
const flowOut = {
  id: "flowOut",
  label: "Out",
  direction: "output",
  type: "flow",
  multiple: true,
} as const;

function parameterNodeDefinition(parameter: ParameterMetadata): NodeDefinition {
  return {
    type: `parameter.${parameter.id}`,
    kind: "parameter",
    label: parameter.label,
    category: "Parameters",
    description: parameter.description ?? `Exposes the ${parameter.label} parameter to the graph.`,
    ports: [
      {
        id: "value",
        label: "Value",
        direction: "output",
        type: parameterTypeToPortType(parameter.type),
        multiple: true,
      },
    ],
    defaultParameters: {
      parameterId: parameter.id,
      value: parameter.defaultValue,
    },
    parameterMetadata: [parameter],
  };
}

function parameters(...ids: string[]): readonly ParameterMetadata[] {
  const byId = new Map(
    WISPY_SMOKE_PARAMETER_METADATA.map((parameter) => [parameter.id, parameter]),
  );
  return ids.flatMap((id) => {
    const parameter = byId.get(id);
    return parameter ? [parameter] : [];
  });
}

export const DEFAULT_NODE_DEFINITIONS: readonly NodeDefinition[] = [
  {
    type: "output.three-webgpu",
    kind: "output",
    label: "Three WebGPU Output",
    category: "Output",
    description: "Final effect output consumed by preview and exporter.",
    ports: [
      flowIn,
      { id: "effect", label: "Effect", direction: "input", type: "render", required: true },
    ],
  },
  {
    type: "emitter.volume",
    kind: "emitter",
    label: "Emitter",
    category: "Emission",
    description: "Defines a low-resolution volumetric particle source.",
    ports: [
      flowIn,
      flowOut,
      { id: "spawnRate", label: "Spawn", direction: "input", type: "float", required: true },
      { id: "lifetime", label: "Life", direction: "input", type: "float", required: true },
      { id: "radius", label: "Radius", direction: "input", type: "float" },
      { id: "emitter", label: "Emitter", direction: "output", type: "emitter", multiple: true },
    ],
    defaultParameters: {
      radius: 0.38,
    },
    parameterMetadata: parameters("spawnRate", "lifetime", "radius", "height"),
  },
  {
    type: "noise.curl",
    kind: "noise",
    label: "Curl Noise",
    category: "Fields",
    description: "Procedural turbulence field used for wispy lateral motion.",
    ports: [
      { id: "turbulence", label: "Turbulence", direction: "input", type: "float", required: true },
      { id: "curlStrength", label: "Curl", direction: "input", type: "float", required: true },
      { id: "field", label: "Field", direction: "output", type: "field", multiple: true },
    ],
    parameterMetadata: parameters("turbulence", "curlStrength"),
  },
  {
    type: "force.buoyancy",
    kind: "force",
    label: "Buoyancy Force",
    category: "Forces",
    description: "Applies upward velocity and optional wind.",
    ports: [
      { id: "emitter", label: "Emitter", direction: "input", type: "emitter", required: true },
      { id: "riseSpeed", label: "Rise", direction: "input", type: "float", required: true },
      { id: "wind", label: "Wind", direction: "input", type: "vec3" },
      { id: "force", label: "Force", direction: "output", type: "force", multiple: true },
    ],
    parameterMetadata: parameters("riseSpeed", "wind"),
  },
  {
    type: "simulation.advection",
    kind: "simulation",
    label: "Advection",
    category: "Simulation",
    description: "Combines emission, buoyancy, turbulence, and dissipation into an effect field.",
    ports: [
      flowIn,
      flowOut,
      { id: "emitter", label: "Emitter", direction: "input", type: "emitter", required: true },
      { id: "force", label: "Force", direction: "input", type: "force", required: true },
      { id: "field", label: "Field", direction: "input", type: "field", required: true },
      { id: "density", label: "Density", direction: "input", type: "float", required: true },
      {
        id: "dissipation",
        label: "Dissipation",
        direction: "input",
        type: "float",
        required: true,
      },
      {
        id: "simulation",
        label: "Simulation",
        direction: "output",
        type: "simulation",
        multiple: true,
      },
    ],
    parameterMetadata: parameters("density", "dissipation", "seed"),
  },
  {
    type: "render.volume",
    kind: "render",
    label: "Volume Render",
    category: "Render",
    description: "Renders a layered volume impostor with procedural detail.",
    ports: [
      flowIn,
      flowOut,
      {
        id: "simulation",
        label: "Simulation",
        direction: "input",
        type: "simulation",
        required: true,
      },
      { id: "color", label: "Color", direction: "input", type: "color", required: true },
      { id: "opacity", label: "Opacity", direction: "input", type: "float", required: true },
      { id: "softness", label: "Soft", direction: "input", type: "float", required: true },
      { id: "render", label: "Render", direction: "output", type: "render", multiple: true },
    ],
    parameterMetadata: parameters("size", "opacity", "softness", "color", "warmGlow"),
  },
  {
    type: "transform.object",
    kind: "transform",
    label: "Transform",
    category: "Transform",
    description: "Places the generated effect object in world space.",
    ports: [
      { id: "position", label: "Position", direction: "input", type: "vec3" },
      {
        id: "transform",
        label: "Transform",
        direction: "output",
        type: "transform",
        multiple: true,
      },
    ],
    parameterMetadata: parameters("worldPosition"),
  },
  {
    type: "quality.preset",
    kind: "quality",
    label: "Quality Preset",
    category: "Runtime",
    description: "Selects runtime budget and generated smoke sprite detail.",
    ports: [
      { id: "quality", label: "Quality", direction: "input", type: "quality", required: true },
      { id: "preset", label: "Preset", direction: "output", type: "quality", multiple: true },
    ],
    parameterMetadata: parameters("quality"),
  },
  ...WISPY_SMOKE_PARAMETER_METADATA.map(parameterNodeDefinition),
];

export interface NodeRegistry {
  list(): readonly NodeDefinition[];
  get(type: string): NodeDefinition | null;
  instantiate(type: string, id: string, position: Vec2, parameters?: ParameterMap): GraphNode;
}

export function createNodeRegistry(
  definitions: readonly NodeDefinition[] = DEFAULT_NODE_DEFINITIONS,
): NodeRegistry {
  const entries = new Map(definitions.map((definition) => [definition.type, definition]));
  return {
    list: () => [...entries.values()],
    get: (type) => entries.get(type) ?? null,
    instantiate(type, id, position, parameters) {
      const definition = entries.get(type);
      if (!definition) {
        throw new Error(`Unknown node type '${type}'.`);
      }
      return {
        id,
        type,
        label: definition.label,
        position,
        enabled: true,
        parameters: cloneJson({
          ...(definition.defaultParameters ?? {}),
          ...(parameters ?? {}),
        }),
      };
    },
  };
}

export const defaultNodeRegistry = createNodeRegistry();
