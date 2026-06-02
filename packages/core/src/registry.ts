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
  quality: "medium",
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

const PARAMETER_NODE_OPTIONS = {
  quality: ["low", "medium", "high", "cinematic"],
} as const satisfies Partial<Record<ParameterType, readonly string[]>>;

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
  options: Partial<Pick<PortDefinition, "acceptedTypes" | "label" | "multiple" | "required">> = {},
): PortDefinition {
  const parameter = getParameterMetadata(id);
  if (!parameter) {
    throw new Error(`Unknown Wispy Smoke parameter '${id}'.`);
  }
  return parameterInput(parameter, options);
}

function parameterInput(
  parameter: ParameterMetadata,
  options: Partial<Pick<PortDefinition, "acceptedTypes" | "label" | "multiple" | "required">> = {},
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
    ...(options.multiple !== undefined ? { multiple: options.multiple } : {}),
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

const emitterPorts = [
  flowIn,
  flowOut,
  wispyInput("spawnRate", { label: "Injection" }),
  wispyInput("lifetime", { label: "Life" }),
  wispyInput("density"),
  wispyInput("radius"),
  wispyInput("sourcePosition", { label: "Position" }),
  wispyInput("sourceScale", { label: "Scale" }),
  wispyInput("sourceVelocity", { label: "Velocity" }),
  wispyInput("coreTemperature", { label: "Core Temp" }),
  wispyInput("sourceFalloff", { label: "Falloff" }),
  wispyInput("sourceNoiseScale", { label: "Noise Scale" }),
  wispyInput("sourceNoiseStrength", { label: "Noise" }),
  { id: "emitter", label: "Emitter", direction: "output", type: "emitter", multiple: true },
] as const satisfies readonly PortDefinition[];

const smokeEmitterPorts = [
  flowIn,
  flowOut,
  wispyInput("spawnRate", { label: "Injection" }),
  wispyInput("lifetime", { label: "Life" }),
  wispyInput("density"),
  wispyInput("radius"),
  wispyInput("sourcePosition", { label: "Position" }),
  wispyInput("sourceScale", { label: "Scale" }),
  wispyInput("sourceVelocity", { label: "Velocity" }),
  wispyInput("sourceFalloff", { label: "Falloff" }),
  wispyInput("sourceNoiseScale", { label: "Noise Scale" }),
  wispyInput("sourceNoiseStrength", { label: "Noise" }),
  { id: "emitter", label: "Emitter", direction: "output", type: "emitter", multiple: true },
] as const satisfies readonly PortDefinition[];

const heatEmitterPorts = [
  flowIn,
  flowOut,
  wispyInput("coreTemperature", { label: "Core Temp" }),
  wispyInput("radius"),
  wispyInput("sourcePosition", { label: "Position" }),
  wispyInput("sourceScale", { label: "Scale" }),
  wispyInput("sourceFalloff", { label: "Falloff" }),
  wispyInput("sourceNoiseScale", { label: "Noise Scale" }),
  wispyInput("sourceNoiseStrength", { label: "Noise" }),
  { id: "emitter", label: "Emitter", direction: "output", type: "emitter", multiple: true },
] as const satisfies readonly PortDefinition[];

export const DEFAULT_NODE_DEFINITIONS: readonly NodeDefinition[] = [
  {
    type: "output.three-webgpu",
    kind: "output",
    label: "Three WebGPU Output",
    category: "Output",
    description: "Final effect output consumed by preview and exporter.",
    ports: [
      flowIn,
      { id: "effect", label: "Effect", direction: "input", type: "render", required: true, multiple: true },
    ],
  },
  {
    type: "emitter.sphere",
    kind: "emitter",
    label: "Sphere Emitter",
    category: "Emission",
    description: "Injects density, temperature, and initial velocity from a spherical source.",
    ports: emitterPorts,
  },
  {
    type: "emitter.smoke",
    kind: "emitter",
    label: "Smoke Source",
    category: "Emission",
    description: "Injects smoke density and slight initial velocity into a shared fluid grid.",
    ports: smokeEmitterPorts,
  },
  {
    type: "emitter.heat",
    kind: "emitter",
    label: "Heat Source",
    category: "Emission",
    description: "Injects temperature into a shared fluid grid without adding smoke density.",
    ports: heatEmitterPorts,
  },
  {
    type: "emitter.box",
    kind: "emitter",
    label: "Box Emitter",
    category: "Emission",
    description: "Injects density, temperature, and initial velocity from a box source.",
    ports: emitterPorts,
  },
  {
    type: "field.curl",
    kind: "field",
    label: "Curl Field",
    category: "Fields",
    description: "Adds procedural curl and vorticity controls for fluid-grid motion.",
    ports: [
      wispyInput("turbulence"),
      wispyInput("turbulenceBands", { label: "Bands" }),
      wispyInput("curlStrength", { label: "Curl" }),
      wispyInput("vorticityConfinement", { label: "Vorticity" }),
      wispyInput("detailScale", { label: "Scale" }),
      wispyInput("detailSpeed", { label: "Speed" }),
      { id: "field", label: "Field", direction: "output", type: "field", multiple: true },
    ],
  },
  {
    type: "field.fbm",
    kind: "field",
    label: "fBm Detail Field",
    category: "Fields",
    description: "Provides multi-octave detail modulation shared by simulation and rendering.",
    ports: [
      wispyInput("detailScale", { label: "Scale" }),
      wispyInput("detailStrength", { label: "Strength" }),
      wispyInput("detailSpeed", { label: "Speed" }),
      wispyInput("detailOctaves", { label: "Octaves" }),
      { id: "field", label: "Field", direction: "output", type: "field", multiple: true },
    ],
  },
  {
    type: "force.buoyancy",
    kind: "force",
    label: "Buoyancy Force",
    category: "Forces",
    description: "Applies heat-driven upward velocity and directional wind.",
    ports: [
      { id: "emitter", label: "Emitter", direction: "input", type: "emitter", required: false, multiple: true },
      wispyInput("riseSpeed", { label: "Rise" }),
      wispyInput("buoyantLift", { label: "Lift" }),
      wispyInput("wind"),
      { id: "force", label: "Force", direction: "output", type: "force", multiple: true },
    ],
  },
  {
    type: "force.wind",
    kind: "force",
    label: "Wind Force",
    category: "Forces",
    description: "Applies a directional velocity bias to active smoke.",
    ports: [
      wispyInput("wind"),
      { id: "force", label: "Force", direction: "output", type: "force", multiple: true },
    ],
  },
  {
    type: "force.vortex",
    kind: "force",
    label: "Vortex Force",
    category: "Forces",
    description: "Adds a local signed swirl force around a configurable center.",
    ports: [
      wispyInput("vortexPosition", { label: "Position" }),
      wispyInput("vortexRadius", { label: "Radius" }),
      wispyInput("vortexStrength", { label: "Strength" }),
      { id: "force", label: "Force", direction: "output", type: "force", multiple: true },
    ],
  },
  {
    type: "obstacle.sphere",
    kind: "obstacle",
    label: "Sphere Obstacle",
    category: "Obstacles",
    description: "Masks velocity and density against a spherical solid boundary.",
    ports: [
      wispyInput("obstaclePosition", { label: "Position" }),
      wispyInput("obstacleRadius", { label: "Radius" }),
      wispyInput("obstacleScale", { label: "Scale" }),
      wispyInput("obstacleSoftness", { label: "Softness" }),
      { id: "obstacle", label: "Obstacle", direction: "output", type: "obstacle", multiple: true },
    ],
  },
  {
    type: "obstacle.box",
    kind: "obstacle",
    label: "Box Obstacle",
    category: "Obstacles",
    description: "Masks velocity and density against a box-shaped solid boundary.",
    ports: [
      wispyInput("obstaclePosition", { label: "Position" }),
      wispyInput("obstacleScale", { label: "Scale" }),
      wispyInput("obstacleSoftness", { label: "Softness" }),
      { id: "obstacle", label: "Obstacle", direction: "output", type: "obstacle", multiple: true },
    ],
  },
  {
    type: "simulation.fluid-grid",
    kind: "simulation",
    label: "3D Fluid Solver",
    category: "Simulation",
    description: "Runs Eulerian grid source injection, advection, diffusion, vorticity, projection, and packing.",
    ports: [
      flowIn,
      flowOut,
      { id: "emitter", label: "Emitters", direction: "input", type: "emitter", required: true, multiple: true },
      { id: "force", label: "Forces", direction: "input", type: "force", required: false, multiple: true },
      { id: "field", label: "Fields", direction: "input", type: "field", required: false, multiple: true },
      { id: "obstacle", label: "Obstacles", direction: "input", type: "obstacle", required: false, multiple: true },
      wispyInput("densityDissipation", { label: "Density Fade" }),
      wispyInput("velocityDissipation", { label: "Velocity Fade" }),
      wispyInput("diffusion"),
      wispyInput("diffusionIterations", { label: "Diffusion Steps" }),
      wispyInput("pressureIterations", { label: "Pressure" }),
      wispyInput("advectionMode", { label: "Advection" }),
      wispyInput("seed"),
      wispyInput("quality"),
      wispyInput("backendMode", { label: "Backend" }),
      wispyInput("gridResolution", { label: "Grid" }),
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
    label: "Volume Renderer",
    category: "Render",
    description: "Raymarches simulated density and temperature with configurable absorption and scattering.",
    ports: [
      flowIn,
      flowOut,
      { id: "simulation", label: "Simulation", direction: "input", type: "simulation", required: true },
      wispyInput("color", { label: "Tint" }),
      wispyInput("opacity"),
      wispyInput("softness", { label: "Soft" }),
      wispyInput("size"),
      wispyInput("height"),
      wispyInput("baseDensity", { label: "Base" }),
      wispyInput("opacityRamp", { label: "Ramp" }),
      wispyInput("plumeTaper", { label: "Taper" }),
      wispyInput("emissionColor", { label: "Emission" }),
      wispyInput("emissionIntensity", { label: "Glow" }),
      wispyInput("emissionThreshold", { label: "Emission Threshold" }),
      wispyInput("absorption"),
      wispyInput("scattering"),
      wispyInput("detailScale", { label: "Detail Scale" }),
      wispyInput("detailStrength", { label: "Detail" }),
      wispyInput("detailSpeed", { label: "Detail Speed" }),
      wispyInput("detailOctaves", { label: "Octaves" }),
      wispyInput("flowWarpStrength", { label: "Flow Warp" }),
      wispyInput("lightDirection", { label: "Light Dir" }),
      wispyInput("phaseAnisotropy", { label: "Phase" }),
      wispyInput("shadowQuality", { label: "Shadow Steps" }),
      wispyInput("shadowStrength", { label: "Shadow" }),
      wispyInput("renderStepScale", { label: "Step Scale" }),
      wispyInput("blendMode", { label: "Blend" }),
      wispyInput("renderOrder", { label: "Order" }),
      { id: "render", label: "Render", direction: "output", type: "render", multiple: true },
    ],
  },
  {
    type: "render.composite",
    kind: "render",
    label: "Composite Output",
    category: "Render",
    description: "Orders render layers and applies optional bloom and tone mapping at the final stage.",
    ports: [
      flowIn,
      flowOut,
      { id: "layers", label: "Layers", direction: "input", type: "render", required: true, multiple: true },
      wispyInput("bloomEnabled", { label: "Bloom" }),
      wispyInput("bloomThreshold", { label: "Threshold" }),
      wispyInput("bloomStrength", { label: "Strength" }),
      wispyInput("bloomRadius", { label: "Radius" }),
      wispyInput("toneMapping", { label: "Tone Map" }),
      { id: "render", label: "Render", direction: "output", type: "render", multiple: true },
    ],
  },
  {
    type: "debug.view",
    kind: "debug",
    label: "Fluid Debug View",
    category: "Debug",
    description: "Selects final or diagnostic views for density, velocity, pressure, obstacles, and bounds.",
    ports: [
      { id: "simulation", label: "Simulation", direction: "input", type: "simulation", required: true },
      wispyInput("debugView", { label: "View" }),
      { id: "render", label: "Debug", direction: "output", type: "render", multiple: true },
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
    description: "Chooses grid, raymarch, and fallback runtime budgets.",
    ports: [
      wispyInput("quality"),
      wispyInput("gridResolution", { label: "Grid" }),
      wispyInput("backendMode", { label: "Backend" }),
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
  return type === "quality" ? PARAMETER_NODE_OPTIONS.quality : undefined;
}

export const defaultNodeRegistry = createNodeRegistry();
