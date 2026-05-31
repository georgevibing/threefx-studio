import { cloneJson } from "./clone";
import { createDefaultWispySmokeParams, WISPY_SMOKE_PARAMETER_METADATA } from "./parameters";
import { defaultNodeRegistry, type NodeRegistry } from "./registry";
import { fnv1aHash, stableJson } from "./stableJson";
import {
  THREEFX_IR_SCHEMA_VERSION,
  type CompileResult,
  type Diagnostic,
  type EffectIR,
  type EffectIRConnection,
  type EffectIRNode,
  type GraphDocument,
  type QualityPreset,
  type WispySmokeBackendMode,
  type WispySmokeGridResolution,
} from "./types";
import { validateGraphDocument } from "./validation";

function topologicalNodeOrder(graph: GraphDocument): readonly string[] {
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
    indegree.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.source) || !indegree.has(edge.target)) {
      continue;
    }
    adjacency.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const queue = [...indegree.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort((left, right) => left.localeCompare(right));
  const order: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) {
      break;
    }
    order.push(id);
    for (const target of [...(adjacency.get(id) ?? [])].sort((left, right) => left.localeCompare(right))) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) {
        queue.push(target);
        queue.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  return order.length === graph.nodes.length
    ? order
    : graph.nodes.map((node) => node.id).sort((left, right) => left.localeCompare(right));
}

export function compileGraphToIR(
  graph: GraphDocument,
  registry: NodeRegistry = defaultNodeRegistry,
): CompileResult {
  const validation = validateGraphDocument(graph, registry);
  const diagnostics: readonly Diagnostic[] = validation.diagnostics;
  if (!validation.valid) {
    return { ir: null, diagnostics };
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const orderedNodes: EffectIRNode[] = topologicalNodeOrder(graph).flatMap((id) => {
    const node = nodesById.get(id);
    if (!node) {
      return [];
    }
    return [
      {
        id: node.id,
        type: node.type,
        label: node.label,
        parameters: cloneJson(node.parameters ?? {}),
      },
    ];
  });
  const connections: EffectIRConnection[] = [...graph.edges]
    .map((edge) => ({
      source: edge.source,
      sourcePort: edge.sourcePort,
      target: edge.target,
      targetPort: edge.targetPort,
    }))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));

  const parameterValues = {
    ...createDefaultWispySmokeParams(),
    ...graph.parameters,
  };

  const hashSource = stableJson({
    schemaVersion: graph.schemaVersion,
    effectType: graph.effectType,
    nodes: orderedNodes,
    connections,
    parameters: parameterValues,
  });

  const ir: EffectIR = {
    schemaVersion: THREEFX_IR_SCHEMA_VERSION,
    kind: "ThreeFXEffectIR",
    effectType: graph.effectType,
    effectName: graph.name,
    graphHash: fnv1aHash(hashSource),
    runtime: {
      backendMode: String(parameterValues.backendMode ?? "auto") as WispySmokeBackendMode,
      fallback: "compat",
      gridResolution: String(parameterValues.gridResolution ?? "medium") as WispySmokeGridResolution,
      quality: String(parameterValues.quality ?? "high") as QualityPreset,
      renderModel: "volume-raymarch",
      solver: "eulerian-fluid-grid",
    },
    parameters: WISPY_SMOKE_PARAMETER_METADATA,
    parameterValues: cloneJson(parameterValues),
    nodes: orderedNodes,
    connections,
  };

  return { ir, diagnostics };
}
