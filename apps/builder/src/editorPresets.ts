import {
  createWispySmokeGraph,
  validateGraphDocument,
  type GraphDocument,
  type GraphNode,
  type ParameterValue,
} from "@threefx/core";

export type EditorPresetId = "wispy-smoke" | "fast-draft" | "tall-plume" | "soft-haze";

export type EditorPreset = {
  readonly description: string;
  readonly id: EditorPresetId;
  readonly name: string;
  readonly summary: string;
};

export const EDITOR_PRESETS: readonly EditorPreset[] = [
  {
    id: "wispy-smoke",
    name: "Wispy Smoke",
    summary: "Balanced vertical slice",
    description: "Default production graph with all core smoke, simulation, render, and export nodes.",
  },
  {
    id: "fast-draft",
    name: "Fast Draft",
    summary: "Low-cost iteration",
    description: "Lighter grid and lower density for quick parameter exploration on slower machines.",
  },
  {
    id: "tall-plume",
    name: "Tall Plume",
    summary: "Energetic column",
    description: "Higher lift, curl, and density for a taller rising smoke column.",
  },
  {
    id: "soft-haze",
    name: "Soft Haze",
    summary: "Wide translucent volume",
    description: "Lower opacity and broader source radius for soft atmospheric smoke.",
  },
];

const PARAMETER_NODE_BY_ID: Record<string, string> = {
  color: "param_color",
  curlStrength: "param_curlStrength",
  density: "param_density",
  opacity: "param_opacity",
  quality: "param_quality",
  radius: "param_radius",
  riseSpeed: "param_riseSpeed",
  spawnRate: "param_spawnRate",
  turbulence: "param_turbulence",
  worldPosition: "param_worldPosition",
};

function updateParameterNode(
  node: GraphNode,
  parameterValues: Readonly<Record<string, ParameterValue>>,
): GraphNode {
  const entry = Object.entries(PARAMETER_NODE_BY_ID).find(([, nodeId]) => nodeId === node.id);
  if (!entry) {
    return node;
  }
  const [parameterId] = entry;
  const value = parameterValues[parameterId];
  if (value === undefined) {
    return node;
  }
  return {
    ...node,
    parameters: {
      ...(node.parameters ?? {}),
      value,
    },
  };
}

function withParameterValues(
  graph: GraphDocument,
  name: string,
  values: Readonly<Record<string, ParameterValue>>,
): GraphDocument {
  const parameters = {
    ...graph.parameters,
    ...values,
  };
  return {
    ...graph,
    name,
    parameters,
    nodes: graph.nodes.map((node) => updateParameterNode(node, values)),
  };
}

function createFastDraftPreset(): GraphDocument {
  return withParameterValues(createWispySmokeGraph(), "Fast Draft Smoke", {
    curlStrength: 0.65,
    density: 0.62,
    opacity: 0.68,
    quality: "low",
    radius: 0.32,
    riseSpeed: 1.35,
    spawnRate: 540,
    turbulence: 0.85,
  });
}

function createTallPlumePreset(): GraphDocument {
  return withParameterValues(createWispySmokeGraph(), "Tall Plume Smoke", {
    color: "#d7e4ea",
    curlStrength: 1.7,
    density: 1.15,
    opacity: 0.92,
    quality: "high",
    radius: 0.34,
    riseSpeed: 2.45,
    spawnRate: 1650,
    turbulence: 2.15,
  });
}

function createSoftHazePreset(): GraphDocument {
  return withParameterValues(createWispySmokeGraph(), "Soft Haze Smoke", {
    color: "#b9c7ca",
    curlStrength: 0.4,
    density: 0.45,
    opacity: 0.42,
    quality: "medium",
    radius: 0.72,
    riseSpeed: 1.05,
    spawnRate: 720,
    turbulence: 0.55,
  });
}

export function createEditorPresetGraph(presetId: EditorPresetId): GraphDocument {
  switch (presetId) {
    case "fast-draft":
      return createFastDraftPreset();
    case "tall-plume":
      return createTallPlumePreset();
    case "soft-haze":
      return createSoftHazePreset();
    case "wispy-smoke":
      return createWispySmokeGraph();
  }
}

export function getEditorPreset(presetId: EditorPresetId): EditorPreset {
  const preset = EDITOR_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) {
    throw new Error(`Unknown editor preset '${presetId}'.`);
  }
  return preset;
}

export function validateEditorPresetGraphs(): void {
  for (const preset of EDITOR_PRESETS) {
    const result = validateGraphDocument(createEditorPresetGraph(preset.id));
    if (!result.valid) {
      throw new Error(`Invalid editor preset '${preset.id}'.`);
    }
  }
}
