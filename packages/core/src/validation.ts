import { canConnectPorts, formatPortType } from "./ports";
import { defaultNodeRegistry, type NodeRegistry } from "./registry";
import {
  THREEFX_GRAPH_SCHEMA_VERSION,
  type Diagnostic,
  type DiagnosticSeverity,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type PortDefinition,
  type ValidationResult,
} from "./types";

function diagnostic(
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  options: Omit<Diagnostic, "id" | "severity" | "code" | "message"> = {},
): Diagnostic {
  const suffix = options.edgeId ?? options.nodeId ?? options.path ?? "graph";
  return {
    id: `${code}:${suffix}`,
    severity,
    code,
    message,
    ...options,
  };
}

function addDuplicateDiagnostics(
  diagnostics: Diagnostic[],
  values: readonly { id: string; label: string; path: string; nodeId?: string; edgeId?: string }[],
): void {
  const seen = new Map<string, (typeof values)[number]>();
  for (const value of values) {
    if (!value.id.trim()) {
      const options: Omit<Diagnostic, "id" | "severity" | "code" | "message"> = {
        path: value.path,
        ...(value.nodeId ? { nodeId: value.nodeId } : {}),
        ...(value.edgeId ? { edgeId: value.edgeId } : {}),
      };
      diagnostics.push(
        diagnostic("error", "missing-id", `${value.label} is missing an id.`, options),
      );
      continue;
    }
    const previous = seen.get(value.id);
    if (previous) {
      const options: Omit<Diagnostic, "id" | "severity" | "code" | "message"> = {
        path: value.path,
        ...(value.nodeId ? { nodeId: value.nodeId } : {}),
        ...(value.edgeId ? { edgeId: value.edgeId } : {}),
      };
      diagnostics.push(
        diagnostic("error", "duplicate-id", `${value.label} id '${value.id}' is duplicated.`, options),
      );
    } else {
      seen.set(value.id, value);
    }
  }
}

export function getNodePorts(node: GraphNode, registry: NodeRegistry = defaultNodeRegistry): readonly PortDefinition[] {
  return registry.get(node.type)?.ports ?? [];
}

export function findNodePort(
  node: GraphNode,
  portId: string,
  registry: NodeRegistry = defaultNodeRegistry,
): PortDefinition | null {
  return getNodePorts(node, registry).find((port) => port.id === portId) ?? null;
}

function validateEdges(
  graph: GraphDocument,
  registry: NodeRegistry,
  diagnostics: Diagnostic[],
): void {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const occupiedInputs = new Set<string>();

  for (const edge of graph.edges) {
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    if (!sourceNode || !targetNode) {
      diagnostics.push(
        diagnostic("error", "broken-edge", `Edge '${edge.id}' references a missing node.`, {
          edgeId: edge.id,
          path: `edges.${edge.id}`,
        }),
      );
      continue;
    }

    const sourcePort = findNodePort(sourceNode, edge.sourcePort, registry);
    const targetPort = findNodePort(targetNode, edge.targetPort, registry);
    if (!sourcePort || !targetPort) {
      diagnostics.push(
        diagnostic("error", "missing-port", `Edge '${edge.id}' references a missing port.`, {
          edgeId: edge.id,
          path: `edges.${edge.id}`,
        }),
      );
      continue;
    }
    if (sourcePort.direction !== "output" || targetPort.direction !== "input") {
      diagnostics.push(
        diagnostic("error", "port-direction", `Edge '${edge.id}' must connect output to input.`, {
          edgeId: edge.id,
          path: `edges.${edge.id}`,
        }),
      );
    }
    if (!canConnectPorts(sourcePort, targetPort)) {
      const accepted =
        targetPort.acceptedTypes && targetPort.acceptedTypes.length > 0
          ? ` Accepted: ${targetPort.acceptedTypes.map(formatPortType).join(", ")}.`
          : "";
      diagnostics.push(
        diagnostic(
          "error",
          "port-type-mismatch",
          `Edge '${edge.id}' connects ${formatPortType(sourcePort.type)} to ${formatPortType(
            targetPort.type,
          )}.${accepted}`,
          { edgeId: edge.id, nodeId: targetNode.id, path: `edges.${edge.id}` },
        ),
      );
    }
    if (!targetPort.multiple) {
      const inputKey = `${edge.target}:${edge.targetPort}`;
      if (occupiedInputs.has(inputKey)) {
        diagnostics.push(
          diagnostic(
            "error",
            "input-port-occupied",
            `Input '${targetNode.label}.${targetPort.label}' has more than one connection.`,
            { edgeId: edge.id, nodeId: targetNode.id, path: `edges.${edge.id}` },
          ),
        );
      }
      occupiedInputs.add(inputKey);
    }
  }
}

