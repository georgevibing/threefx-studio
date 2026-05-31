import { cloneJson } from "./clone";
import { parameterTypeToPortType } from "./ports";
import { getParameterMetadata } from "./parameters";
import type {
  GraphNode,
  NodeDefinition,
  ParameterMap,
  ParameterMetadata,
  ParameterType,
  ParameterValue,
  PortDefinition,
  PortType,
  Vec2,
} from "./types";

const flowIn = { id: "flowIn", label: "In", direction: "input", type: "flow" } as const;
const flowOut = {
  id: "flowOut",
  label: "Out",
  direction: "output",
  type: "flow",
  multiple: true,
} as const;

const PARAMETER_NODE_DEFAULTS = {
  bool: false,
  color: "#ffffff",
  curve: [
    { time: 0, value: 1 },
    { time: 1, value: 1 },
  ],
  float: 0,
  int: 0,
  quality: "high",
  string: "",
  vec2: [0, 0],
  vec3: [0, 0, 0],
} as const satisfies Record<ParameterType, ParameterValue>;

const PARAMETER_NODE_LABELS = {
  bool: "Boolean",
  color: "Color",
  curve: "Curve",
  float: "Float",
  int: "Integer",
  quality: "Quality",
  string: "String",
  vec2: "Vector 2",
  vec3: "Vector 3",
} as const satisfies Record<ParameterType, string>;

const PARAMETER_NODE_OPTIONS: Partial<Record<ParameterType, readonly string[]>> = {
  quality: ["low", "medium", "high", "cinematic"],
};

function parameterNodeDefinition(type: ParameterType): NodeDefinition {
  const portType = parameterTypeToPortType(type);
  return {
    type: `parameter.${type}`,
    kind: "parameter",
    label: PARAMETER_NODE_LABELS[type],
    category: "Parameters",
    description: `Exposes a reusable ${portType} value to compatible node inputs.`,
    ports: [
      {
        id: "value",
        label: "Value",
        direction: "output",
        type: portType,
        multiple: true,
      },
    ],
    defaultParameters: {
      value: PARAMETER_NODE_DEFAULTS[type],
    },
  };
}

function wispyInput(
  id: string,
  options: Partial<Pick<PortDefinition, "acceptedTypes" | "label" | "required">> = {},
): PortDefinition {
  const parameter = getParameterMetadata(id);
  if (!parameter) {
    throw new Error(`Unknown Wispy Smoke parameter '${id}'.`);
  }
  return parameterInput(parameter, options);
}

function parameterInput(
  parameter: ParameterMetadata,
  options: Partial<Pick<PortDefinition, "acceptedTypes" | "label" | "required">> = {},
): PortDefinition {
  return {
    id: parameter.id,
    label: options.label ?? parameter.label,
    direction: "input",
    type: parameterTypeToPortType(parameter.type),
    required: options.required ?? true,
    defaultValue: parameter.defaultValue,
    effectParameterId: parameter.id,
    group: parameter.group,
    ...(options.acceptedTypes ? { acceptedTypes: options.acceptedTypes } : {}),
    ...(parameter.description ? { description: parameter.description } : {}),
    ...(parameter.min !== undefined ? { min: parameter.min } : {}),
    ...(parameter.max !== undefined ? { max: parameter.max } : {}),
    ...(parameter.step !== undefined ? { step: parameter.step } : {}),
    ...(parameter.unit ? { unit: parameter.unit } : {}),
    ...(parameter.options ? { options: parameter.options } : {}),
  };
}

