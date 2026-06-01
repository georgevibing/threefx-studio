import {
  defaultNodeRegistry,
  findNodePort,
  getDefaultParameterNodeValue,
  isEditableValuePort,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type NodeDefinition,
  type ParameterMap,
  type ParameterMetadata,
  type ParameterType,
  type ParameterValue,
  type PortDefinition,
  type PortType,
} from "@threefx/core";

export type NodeInputBindingView = {
  readonly edge: GraphEdge | null;
  readonly linked: boolean;
  readonly port: PortDefinition;
  readonly sourceLabel: string;
  readonly sourceNode: GraphNode | null;
  readonly sourcePort: PortDefinition | null;
};

export type NodeParameterEntry = {
  readonly binding: NodeInputBindingView | null;
  readonly metadata: ParameterMetadata;
  readonly port: PortDefinition;
  readonly value: ParameterValue;
};

export type NodeParameterGroup = {
  readonly group: string;
  readonly entries: readonly NodeParameterEntry[];
};

export function resolveNodeInputBindings(
  graph: GraphDocument,
  node: GraphNode,
): NodeInputBindingView[] {
  const nodesById = new Map(graph.nodes.map((entry) => [entry.id, entry]));
  const edgesByTarget = new Map(
    graph.edges.map((edge) => [`${edge.target}:${edge.targetPort}`, edge] as const),
  );
  const definition = defaultNodeRegistry.get(node.type);
  return (definition?.ports ?? [])
    .filter((port) => port.direction === "input")
    .map((port) => {
      const edge = edgesByTarget.get(`${node.id}:${port.id}`) ?? null;
      const sourceNode = edge ? (nodesById.get(edge.source) ?? null) : null;
      const sourcePort = sourceNode && edge ? findNodePort(sourceNode, edge.sourcePort) : null;
      return {
        edge,
        linked: Boolean(edge),
        port,
        sourceLabel: sourceNode?.label ?? edge?.source ?? "Unlinked",
        sourceNode,
        sourcePort,
      };
    });
}

export function formatNodeParameterValue(value: ParameterValue): string {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "number" ? entry.toFixed(2) : String(entry)))
      .join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "Enabled" : "Disabled";
  }
  return String(value ?? "");
}

export function hasNodeParameterValue(node: GraphNode, id: string): boolean {
  return Boolean(node.parameters) && Object.prototype.hasOwnProperty.call(node.parameters, id);
}

export function parameterTypeForPortType(type: PortType): ParameterType | null {
  switch (type) {
    case "bool":
    case "color":
    case "curve":
    case "float":
    case "int":
    case "quality":
    case "string":
    case "vec2":
    case "vec3":
      return type;
    default:
      return null;
  }
}

export function defaultValueForPort(port: PortDefinition): ParameterValue {
  const parameterType = parameterTypeForPortType(port.type);
  if (port.defaultValue !== undefined) {
    return port.defaultValue;
  }
  return parameterType ? getDefaultParameterNodeValue(parameterType) : null;
}

export function valueForInputPort(
  node: GraphNode,
  port: PortDefinition,
  graphParameters: ParameterMap,
): ParameterValue {
  if (hasNodeParameterValue(node, port.id)) {
    return node.parameters?.[port.id] ?? null;
  }
  if (
    port.effectParameterId &&
    Object.prototype.hasOwnProperty.call(graphParameters, port.effectParameterId)
  ) {
    return graphParameters[port.effectParameterId] ?? null;
  }
  return defaultValueForPort(port);
}

export function metadataForInputPort(port: PortDefinition): ParameterMetadata | null {
  const type = parameterTypeForPortType(port.type);
  if (!type) {
    return null;
  }
  return {
    id: port.id,
    label: port.label,
    type,
    defaultValue: defaultValueForPort(port),
    group: port.group || "Parameters",
    ...(port.description ? { description: port.description } : {}),
    ...(port.min !== undefined ? { min: port.min } : {}),
    ...(port.max !== undefined ? { max: port.max } : {}),
    ...(port.step !== undefined ? { step: port.step } : {}),
    ...(port.unit ? { unit: port.unit } : {}),
    ...(port.options ? { options: port.options } : {}),
  };
}

export function editableInputEntries(
  node: GraphNode,
  definition: NodeDefinition,
  graphParameters: ParameterMap,
  inputBindings: readonly NodeInputBindingView[],
): NodeParameterEntry[] {
  const bindingsByPort = new Map(inputBindings.map((binding) => [binding.port.id, binding]));
  return definition.ports
    .filter(isEditableValuePort)
    .map((port) => {
      const metadata = metadataForInputPort(port);
      return metadata
        ? {
            binding: bindingsByPort.get(port.id) ?? null,
            metadata,
            port,
            value: valueForInputPort(node, port, graphParameters),
          }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

export function groupParameterEntries(
  entries: readonly NodeParameterEntry[],
): NodeParameterGroup[] {
  const grouped = new Map<string, NodeParameterEntry[]>();
  for (const entry of entries) {
    const group = entry.metadata.group || "Parameters";
    grouped.set(group, [...(grouped.get(group) ?? []), entry]);
  }
  return [...grouped.entries()].map(([group, groupEntries]) => ({
    group,
    entries: groupEntries,
  }));
}