function validateRequiredInputs(
  graph: GraphDocument,
  registry: NodeRegistry,
  diagnostics: Diagnostic[],
): void {
  const incoming = new Set(graph.edges.map((edge) => `${edge.target}:${edge.targetPort}`));
  for (const node of graph.nodes) {
    for (const port of getNodePorts(node, registry)) {
      if (port.direction !== "input" || !port.required) {
        continue;
      }
      if (!incoming.has(`${node.id}:${port.id}`)) {
        diagnostics.push(
          diagnostic(
            "error",
            "missing-required-input",
            `Node '${node.label}' is missing required input '${port.label}'.`,
            { nodeId: node.id, path: `nodes.${node.id}.ports.${port.id}` },
          ),
        );
      }
    }
  }
}

function validateCycles(graph: GraphDocument, diagnostics: Diagnostic[]): void {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (adjacency.has(edge.source) && adjacency.has(edge.target)) {
      adjacency.get(edge.source)?.push(edge.target);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) {
      const start = stack.indexOf(nodeId);
      const cycle = start >= 0 ? [...stack.slice(start), nodeId] : [nodeId];
      diagnostics.push(
        diagnostic("error", "graph-cycle", `Graph contains a cycle: ${cycle.join(" -> ")}.`, {
          nodeId,
          path: "edges",
        }),
      );
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }
    visiting.add(nodeId);
    stack.push(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  for (const node of graph.nodes) {
    if (visit(node.id)) {
      return;
    }
  }
}

function validateKnownNodes(graph: GraphDocument, registry: NodeRegistry, diagnostics: Diagnostic[]): void {
  for (const node of graph.nodes) {
    if (!registry.get(node.type)) {
      diagnostics.push(
        diagnostic("error", "unknown-node-type", `Node '${node.label}' uses unknown type '${node.type}'.`, {
          nodeId: node.id,
          path: `nodes.${node.id}.type`,
        }),
      );
    }
  }
}

function validateDocumentShape(graph: GraphDocument, diagnostics: Diagnostic[]): void {
  if (graph.schemaVersion !== THREEFX_GRAPH_SCHEMA_VERSION) {
    diagnostics.push(
      diagnostic(
        "error",
        "schema-version",
        `Graph schema version ${graph.schemaVersion} is not supported.`,
        { path: "schemaVersion" },
      ),
    );
  }
  if (graph.kind !== "ThreeFXGraph") {
    diagnostics.push(
      diagnostic("error", "graph-kind", "Graph kind must be 'ThreeFXGraph'.", { path: "kind" }),
    );
  }
  if (graph.effectType !== "wispy-smoke") {
    diagnostics.push(
      diagnostic("error", "effect-type", "Only the Wispy Smoke effect type is implemented.", {
        path: "effectType",
      }),
    );
  }
  if (graph.nodes.length === 0) {
    diagnostics.push(diagnostic("error", "empty-graph", "Graph has no nodes.", { path: "nodes" }));
  }
}

export function validateGraphDocument(
  graph: GraphDocument,
  registry: NodeRegistry = defaultNodeRegistry,
): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  validateDocumentShape(graph, diagnostics);
  addDuplicateDiagnostics(
    diagnostics,
    graph.nodes.map((node, index) => ({
      id: node.id,
      label: "Node",
      path: `nodes.${index}`,
      nodeId: node.id,
    })),
  );
  addDuplicateDiagnostics(
    diagnostics,
    graph.edges.map((edge, index) => ({
      id: edge.id,
      label: "Edge",
      path: `edges.${index}`,
      edgeId: edge.id,
    })),
  );
  validateKnownNodes(graph, registry, diagnostics);
  validateEdges(graph, registry, diagnostics);
  validateRequiredInputs(graph, registry, diagnostics);
  validateCycles(graph, diagnostics);
  return {
    graph,
    diagnostics,
    valid: diagnostics.every((entry) => entry.severity !== "error"),
  };
}

export function toGraphEdgeId(edge: Pick<GraphEdge, "source" | "sourcePort" | "target" | "targetPort">): string {
  return `edge_${edge.source}_${edge.sourcePort}_${edge.target}_${edge.targetPort}`;
}