function defaultParametersForDefinition(definition: NodeDefinition): ParameterMap {
  const portDefaults = Object.fromEntries(
    definition.ports
      .filter((port) => port.direction === "input" && port.defaultValue !== undefined)
      .map((port) => [port.id, port.defaultValue]),
  ) as ParameterMap;
  return cloneJson({
    ...portDefaults,
    ...(definition.defaultParameters ?? {}),
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
    description: "Defines the spherical density and temperature source for the fluid grid.",
    ports: [
      flowIn,
      flowOut,
      wispyInput("spawnRate", { label: "Spawn" }),
      wispyInput("lifetime", { label: "Life" }),
      wispyInput("radius"),
      wispyInput("height"),
      wispyInput("sourceTemperature", { label: "Source Temp" }),
      { id: "emitter", label: "Emitter", direction: "output", type: "emitter", multiple: true },
    ],
  },
  {
    type: "noise.curl",
    kind: "noise",
    label: "Curl Noise",
    category: "Fields",
    description: "Procedural turbulence and vorticity controls for fluid-grid motion.",
    ports: [
      wispyInput("turbulence"),
      wispyInput("turbulenceBands", { label: "Bands" }),
      wispyInput("curlStrength", { label: "Curl" }),
      wispyInput("vorticityConfinement", { label: "Vorticity" }),
      { id: "field", label: "Field", direction: "output", type: "field", multiple: true },
    ],
  },
  {
    type: "force.buoyancy",
    kind: "force",
    label: "Buoyancy Force",
    category: "Forces",
    description: "Applies upward velocity and optional wind.",
    ports: [
      { id: "emitter", label: "Emitter", direction: "input", type: "emitter", required: true },
      wispyInput("riseSpeed", { label: "Rise" }),
      wispyInput("buoyantLift", { label: "Lift" }),
      wispyInput("wind"),
      { id: "force", label: "Force", direction: "output", type: "force", multiple: true },
    ],
  },
  {
    type: "simulation.advection",
    kind: "simulation",
    label: "3D Fluid Solver",
    category: "Simulation",
    description:
      "Runs Eulerian grid advection, vorticity, pressure projection, diffusion, and dissipation.",
    ports: [
      flowIn,
      flowOut,
      { id: "emitter", label: "Emitter", direction: "input", type: "emitter", required: true },
      { id: "force", label: "Force", direction: "input", type: "force", required: true },
      { id: "field", label: "Field", direction: "input", type: "field", required: true },
      wispyInput("density"),
      wispyInput("densityDissipation"),
      wispyInput("velocityDissipation"),
      wispyInput("dissipation"),
      wispyInput("diffusion"),
      wispyInput("pressureIterations", { label: "Pressure" }),
      wispyInput("seed"),
      {
        id: "simulation",
        label: "Simulation",
        direction: "output",
        type: "simulation",
        multiple: true,
      },
    ],
  },
  {
    type: "render.volume",
    kind: "render",
    label: "Volume Render",
    category: "Render",
    description: "Raymarches simulated density and temperature with absorption and scattering.",
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
      wispyInput("color", { label: "Tint" }),
      wispyInput("opacity"),
      wispyInput("softness", { label: "Soft" }),
      wispyInput("size"),
      wispyInput("baseDensity", { label: "Base" }),
      wispyInput("opacityRamp", { label: "Ramp" }),
      wispyInput("plumeTaper", { label: "Taper" }),
      wispyInput("emissionColor", { label: "Emission" }),
      wispyInput("emissionIntensity", { label: "Glow" }),
      wispyInput("absorption"),
      wispyInput("scattering"),
      wispyInput("detailScale", { label: "Detail Scale" }),
      wispyInput("detailStrength", { label: "Detail" }),
      wispyInput("detailSpeed", { label: "Detail Speed" }),
      wispyInput("renderStepScale", { label: "Step Scale" }),
      wispyInput("shadowQuality", { label: "Shadows" }),
      { id: "render", label: "Render", direction: "output", type: "render", multiple: true },
    ],
  },
  {
    type: "transform.object",
    kind: "transform",
    label: "Transform",
    category: "Transform",
    description: "Places the generated effect object in world space.",
    ports: [
      wispyInput("worldPosition", { label: "Position" }),
      {
        id: "transform",
        label: "Transform",
        direction: "output",
        type: "transform",
        multiple: true,
      },
    ],
  },
  {
    type: "quality.preset",
    kind: "quality",
    label: "Quality Preset",
    category: "Runtime",
    description: "Selects backend and runtime budget for the exported smoke effect.",
    ports: [
      wispyInput("quality"),
      wispyInput("backendMode", { label: "Backend" }),
      wispyInput("gridResolution", { label: "Grid" }),
      { id: "preset", label: "Preset", direction: "output", type: "quality", multiple: true },
    ],
  },
  parameterNodeDefinition("float"),
  parameterNodeDefinition("int"),
  parameterNodeDefinition("bool"),
  parameterNodeDefinition("string"),
  parameterNodeDefinition("color"),
  parameterNodeDefinition("vec2"),
  parameterNodeDefinition("vec3"),
  parameterNodeDefinition("curve"),
  parameterNodeDefinition("quality"),
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
          ...defaultParametersForDefinition(definition),
          ...(parameters ?? {}),
        }),
      };
    },
  };
}

export function isEditableValuePort(port: PortDefinition): boolean {
  if (port.direction !== "input") {
    return false;
  }
  const primitiveTypes = new Set<PortType>([
    "bool",
    "color",
    "curve",
    "float",
    "int",
    "quality",
    "string",
    "vec2",
    "vec3",
  ]);
  return primitiveTypes.has(port.type) && (port.defaultValue !== undefined || Boolean(port.effectParameterId));
}

export function getParameterNodeValueType(type: string): ParameterType | null {
  if (!type.startsWith("parameter.")) {
    return null;
  }
  const suffix = type.slice("parameter.".length);
  return suffix in PARAMETER_NODE_DEFAULTS ? (suffix as ParameterType) : null;
}

export function getDefaultParameterNodeValue(type: ParameterType): ParameterValue {
  return cloneJson(PARAMETER_NODE_DEFAULTS[type]);
}

export function getParameterNodeOptions(type: ParameterType): readonly string[] | undefined {
  return PARAMETER_NODE_OPTIONS[type];
}

export const defaultNodeRegistry = createNodeRegistry();
