import { cloneJson } from "./clone";
import { createDefaultWispySmokeParams } from "./parameters";
import { defaultNodeRegistry, isEditableValuePort, type NodeRegistry } from "./registry";
import type { GraphDocument, GraphEdge, GraphNode, ParameterMap, ParameterValue } from "./types";

function hasParameterValue(
  parameters: ParameterMap | undefined,
  id: string,
): parameters is ParameterMap {
  return Boolean(parameters) && Object.prototype.hasOwnProperty.call(parameters, id);
}

export function incomingEdgeByTarget(graph: GraphDocument): Map<string, GraphEdge> {
  const result = new Map<string, GraphEdge>();
  for (const edge of [...graph.edges].sort((left, right) => left.id.localeCompare(right.id))) {
    const key = `${edge.target}:${edge.targetPort}`;
    if (!result.has(key)) {
      result.set(key, edge);
    }
  }
  return result;
}

export function sourceValue(
  edge: GraphEdge,
  nodesById: ReadonlyMap<string, GraphNode>,
  registry: NodeRegistry,
): ParameterValue | undefined {
  const source = nodesById.get(edge.source);
  const sourceDefinition = source ? registry.get(source.type) : null;
  if (!source || sourceDefinition?.kind !== "parameter") {
    return undefined;
  }
  if (hasParameterValue(source.parameters, edge.sourcePort)) {
    return cloneJson(source.parameters[edge.sourcePort]);
  }
  if (edge.sourcePort === "value" && hasParameterValue(source.parameters, "value")) {
    return cloneJson(source.parameters["value"]);
  }
  return undefined;
}

export function resolveNodeInputValues(
  graph: GraphDocument,
  node: GraphNode,
  registry: NodeRegistry = defaultNodeRegistry,
): ParameterMap {
  const definition = registry.get(node.type);
  if (!definition) {
    return cloneJson(node.parameters ?? {});
  }
  const values: ParameterMap = cloneJson(node.parameters ?? {});
  const nodesById = new Map(graph.nodes.map((entry) => [entry.id, entry]));
  const incoming = incomingEdgeByTarget(graph);
  for (const port of definition.ports) {
    if (!isEditableValuePort(port)) {
      continue;
    }
    const edge = incoming.get(`${node.id}:${port.id}`);
    if (edge) {
      const value = sourceValue(edge, nodesById, registry);
      if (value !== undefined) {
        values[port.id] = value;
      }
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(values, port.id) && port.defaultValue !== undefined) {
      values[port.id] = cloneJson(port.defaultValue);
    }
  }
  return values;
}

export function resolveWispySmokeParameterValues(
  graph: GraphDocument,
  registry: NodeRegistry = defaultNodeRegistry,
): ParameterMap {
  const values: ParameterMap = cloneJson({
    ...createDefaultWispySmokeParams(),
    ...graph.parameters,
  });
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = incomingEdgeByTarget(graph);
  const nodes = [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id));

  for (const node of nodes) {
    const definition = registry.get(node.type);
    if (!definition) {
      continue;
    }
    for (const port of definition.ports) {
      if (!isEditableValuePort(port) || !port.effectParameterId) {
        continue;
      }
      const edge = incoming.get(`${node.id}:${port.id}`);
      if (edge) {
        const value = sourceValue(edge, nodesById, registry);
        if (value !== undefined) {
          values[port.effectParameterId] = value;
        }
        continue;
      }
      if (hasParameterValue(node.parameters, port.id)) {
        const value = node.parameters[port.id];
        if (value !== undefined) {
          values[port.effectParameterId] = cloneJson(value);
        }
        continue;
      }
      if (hasParameterValue(graph.parameters, port.effectParameterId)) {
        continue;
      }
      if (port.defaultValue !== undefined) {
        values[port.effectParameterId] = cloneJson(port.defaultValue);
      }
    }
  }

  return values;
}
