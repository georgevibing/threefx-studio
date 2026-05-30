import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleAlert,
  Clipboard,
  Copy,
  Download,
  FileDown,
  FolderOpen,
  Keyboard,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  canConnectPorts,
  compileGraphToIR,
  createWispySmokeGraph,
  defaultNodeRegistry,
  deserializeGraphDocument,
  findNodePort,
  serializeGraphDocument,
  toGraphEdgeId,
  validateGraphDocument,
  type Diagnostic,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type NodeDefinition,
  type ParameterMetadata,
  type ParameterMap,
  type ParameterValue,
  type PortDefinition,
  type PortType,
} from "@threefx/core";
import { WispySmokeVFX, type WispySmokeVFXParams, type WispySmokeVFXStats } from "@threefx/effects";
import { createExportZip, exportEffectToTypeScript } from "@threefx/exporter";
import { getWebGPUFeatureStatus } from "@threefx/runtime";
import { getPortTypeTone } from "@threefx/ui";

type FlowNodeData = {
  readonly definition: NodeDefinition;
  readonly connectedPorts: ReadonlySet<string>;
  readonly parameterValues: ParameterMap;
  readonly onParameterChange: (id: string, value: ParameterValue) => void;
};

type FlowNode = Node<FlowNodeData, "threefxNode">;
type FlowEdge = Edge;

type PreviewPerformanceStats = WispySmokeVFXStats & {
  readonly fps: number;
  readonly frameMs: number;
};

type QuickAddMode =
  | { readonly kind: "free" }
  | { readonly kind: "fromOutput"; readonly nodeId: string; readonly portId: string }
  | { readonly kind: "fromInput"; readonly nodeId: string; readonly portId: string };

type QuickAddState = {
  readonly screen: { readonly x: number; readonly y: number };
  readonly flow: { readonly x: number; readonly y: number };
  readonly mode: QuickAddMode;
};

type AutoLayoutNodeSize = {
  readonly width: number;
  readonly height: number;
};

type EditorSnapshot = {
  readonly graph: GraphDocument;
  readonly selectedEdgeIds: readonly string[];
  readonly selectedNodeIds: readonly string[];
  readonly status: string;
};

type PreviewTelemetry = PreviewPerformanceStats & {
  readonly webgpuSupported: boolean;
  readonly webgpuLabel: string;
};

type NodeMenuState = {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
};

type SelectionDragState = {
  readonly active: boolean;
  readonly additive: boolean;
  readonly current: { readonly x: number; readonly y: number };
  readonly pointerId: number;
  readonly start: { readonly x: number; readonly y: number };
};

const LOCAL_STORAGE_KEY = "threefx-studio:wispy-smoke-graph";
const EMPTY_PREVIEW_STATS: PreviewPerformanceStats = {
  activeParticles: 0,
  fps: 0,
  frameMs: 0,
  maxParticles: 0,
};
const HISTORY_LIMIT = 100;
const QUICK_ADD_WIDTH = 280;
const QUICK_ADD_ANCHOR_Y = 42;
const SELECTION_DRAG_THRESHOLD = 4;
const AUTO_LAYOUT_NODE_WIDTH = 260;
const AUTO_LAYOUT_RANK_HORIZONTAL_GAP = 160;
const AUTO_LAYOUT_NODE_VERTICAL_GAP = 42;
const AUTO_LAYOUT_INPUT_LANE_GAP = 72;
const AUTO_LAYOUT_CANVAS_MARGIN = 40;
const AUTO_LAYOUT_KIND_RANK: Record<string, number> = {
  parameter: 0,
  quality: 1,
  transform: 1,
  emitter: 2,
  noise: 2,
  force: 3,
  simulation: 4,
  render: 5,
  output: 6,
};
const AUTO_LAYOUT_KIND_ORDER: Record<string, number> = {
  output: 0,
  emitter: 1,
  noise: 2,
  force: 3,
  simulation: 4,
  render: 5,
  transform: 6,
  quality: 7,
  parameter: 8,
};

function loadInitialGraph(): GraphDocument {
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (saved) {
    try {
      const result = deserializeGraphDocument(saved);
      if (result.valid) {
        return result.graph;
      }
    } catch {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }
  return createWispySmokeGraph();
}

function createUniqueNodeId(type: string, nodes: readonly GraphNode[]): string {
  const base = type.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const existing = new Set(nodes.map((node) => node.id));
  let index = 1;
  let candidate = base;
  while (existing.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  return candidate;
}

function connectedPorts(edges: readonly GraphEdge[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const add = (nodeId: string, portId: string) => {
    const set = result.get(nodeId) ?? new Set<string>();
    set.add(portId);
    result.set(nodeId, set);
  };
  for (const edge of edges) {
    add(edge.source, edge.sourcePort);
    add(edge.target, edge.targetPort);
  }
  return result;
}

function graphToFlowNodes(
  graph: GraphDocument,
  selectedNodeIds: ReadonlySet<string>,
  onParameterChange: (id: string, value: ParameterValue) => void,
): FlowNode[] {
  const connected = connectedPorts(graph.edges);
  return graph.nodes.flatMap((node) => {
    const definition = defaultNodeRegistry.get(node.type);
    if (!definition) {
      return [];
    }
    return [
      {
        id: node.id,
        type: "threefxNode",
        position: { x: node.position[0], y: node.position[1] },
        selected: selectedNodeIds.has(node.id),
        data: {
          definition,
          connectedPorts: connected.get(node.id) ?? new Set<string>(),
          parameterValues: graph.parameters,
          onParameterChange,
        },
      },
    ];
  });
}

function graphToFlowEdges(graph: GraphDocument, selectedEdgeIds: ReadonlySet<string>): FlowEdge[] {
  return graph.edges.map((edge) => {
    const selected = selectedEdgeIds.has(edge.id);
    return {
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourcePort,
      target: edge.target,
      targetHandle: edge.targetPort,
      focusable: true,
      selectable: false,
      selected,
      interactionWidth: 24,
      ariaLabel: `${edge.source}.${edge.sourcePort} to ${edge.target}.${edge.targetPort}`,
      className: selected ? "threefx-edge threefx-edge-selected selected" : "threefx-edge",
      ...(selected ? { style: { stroke: "#60a5fa", strokeWidth: 3 } } : {}),
    };
  });
}

function isConnectionValid(graph: GraphDocument, connection: Connection | FlowEdge): boolean {
  if (
    !connection.source ||
    !connection.target ||
    !connection.sourceHandle ||
    !connection.targetHandle
  ) {
    return false;
  }
  if (connection.source === connection.target) {
    return false;
  }
  const sourceNode = graph.nodes.find((node) => node.id === connection.source);
  const targetNode = graph.nodes.find((node) => node.id === connection.target);
  if (!sourceNode || !targetNode) {
    return false;
  }
  const sourcePort = findNodePort(sourceNode, connection.sourceHandle);
  const targetPort = findNodePort(targetNode, connection.targetHandle);
  if (!sourcePort || !targetPort || !canConnectPorts(sourcePort, targetPort)) {
    return false;
  }
  if (!targetPort.multiple) {
    const occupied = graph.edges.some(
      (edge) => edge.target === connection.target && edge.targetPort === connection.targetHandle,
    );
    if (occupied) {
      return false;
    }
  }
  return true;
}

function makeEdge(connection: Connection): GraphEdge {
  if (
    !connection.source ||
    !connection.target ||
    !connection.sourceHandle ||
    !connection.targetHandle
  ) {
    throw new Error("Cannot create graph edge from incomplete connection.");
  }
  const edge = {
    source: connection.source,
    sourcePort: connection.sourceHandle,
    target: connection.target,
    targetPort: connection.targetHandle,
  };
  return {
    id: toGraphEdgeId(edge),
    ...edge,
  };
}

function clientPoint(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ("changedTouches" in event && event.changedTouches.length > 0) {
    const touch = event.changedTouches.item(0);
    if (!touch) {
      return null;
    }
    return { x: touch.clientX, y: touch.clientY };
  }
  if ("clientX" in event) {
    return { x: event.clientX, y: event.clientY };
  }
  return null;
}

function isApplePlatform(): boolean {
  return (
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ||
    /Mac OS|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

function isPrimaryModifierPressed(
  event: Pick<KeyboardEvent | React.KeyboardEvent, "ctrlKey" | "metaKey">,
  isApple: boolean,
): boolean {
  return isApple ? event.metaKey : event.ctrlKey;
}

function shortcutModifierLabel(isApple: boolean): string {
  return isApple ? "Cmd" : "Ctrl";
}

function shortcutLabel(isApple: boolean, ...parts: readonly string[]): string {
  return parts.map((part) => (part === "Mod" ? shortcutModifierLabel(isApple) : part)).join(" + ");
}

function consumeShortcutEvent(
  event: Pick<KeyboardEvent | React.KeyboardEvent, "preventDefault" | "stopPropagation">,
): void {
  event.preventDefault();
  event.stopPropagation();
}

function nodeHasCompatibleInput(definition: NodeDefinition, sourcePort: PortDefinition): boolean {
  return definition.ports.some((port) => canConnectPorts(sourcePort, port));
}

function nodeHasCompatibleOutput(definition: NodeDefinition, targetPort: PortDefinition): boolean {
  return definition.ports.some((port) => canConnectPorts(port, targetPort));
}

function firstCompatibleInput(
  definition: NodeDefinition,
  sourcePort: PortDefinition,
): PortDefinition | null {
  return definition.ports.find((port) => canConnectPorts(sourcePort, port)) ?? null;
}

function firstCompatibleOutput(
  definition: NodeDefinition,
  targetPort: PortDefinition,
): PortDefinition | null {
  return definition.ports.find((port) => canConnectPorts(port, targetPort)) ?? null;
}

function isAutoLayoutInputSource(definition: NodeDefinition | null): boolean {
  return definition?.kind === "parameter";
}

function shouldAdvanceAutoLayoutRank(
  graph: GraphDocument,
  edge: GraphEdge,
  sourceDefinition: NodeDefinition | null,
  targetDefinition: NodeDefinition | null,
): boolean {
  if (!sourceDefinition || !targetDefinition || isAutoLayoutInputSource(sourceDefinition)) {
    return false;
  }
  const sourceNode = graph.nodes.find((node) => node.id === edge.source);
  const targetNode = graph.nodes.find((node) => node.id === edge.target);
  const sourcePort = sourceNode ? findNodePort(sourceNode, edge.sourcePort) : null;
  const targetPort = targetNode ? findNodePort(targetNode, edge.targetPort) : null;
  if (!sourcePort || !targetPort) {
    return true;
  }
  return sourcePort.type !== "float" || targetPort.type !== "float";
}

function estimateAutoLayoutNodeSize(
  node: GraphNode,
  definition: NodeDefinition | null,
): AutoLayoutNodeSize {
  if (!definition) {
    return { width: AUTO_LAYOUT_NODE_WIDTH, height: 120 };
  }
  const inputCount = definition.ports.filter((port) => port.direction === "input").length;
  const outputCount = definition.ports.filter((port) => port.direction === "output").length;
  const portRows = Math.max(inputCount, outputCount, 2);
  const portGridHeight = Math.max(48, portRows * 18 + Math.max(0, portRows - 1) * 6 + 16);
  const parameters = definition.parameterMetadata ?? [];
  const groupCount = new Set(parameters.map((parameter) => parameter.group || "Parameters")).size;
  const parameterPanelHeight = parameters.length > 0 ? 37 + groupCount * 32 : 0;
  const valueSummaryHeight = parameters.length > 0 ? 32 : 0;
  const parameterCountBuffer = Math.min(parameters.length, 3) * 16;
  const height =
    37 + portGridHeight + parameterPanelHeight + valueSummaryHeight + parameterCountBuffer;

  return {
    width: AUTO_LAYOUT_NODE_WIDTH,
    height: Math.max(96, Math.ceil(height)),
  };
}

function getAutoLayoutNodeSize(
  node: GraphNode,
  definition: NodeDefinition | null,
  measuredSizes: ReadonlyMap<string, AutoLayoutNodeSize>,
): AutoLayoutNodeSize {
  const measured = measuredSizes.get(node.id);
  if (measured && measured.width > 0 && measured.height > 0) {
    return measured;
  }
  return estimateAutoLayoutNodeSize(node, definition);
}

function sortAutoLayoutNodes(
  graph: GraphDocument,
  nodes: readonly GraphNode[],
  rankById: ReadonlyMap<string, number>,
): GraphNode[] {
  return [...nodes].sort((a, b) => {
    const aDefinition = defaultNodeRegistry.get(a.type);
    const bDefinition = defaultNodeRegistry.get(b.type);
    if (isAutoLayoutInputSource(aDefinition) && isAutoLayoutInputSource(bDefinition)) {
      const aTargetRank = getAutoLayoutSourceTargetSortRank(graph, a.id, rankById);
      const bTargetRank = getAutoLayoutSourceTargetSortRank(graph, b.id, rankById);
      if (aTargetRank !== bTargetRank) {
        return aTargetRank - bTargetRank;
      }
    }
    const kindOrder =
      (AUTO_LAYOUT_KIND_ORDER[aDefinition?.kind ?? ""] ?? 99) -
      (AUTO_LAYOUT_KIND_ORDER[bDefinition?.kind ?? ""] ?? 99);
    if (kindOrder !== 0) {
      return kindOrder;
    }
    return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  });
}

function getAutoLayoutSourceTargetSortRank(
  graph: GraphDocument,
  sourceNodeId: string,
  rankById: ReadonlyMap<string, number>,
): number {
  const ranks = graph.edges
    .filter((edge) => edge.source === sourceNodeId)
    .map((edge) => {
      const target = graph.nodes.find((node) => node.id === edge.target);
      const targetDefinition = target ? defaultNodeRegistry.get(target.type) : null;
      const targetPortIndex = Math.max(
        0,
        targetDefinition?.ports.findIndex((port) => port.id === edge.targetPort) ?? 0,
      );
      return (rankById.get(edge.target) ?? 99) * 100 + targetPortIndex;
    });
  return ranks.length > 0 ? Math.min(...ranks) : 9999;
}

function getAutoLayoutBounds(
  entries: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly size: AutoLayoutNodeSize;
  }>,
): { readonly minX: number; readonly minY: number } {
  if (entries.length === 0) {
    return { minX: 0, minY: 0 };
  }
  return {
    minX: Math.min(...entries.map((entry) => entry.x)),
    minY: Math.min(...entries.map((entry) => entry.y)),
  };
}

function autoLayoutGraphDocument(
  graph: GraphDocument,
  measuredSizes: ReadonlyMap<string, AutoLayoutNodeSize>,
): GraphDocument {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const definitionById = new Map(
    graph.nodes.map((node) => [node.id, defaultNodeRegistry.get(node.type)] as const),
  );
  const rankById = new Map(
    graph.nodes.map((node) => {
      const definition = definitionById.get(node.id);
      return [node.id, AUTO_LAYOUT_KIND_RANK[definition?.kind ?? ""] ?? 0] as const;
    }),
  );

  for (let pass = 0; pass < graph.nodes.length; pass += 1) {
    let changed = false;
    for (const edge of graph.edges) {
      const sourceDefinition = definitionById.get(edge.source) ?? null;
      const targetDefinition = definitionById.get(edge.target) ?? null;
      if (!shouldAdvanceAutoLayoutRank(graph, edge, sourceDefinition, targetDefinition)) {
        continue;
      }
      const sourceRank = rankById.get(edge.source) ?? 0;
      const targetRank = rankById.get(edge.target) ?? 0;
      const targetBaseRank = AUTO_LAYOUT_KIND_RANK[targetDefinition?.kind ?? ""] ?? 0;
      const nextRank = Math.max(targetRank, sourceRank + 1, targetBaseRank);
      if (nextRank !== targetRank) {
        rankById.set(edge.target, nextRank);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  for (const node of graph.nodes) {
    const definition = definitionById.get(node.id) ?? null;
    if (!isAutoLayoutInputSource(definition)) {
      continue;
    }
    const targetRanks = graph.edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => rankById.get(edge.target))
      .filter((rank): rank is number => typeof rank === "number");
    if (targetRanks.length > 0) {
      rankById.set(node.id, Math.max(0, Math.min(...targetRanks) - 1));
    }
  }

  const minRank = Math.min(0, ...rankById.values());
  const buckets = new Map<number, GraphNode[]>();
  for (const node of graph.nodes) {
    const rank = (rankById.get(node.id) ?? 0) - minRank;
    buckets.set(rank, [...(buckets.get(rank) ?? []), node]);
  }

  const sortedRanks = [...buckets.keys()].sort((a, b) => a - b);
  const rankXByRank = new Map<number, number>();
  let nextRankX = AUTO_LAYOUT_CANVAS_MARGIN;
  for (const rank of sortedRanks) {
    const maxRankWidth = Math.max(
      AUTO_LAYOUT_NODE_WIDTH,
      ...(buckets.get(rank) ?? []).map(
        (node) =>
          getAutoLayoutNodeSize(node, definitionById.get(node.id) ?? null, measuredSizes).width,
      ),
    );
    rankXByRank.set(rank, nextRankX);
    nextRankX += maxRankWidth + AUTO_LAYOUT_RANK_HORIZONTAL_GAP;
  }

  const positioned = new Map<string, { x: number; y: number; size: AutoLayoutNodeSize }>();
  for (const rank of sortedRanks) {
    const bucket = sortAutoLayoutNodes(graph, buckets.get(rank) ?? [], rankById);
    const mainNodes = bucket.filter(
      (node) => !isAutoLayoutInputSource(definitionById.get(node.id) ?? null),
    );
    const sourceNodes = bucket.filter((node) =>
      isAutoLayoutInputSource(definitionById.get(node.id) ?? null),
    );
    const x = rankXByRank.get(rank) ?? AUTO_LAYOUT_CANVAS_MARGIN;
    let mainY = AUTO_LAYOUT_CANVAS_MARGIN;
    for (const node of mainNodes) {
      const size = getAutoLayoutNodeSize(node, definitionById.get(node.id) ?? null, measuredSizes);
      positioned.set(node.id, { x, y: mainY, size });
      mainY += size.height + AUTO_LAYOUT_NODE_VERTICAL_GAP;
    }
    const mainBottom = mainY > AUTO_LAYOUT_CANVAS_MARGIN ? mainY : AUTO_LAYOUT_CANVAS_MARGIN;
    let sourceY =
      mainNodes.length > 0 ? mainBottom + AUTO_LAYOUT_INPUT_LANE_GAP : AUTO_LAYOUT_CANVAS_MARGIN;
    for (const node of sourceNodes) {
      const size = getAutoLayoutNodeSize(node, definitionById.get(node.id) ?? null, measuredSizes);
      positioned.set(node.id, { x, y: sourceY, size });
      sourceY += size.height + AUTO_LAYOUT_NODE_VERTICAL_GAP;
    }
  }

  const bounds = getAutoLayoutBounds([...positioned.values()]);
  const shiftX = AUTO_LAYOUT_CANVAS_MARGIN - bounds.minX;
  const shiftY = AUTO_LAYOUT_CANVAS_MARGIN - bounds.minY;

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const position = positioned.get(node.id);
      if (!position || !nodeById.has(node.id)) {
        return node;
      }
      return {
        ...node,
        position: [Math.round(position.x + shiftX), Math.round(position.y + shiftY)] as const,
      };
    }),
  };
}

function describePort(port: PortDefinition): string {
  const accepted = port.acceptedTypes?.length ? `; accepts ${port.acceptedTypes.join(", ")}` : "";
  const multiplicity = port.multiple ? "; multiple connections" : "";
  const required = port.required ? "; required" : "";
  return `${port.label}: ${port.direction} ${port.type}${accepted}${multiplicity}${required}`;
}

function portToneStyle(type: PortType): React.CSSProperties {
  const tone = getPortTypeTone(type);
  return {
    "--port-color": tone.accent,
    "--port-fill": tone.background,
    "--port-border-color": tone.border,
  } as React.CSSProperties;
}

function isCanvasReleaseTarget(event: MouseEvent | TouchEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) {
    return true;
  }
  return !target.closest(
    [
      ".react-flow__handle",
      ".react-flow__node",
      ".react-flow__edge",
      ".react-flow__controls",
      "button",
      "input",
      "select",
      "textarea",
      "[contenteditable='true']",
    ].join(","),
  );
}

function pointIsInsideElement(point: { x: number; y: number }, element: Element | null): boolean {
  const bounds = element?.getBoundingClientRect();
  if (!bounds) {
    return false;
  }
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

function quickAddModeFromFinalConnection(
  graph: GraphDocument,
  connectionState: FinalConnectionState,
): QuickAddMode | null {
  const handle = connectionState.fromHandle;
  if (!handle?.nodeId || !handle.id) {
    return null;
  }
  const node = graph.nodes.find((entry) => entry.id === handle.nodeId);
  const port = node ? findNodePort(node, handle.id) : null;
  if (!port) {
    return null;
  }
  if (port.direction === "output") {
    return { kind: "fromOutput", nodeId: handle.nodeId, portId: handle.id };
  }
  return { kind: "fromInput", nodeId: handle.nodeId, portId: handle.id };
}

function quickAddModeHasCompatibleDefinition(graph: GraphDocument, mode: QuickAddMode): boolean {
  if (mode.kind === "free") {
    return true;
  }
  if (mode.kind === "fromOutput") {
    const sourceNode = graph.nodes.find((node) => node.id === mode.nodeId);
    const sourcePort = sourceNode ? findNodePort(sourceNode, mode.portId) : null;
    return Boolean(
      sourcePort &&
      defaultNodeRegistry
        .list()
        .some((definition) => nodeHasCompatibleInput(definition, sourcePort)),
    );
  }
  const targetNode = graph.nodes.find((node) => node.id === mode.nodeId);
  const targetPort = targetNode ? findNodePort(targetNode, mode.portId) : null;
  return Boolean(
    targetPort &&
    defaultNodeRegistry
      .list()
      .some((definition) => nodeHasCompatibleOutput(definition, targetPort)),
  );
}

function getQuickAddEntrySubtitle(
  definition: NodeDefinition,
  graph: GraphDocument,
  mode: QuickAddMode,
): string {
  if (mode.kind === "fromOutput") {
    const sourceNode = graph.nodes.find((node) => node.id === mode.nodeId);
    const sourcePort = sourceNode ? findNodePort(sourceNode, mode.portId) : null;
    const input = sourcePort ? firstCompatibleInput(definition, sourcePort) : null;
    return input ? `Input ${input.label} (${input.type})` : definition.category;
  }
  if (mode.kind === "fromInput") {
    const targetNode = graph.nodes.find((node) => node.id === mode.nodeId);
    const targetPort = targetNode ? findNodePort(targetNode, mode.portId) : null;
    const output = targetPort ? firstCompatibleOutput(definition, targetPort) : null;
    return output ? `Output ${output.label} (${output.type})` : definition.category;
  }
  return definition.category;
}

function getPortFlowPoint(
  graph: GraphDocument,
  nodeId: string,
  portId: string,
  measuredSizes: ReadonlyMap<string, AutoLayoutNodeSize>,
): { readonly x: number; readonly y: number; readonly direction: "input" | "output" } | null {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  const definition = node ? defaultNodeRegistry.get(node.type) : null;
  const port = node ? findNodePort(node, portId) : null;
  if (!node || !definition || !port) {
    return null;
  }
  const sidePorts = definition.ports.filter((entry) => entry.direction === port.direction);
  const index = Math.max(
    0,
    sidePorts.findIndex((entry) => entry.id === portId),
  );
  const size = measuredSizes.get(nodeId) ?? estimateAutoLayoutNodeSize(node, definition);
  return {
    x: node.position[0] + (port.direction === "output" ? size.width : 0),
    y: node.position[1] + 50 + index * 24,
    direction: port.direction,
  };
}

function bezierPath(
  source: { readonly x: number; readonly y: number },
  target: { readonly x: number; readonly y: number },
): string {
  const controlDistance = Math.max(80, Math.abs(target.x - source.x) * 0.42);
  const sourceControl = { x: source.x + controlDistance, y: source.y };
  const targetControl = { x: target.x - controlDistance, y: target.y };
  return `M ${source.x} ${source.y} C ${sourceControl.x} ${sourceControl.y}, ${targetControl.x} ${targetControl.y}, ${target.x} ${target.y}`;
}

function getPendingQuickAddPath({
  bounds,
  flowToScreenPosition,
  graph,
  measuredSizes,
  quickAdd,
}: {
  readonly bounds: DOMRect | null;
  readonly flowToScreenPosition: (position: { x: number; y: number }) => { x: number; y: number };
  readonly graph: GraphDocument;
  readonly measuredSizes: ReadonlyMap<string, AutoLayoutNodeSize>;
  readonly quickAdd: QuickAddState | null;
}): string | null {
  if (!bounds || !quickAdd || quickAdd.mode.kind === "free") {
    return null;
  }
  const portPoint = getPortFlowPoint(
    graph,
    quickAdd.mode.nodeId,
    quickAdd.mode.portId,
    measuredSizes,
  );
  if (!portPoint) {
    return null;
  }
  const portScreenPoint = flowToScreenPosition({ x: portPoint.x, y: portPoint.y });
  const popoverAnchor =
    quickAdd.mode.kind === "fromOutput"
      ? { x: quickAdd.screen.x, y: quickAdd.screen.y + QUICK_ADD_ANCHOR_Y }
      : { x: quickAdd.screen.x + QUICK_ADD_WIDTH, y: quickAdd.screen.y + QUICK_ADD_ANCHOR_Y };
  const port = { x: portScreenPoint.x - bounds.left, y: portScreenPoint.y - bounds.top };
  const popover = { x: popoverAnchor.x - bounds.left, y: popoverAnchor.y - bounds.top };
  return quickAdd.mode.kind === "fromOutput"
    ? bezierPath(port, popover)
    : bezierPath(popover, port);
}

function nodeSelectionChanges(changes: readonly NodeChange<FlowNode>[]) {
  return changes.filter(
    (
      change,
    ): change is NodeChange<FlowNode> & {
      readonly id: string;
      readonly selected: boolean;
      readonly type: "select";
    } => change.type === "select" && "id" in change,
  );
}

function edgeSelectionChanges(changes: readonly EdgeChange<FlowEdge>[]) {
  return changes.filter(
    (
      change,
    ): change is EdgeChange<FlowEdge> & {
      readonly id: string;
      readonly selected: boolean;
      readonly type: "select";
    } => change.type === "select" && "id" in change,
  );
}

function areStringSetsEqual(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
  if (first.size !== second.size) {
    return false;
  }
  for (const value of first) {
    if (!second.has(value)) {
      return false;
    }
  }
  return true;
}

function clientRectFromPoints(
  start: { readonly x: number; readonly y: number },
  current: { readonly x: number; readonly y: number },
) {
  return {
    bottom: Math.max(start.y, current.y),
    height: Math.abs(current.y - start.y),
    left: Math.min(start.x, current.x),
    right: Math.max(start.x, current.x),
    top: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
  };
}

function clientRectsIntersect(
  first: {
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly top: number;
  },
  second: {
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly top: number;
  },
): boolean {
  return (
    first.left <= second.right &&
    first.right >= second.left &&
    first.top <= second.bottom &&
    first.bottom >= second.top
  );
}

function isCanvasSelectionStartTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (
    target.closest(
      ".react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .quick-add, .node-context-menu, .pending-quick-add-edge",
    )
  ) {
    return false;
  }
  return Boolean(target.closest(".react-flow__pane"));
}

function selectedNodeIdsInClientRect(
  root: HTMLElement | null,
  selectionRect: ReturnType<typeof clientRectFromPoints>,
): Set<string> {
  const ids = new Set<string>();
  if (!root || selectionRect.width === 0 || selectionRect.height === 0) {
    return ids;
  }
  for (const nodeElement of root.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")) {
    const id = nodeElement.dataset.id;
    if (!id) {
      continue;
    }
    const nodeRect = nodeElement.getBoundingClientRect();
    if (clientRectsIntersect(selectionRect, nodeRect)) {
      ids.add(id);
    }
  }
  return ids;
}

function App() {
  const [graph, setGraph] = useState<GraphDocument>(() => loadInitialGraph());
  const [selectedNodeIds, setSelectedNodeIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<ReadonlySet<string>>(new Set());
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
  const [isMiddlePanning, setIsMiddlePanning] = useState(false);
  const [isShortcutDialogOpen, setIsShortcutDialogOpen] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [canvasBounds, setCanvasBounds] = useState<DOMRect | null>(null);
  const [selectionDrag, setSelectionDragState] = useState<SelectionDragState | null>(null);
  const [previewTelemetry, setPreviewTelemetry] = useState<PreviewTelemetry>({
    ...EMPTY_PREVIEW_STATS,
    webgpuLabel: "Checking",
    webgpuSupported: false,
  });
  const [status, setStatus] = useState("Ready");
  const [isApple] = useState(() => isApplePlatform());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasPanelRef = useRef<HTMLDivElement | null>(null);
  const pendingMoveSnapshotRef = useRef<EditorSnapshot | null>(null);
  const selectionBaseNodeIdsRef = useRef<ReadonlySet<string>>(new Set());
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const suppressNextNodeSelectionChangeRef = useRef(false);
  const suppressNextPaneClickRef = useRef(false);
  const undoStackRef = useRef<EditorSnapshot[]>([]);
  const redoStackRef = useRef<EditorSnapshot[]>([]);
  const { fitView, flowToScreenPosition, getNodes, screenToFlowPosition } = useReactFlow<
    FlowNode,
    FlowEdge
  >();
  const canUndo = historyRevision >= 0 && undoStackRef.current.length > 0;
  const canRedo = historyRevision >= 0 && redoStackRef.current.length > 0;

  const setSelectionDrag = useCallback((next: SelectionDragState | null) => {
    selectionDragRef.current = next;
    setSelectionDragState(next);
  }, []);

  const createSnapshot = useCallback(
    (sourceGraph: GraphDocument = graph): EditorSnapshot => ({
      graph: sourceGraph,
      selectedEdgeIds: [...selectedEdgeIds],
      selectedNodeIds: [...selectedNodeIds],
      status,
    }),
    [graph, selectedEdgeIds, selectedNodeIds, status],
  );

  const pushUndoSnapshot = useCallback((snapshot: EditorSnapshot) => {
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > HISTORY_LIMIT) {
      undoStackRef.current.splice(0, undoStackRef.current.length - HISTORY_LIMIT);
    }
    redoStackRef.current = [];
    setHistoryRevision((revision) => revision + 1);
  }, []);

  const restoreSnapshot = useCallback((snapshot: EditorSnapshot) => {
    pendingMoveSnapshotRef.current = null;
    setGraph(snapshot.graph);
    setSelectedNodeIds(new Set(snapshot.selectedNodeIds));
    setSelectedEdgeIds(new Set(snapshot.selectedEdgeIds));
    setStatus(snapshot.status);
    setQuickAdd(null);
    setNodeMenu(null);
  }, []);

  const commitGraphChange = useCallback(
    (
      updater: (current: GraphDocument) => GraphDocument,
      options: {
        readonly nextSelectedEdgeIds?: readonly string[];
        readonly nextSelectedNodeIds?: readonly string[];
        readonly status?: string;
      } = {},
    ): boolean => {
      const nextGraph = updater(graph);
      if (nextGraph === graph) {
        return false;
      }
      pushUndoSnapshot(createSnapshot(graph));
      setGraph(nextGraph);
      if (options.nextSelectedNodeIds) {
        setSelectedNodeIds(new Set(options.nextSelectedNodeIds));
      }
      if (options.nextSelectedEdgeIds) {
        setSelectedEdgeIds(new Set(options.nextSelectedEdgeIds));
      }
      if (options.status) {
        setStatus(options.status);
      }
      return true;
    },
    [createSnapshot, graph, pushUndoSnapshot],
  );

  const undoEdit = useCallback(() => {
    const snapshot = undoStackRef.current.pop();
    if (!snapshot) {
      return;
    }
    redoStackRef.current.push(createSnapshot(graph));
    restoreSnapshot(snapshot);
    setStatus("Undo");
    setHistoryRevision((revision) => revision + 1);
  }, [createSnapshot, graph, restoreSnapshot]);

  const redoEdit = useCallback(() => {
    const snapshot = redoStackRef.current.pop();
    if (!snapshot) {
      return;
    }
    undoStackRef.current.push(createSnapshot(graph));
    restoreSnapshot(snapshot);
    setStatus("Redo");
    setHistoryRevision((revision) => revision + 1);
  }, [createSnapshot, graph, restoreSnapshot]);

  const addNode = useCallback(
    (
      type: string,
      position: { readonly x: number; readonly y: number },
      connectMode: QuickAddMode = { kind: "free" },
    ) => {
      const definition = defaultNodeRegistry.get(type);
      if (!definition) {
        return;
      }
      const id = createUniqueNodeId(type, graph.nodes);
      commitGraphChange(
        (current) => {
          const node = defaultNodeRegistry.instantiate(type, id, [position.x, position.y]);
          const nextEdges = [...current.edges];

          if (connectMode.kind === "fromOutput") {
            const sourceNode = current.nodes.find((entry) => entry.id === connectMode.nodeId);
            const sourcePort = sourceNode ? findNodePort(sourceNode, connectMode.portId) : null;
            const targetPort = sourcePort ? firstCompatibleInput(definition, sourcePort) : null;
            if (targetPort) {
              nextEdges.push({
                id: toGraphEdgeId({
                  source: connectMode.nodeId,
                  sourcePort: connectMode.portId,
                  target: id,
                  targetPort: targetPort.id,
                }),
                source: connectMode.nodeId,
                sourcePort: connectMode.portId,
                target: id,
                targetPort: targetPort.id,
              });
            }
          } else if (connectMode.kind === "fromInput") {
            const targetNode = current.nodes.find((entry) => entry.id === connectMode.nodeId);
            const targetPort = targetNode ? findNodePort(targetNode, connectMode.portId) : null;
            const sourcePort = targetPort ? firstCompatibleOutput(definition, targetPort) : null;
            if (sourcePort) {
              nextEdges.push({
                id: toGraphEdgeId({
                  source: id,
                  sourcePort: sourcePort.id,
                  target: connectMode.nodeId,
                  targetPort: connectMode.portId,
                }),
                source: id,
                sourcePort: sourcePort.id,
                target: connectMode.nodeId,
                targetPort: connectMode.portId,
              });
            }
          }

          return {
            ...current,
            nodes: [...current.nodes, node],
            edges: nextEdges,
          };
        },
        { nextSelectedEdgeIds: [], nextSelectedNodeIds: [id], status: `Added ${definition.label}` },
      );
      setQuickAdd(null);
      setNodeMenu(null);
    },
    [commitGraphChange, graph.nodes],
  );

  const deleteSelection = useCallback(() => {
    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) {
      return;
    }
    const nodeIds = selectedNodeIds;
    const edgeIds = selectedEdgeIds;
    commitGraphChange(
      (current) => ({
        ...current,
        nodes: current.nodes.filter((node) => !nodeIds.has(node.id)),
        edges: current.edges.filter(
          (edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target),
        ),
      }),
      { nextSelectedEdgeIds: [], nextSelectedNodeIds: [], status: "Deleted selection" },
    );
    setNodeMenu(null);
  }, [commitGraphChange, selectedEdgeIds, selectedNodeIds]);

  const duplicateSelected = useCallback(() => {
    const selectedNodes = graph.nodes.filter((entry) => selectedNodeIds.has(entry.id));
    if (selectedNodes.length === 0) {
      return;
    }
    const idMap = new Map<string, string>();
    const existingNodes = [...graph.nodes];
    const copiedNodes = selectedNodes.map((node) => {
      const id = createUniqueNodeId(node.type, existingNodes);
      idMap.set(node.id, id);
      const copy: GraphNode = {
        ...node,
        id,
        label: selectedNodes.length === 1 ? `${node.label} Copy` : node.label,
        position: [node.position[0] + 36, node.position[1] + 36],
      };
      existingNodes.push(copy);
      return copy;
    });
    const copiedEdges = graph.edges.flatMap((edge) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) {
        return [];
      }
      const nextEdge = {
        source,
        sourcePort: edge.sourcePort,
        target,
        targetPort: edge.targetPort,
      };
      return [{ id: toGraphEdgeId(nextEdge), ...nextEdge }];
    });
    commitGraphChange(
      (current) => ({
        ...current,
        nodes: [...current.nodes, ...copiedNodes],
        edges: [...current.edges, ...copiedEdges],
      }),
      {
        nextSelectedEdgeIds: [],
        nextSelectedNodeIds: copiedNodes.map((node) => node.id),
        status: selectedNodes.length === 1 ? "Duplicated node" : "Duplicated nodes",
      },
    );
    setNodeMenu(null);
  }, [commitGraphChange, graph.edges, graph.nodes, selectedNodeIds]);

  const updateParameter = useCallback(
    (id: string, value: ParameterValue) => {
      commitGraphChange((current) => ({
        ...current,
        parameters: { ...current.parameters, [id]: value },
        nodes: current.nodes.map((node) => {
          const definition = defaultNodeRegistry.get(node.type);
          const ownsParameter =
            definition?.parameterMetadata?.some((metadata) => metadata.id === id) ?? false;
          if (!ownsParameter) {
            return node;
          }
          const isParameterNode = node.type === `parameter.${id}`;
          return {
            ...node,
            parameters: {
              ...(node.parameters ?? {}),
              ...(isParameterNode ? { value } : { [id]: value }),
            },
          };
        }),
      }));
    },
    [commitGraphChange],
  );

  const validation = useMemo(() => validateGraphDocument(graph), [graph]);
  const compileResult = useMemo(() => compileGraphToIR(graph), [graph]);
  const flowNodes = useMemo(
    () => graphToFlowNodes(graph, selectedNodeIds, updateParameter),
    [graph, selectedNodeIds, updateParameter],
  );
  const flowEdges = useMemo(
    () => graphToFlowEdges(graph, selectedEdgeIds),
    [graph, selectedEdgeIds],
  );

  const saveLocal = useCallback(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, serializeGraphDocument(graph));
    setStatus("Saved graph locally");
  }, [graph]);

  const loadLocal = useCallback(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!saved) {
      setStatus("No local graph saved");
      return;
    }
    const result = deserializeGraphDocument(saved);
    commitGraphChange(() => result.graph, {
      nextSelectedEdgeIds: [],
      nextSelectedNodeIds: [],
      status: result.valid ? "Loaded local graph" : "Loaded graph with validation errors",
    });
  }, [commitGraphChange]);

  const resetPreset = useCallback(() => {
    commitGraphChange(() => createWispySmokeGraph(), {
      nextSelectedEdgeIds: [],
      nextSelectedNodeIds: [],
      status: "Loaded Wispy Smoke preset",
    });
  }, [commitGraphChange]);

  const downloadJson = useCallback(() => {
    const blob = new Blob([serializeGraphDocument(graph)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "wispy-smoke.threefx.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [graph]);

  const importJson = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const source = String(reader.result ?? "");
        const result = deserializeGraphDocument(source);
        commitGraphChange(() => result.graph, {
          nextSelectedEdgeIds: [],
          nextSelectedNodeIds: [],
          status: result.valid ? "Imported graph" : "Imported graph with validation errors",
        });
      });
      reader.readAsText(file);
    },
    [commitGraphChange],
  );

  const collectMeasuredNodeSizes = useCallback((): Map<string, AutoLayoutNodeSize> => {
    const sizes = new Map<string, AutoLayoutNodeSize>();
    for (const node of getNodes()) {
      const sizedNode = node as FlowNode & {
        readonly height?: number;
        readonly measured?: { readonly width?: number; readonly height?: number };
        readonly width?: number;
      };
      const width = sizedNode.measured?.width ?? sizedNode.width ?? AUTO_LAYOUT_NODE_WIDTH;
      const height = sizedNode.measured?.height ?? sizedNode.height ?? 0;
      if (width > 0 && height > 0) {
        sizes.set(node.id, { width, height });
      }
    }
    return sizes;
  }, [getNodes]);

  useEffect(() => {
    const element = canvasPanelRef.current;
    if (!element) {
      return;
    }
    const updateBounds = () => setCanvasBounds(element.getBoundingClientRect());
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(element);
    window.addEventListener("resize", updateBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBounds);
    };
  }, []);

  const autoLayoutGraph = useCallback(() => {
    if (graph.nodes.length === 0) {
      return;
    }
    const measuredSizes = collectMeasuredNodeSizes();
    commitGraphChange((current) => autoLayoutGraphDocument(current, measuredSizes), {
      status: "Auto layout applied",
    });
    setQuickAdd(null);
    setNodeMenu(null);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        void fitView({ padding: 0.18, duration: 180 });
      });
    });
  }, [collectMeasuredNodeSizes, commitGraphChange, fitView, graph.nodes.length]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!isConnectionValid(graph, connection)) {
        return;
      }
      const edge = makeEdge(connection);
      commitGraphChange((current) => {
        if (current.edges.some((entry) => entry.id === edge.id)) {
          return current;
        }
        return { ...current, edges: [...current.edges, edge] };
      });
    },
    [commitGraphChange, graph],
  );

  const openQuickAddAt = useCallback(
    (screen: { x: number; y: number }, mode: QuickAddMode) => {
      if (mode.kind !== "free") {
        suppressNextPaneClickRef.current = true;
        window.setTimeout(() => {
          suppressNextPaneClickRef.current = false;
        }, 0);
      }
      setQuickAdd({
        screen,
        flow: screenToFlowPosition(screen),
        mode,
      });
      setPaletteQuery("");
      setNodeMenu(null);
    },
    [screenToFlowPosition],
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectionState.isValid === true) {
        return;
      }
      const point = clientPoint(event);
      if (
        !point ||
        !pointIsInsideElement(point, canvasPanelRef.current) ||
        !isCanvasReleaseTarget(event)
      ) {
        return;
      }
      const mode = quickAddModeFromFinalConnection(graph, connectionState);
      if (!mode || !quickAddModeHasCompatibleDefinition(graph, mode)) {
        return;
      }
      openQuickAddAt(point, mode);
    },
    [graph, openQuickAddAt],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/threefx-node");
      if (!type) {
        return;
      }
      addNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [addNode, screenToFlowPosition],
  );

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent<Element, MouseEvent>) => {
      event.preventDefault();
      openQuickAddAt({ x: event.clientX, y: event.clientY }, { kind: "free" });
    },
    [openQuickAddAt],
  );

  const handleCanvasPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button === 1) {
        setIsMiddlePanning(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      if (event.button !== 0 || !event.isPrimary || !isCanvasSelectionStartTarget(event.target)) {
        return;
      }
      const point = { x: event.clientX, y: event.clientY };
      selectionBaseNodeIdsRef.current =
        event.shiftKey || event.ctrlKey || event.metaKey
          ? new Set(selectedNodeIds)
          : new Set<string>();
      setSelectionDrag({
        active: false,
        additive: event.shiftKey || event.ctrlKey || event.metaKey,
        current: point,
        pointerId: event.pointerId,
        start: point,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      setQuickAdd(null);
      setNodeMenu(null);
    },
    [selectedNodeIds, setSelectionDrag],
  );

  const handleCanvasPointerMoveCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = selectionDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const current = { x: event.clientX, y: event.clientY };
      const distance = Math.hypot(current.x - drag.start.x, current.y - drag.start.y);
      const active = drag.active || distance > SELECTION_DRAG_THRESHOLD;
      const nextDrag = { ...drag, active, current };
      setSelectionDrag(nextDrag);
      if (!active) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const selectedIds = selectedNodeIdsInClientRect(
        canvasPanelRef.current,
        clientRectFromPoints(nextDrag.start, nextDrag.current),
      );
      const nextSelectedNodeIds = nextDrag.additive
        ? new Set([...selectionBaseNodeIdsRef.current, ...selectedIds])
        : selectedIds;
      setSelectedNodeIds((currentSelection) =>
        areStringSetsEqual(currentSelection, nextSelectedNodeIds)
          ? currentSelection
          : nextSelectedNodeIds,
      );
      setSelectedEdgeIds((currentSelection) =>
        currentSelection.size === 0 ? currentSelection : new Set<string>(),
      );
    },
    [setSelectionDrag],
  );

  const handleCanvasPointerEndCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = selectionDragRef.current;
      if (drag?.pointerId === event.pointerId) {
        if (drag.active) {
          suppressNextPaneClickRef.current = true;
          window.setTimeout(() => {
            suppressNextPaneClickRef.current = false;
          }, 160);
        }
        setSelectionDrag(null);
      }
      setIsMiddlePanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [setSelectionDrag],
  );

  const focusSelection = useCallback(() => {
    const selectedNodeList = graph.nodes
      .filter((node) => selectedNodeIds.has(node.id))
      .map((node) => ({ id: node.id }));
    const selectedEdgeNodeIds =
      selectedNodeList.length > 0
        ? []
        : graph.edges
            .filter((edge) => selectedEdgeIds.has(edge.id))
            .flatMap((edge) => [{ id: edge.source }, { id: edge.target }]);
    const nodes = selectedNodeList.length > 0 ? selectedNodeList : selectedEdgeNodeIds;
    if (nodes.length === 0) {
      return;
    }
    void fitView({ nodes, padding: 0.32, duration: 180, maxZoom: 1.15 });
  }, [fitView, graph.edges, graph.nodes, selectedEdgeIds, selectedNodeIds]);

  const selectAllNodes = useCallback(() => {
    setSelectedNodeIds(new Set(graph.nodes.map((node) => node.id)));
    setSelectedEdgeIds(new Set());
    setQuickAdd(null);
    setNodeMenu(null);
  }, [graph.nodes]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent | React.KeyboardEvent) => {
      if (event.defaultPrevented || isEditableEventTarget(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      const primary = isPrimaryModifierPressed(event, isApple);
      if (primary && key === "z" && !event.shiftKey) {
        consumeShortcutEvent(event);
        undoEdit();
        return;
      }
      if (
        (primary && key === "z" && event.shiftKey) ||
        (!isApple && event.ctrlKey && key === "y")
      ) {
        consumeShortcutEvent(event);
        redoEdit();
        return;
      }
      if (primary && key === "a") {
        consumeShortcutEvent(event);
        selectAllNodes();
        return;
      }
      if (primary && key === "d") {
        consumeShortcutEvent(event);
        duplicateSelected();
        return;
      }
      if (primary && key === "s") {
        consumeShortcutEvent(event);
        saveLocal();
        return;
      }
      if (key === "f") {
        consumeShortcutEvent(event);
        focusSelection();
        return;
      }
      if (key === "?" || (event.shiftKey && key === "/")) {
        consumeShortcutEvent(event);
        setIsShortcutDialogOpen(true);
        return;
      }
      if (event.key === "Escape") {
        consumeShortcutEvent(event);
        setQuickAdd(null);
        setNodeMenu(null);
        setIsShortcutDialogOpen(false);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        consumeShortcutEvent(event);
        deleteSelection();
        return;
      }
    },
    [
      deleteSelection,
      duplicateSelected,
      focusSelection,
      isApple,
      redoEdit,
      saveLocal,
      selectAllNodes,
      undoEdit,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleKeyDown(event);
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleKeyDown]);

  const suppressFlowSelectionEcho = useCallback(() => {
    suppressNextNodeSelectionChangeRef.current = true;
    window.setTimeout(() => {
      suppressNextNodeSelectionChangeRef.current = false;
    }, 0);
  }, []);

  const suppressPaneClickEcho = useCallback(() => {
    suppressNextPaneClickRef.current = true;
    window.setTimeout(() => {
      suppressNextPaneClickRef.current = false;
    }, 0);
  }, []);

  const handlePaneClick = useCallback(() => {
    if (suppressNextPaneClickRef.current) {
      suppressNextPaneClickRef.current = false;
      return;
    }
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setQuickAdd(null);
    setNodeMenu(null);
  }, []);

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: FlowNode) => {
      event.stopPropagation();
      suppressFlowSelectionEcho();
      suppressPaneClickEcho();
      setSelectedEdgeIds(new Set());
      setQuickAdd(null);
      setNodeMenu(null);
      setSelectedNodeIds((current) => {
        if (event.ctrlKey || event.metaKey) {
          const next = new Set(current);
          if (next.has(node.id)) {
            next.delete(node.id);
          } else {
            next.add(node.id);
          }
          return next;
        }
        if (event.shiftKey) {
          const next = new Set(current);
          next.add(node.id);
          return next;
        }
        return new Set([node.id]);
      });
    },
    [suppressFlowSelectionEcho, suppressPaneClickEcho],
  );

  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: FlowEdge) => {
      event.stopPropagation();
      suppressPaneClickEcho();
      setSelectedNodeIds(new Set());
      setQuickAdd(null);
      setNodeMenu(null);
      setSelectedEdgeIds((current) => {
        if (event.ctrlKey || event.metaKey) {
          const next = new Set(current);
          if (next.has(edge.id)) {
            next.delete(edge.id);
          } else {
            next.add(edge.id);
          }
          return next;
        }
        if (event.shiftKey) {
          const next = new Set(current);
          next.add(edge.id);
          return next;
        }
        return new Set([edge.id]);
      });
    },
    [suppressPaneClickEcho],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const positionChanges = changes.filter(
        (
          change,
        ): change is NodeChange<FlowNode> & {
          readonly id: string;
          readonly position: { readonly x: number; readonly y: number };
          readonly type: "position";
        } => change.type === "position" && "id" in change && Boolean(change.position),
      );
      if (positionChanges.length > 0) {
        const isDragging = positionChanges.some(
          (change) => (change as { readonly dragging?: boolean }).dragging,
        );
        if (isDragging && !pendingMoveSnapshotRef.current) {
          pendingMoveSnapshotRef.current = createSnapshot(graph);
        }
        if (!isDragging && pendingMoveSnapshotRef.current) {
          pushUndoSnapshot(pendingMoveSnapshotRef.current);
          pendingMoveSnapshotRef.current = null;
          setStatus("Moved nodes");
        } else if (!isDragging) {
          pushUndoSnapshot(createSnapshot(graph));
        }
        setGraph((current) => ({
          ...current,
          nodes: current.nodes.map((node) => {
            const change = positionChanges.find((entry) => entry.id === node.id);
            return change ? { ...node, position: [change.position.x, change.position.y] } : node;
          }),
        }));
      }

      const selectionChanges = nodeSelectionChanges(changes);
      if (selectionChanges.length > 0 && !suppressNextNodeSelectionChangeRef.current) {
        setSelectedNodeIds((current) => {
          const next = new Set(current);
          for (const change of selectionChanges) {
            if (change.selected) {
              next.add(change.id);
            } else {
              next.delete(change.id);
            }
          }
          return next;
        });
        if (selectionChanges.some((change) => change.selected)) {
          setSelectedEdgeIds(new Set());
        }
      }
      if (selectionChanges.length > 0 && suppressNextNodeSelectionChangeRef.current) {
        suppressNextNodeSelectionChangeRef.current = false;
      }
    },
    [createSnapshot, graph, pushUndoSnapshot],
  );

  const handleEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    const selectionChanges = edgeSelectionChanges(changes);
    if (selectionChanges.length === 0 || suppressNextPaneClickRef.current) {
      return;
    }
    setSelectedEdgeIds((current) => {
      const next = new Set(current);
      for (const change of selectionChanges) {
        if (change.selected) {
          next.add(change.id);
        } else {
          next.delete(change.id);
        }
      }
      return next;
    });
    if (selectionChanges.some((change) => change.selected)) {
      setSelectedNodeIds(new Set());
    }
  }, []);

  const pendingQuickAddPath = useMemo(
    () =>
      getPendingQuickAddPath({
        bounds: canvasBounds,
        flowToScreenPosition,
        graph,
        measuredSizes: collectMeasuredNodeSizes(),
        quickAdd,
      }),
    [canvasBounds, collectMeasuredNodeSizes, flowToScreenPosition, graph, quickAdd],
  );

  const previewParams = graph.parameters as unknown as WispySmokeVFXParams;

  return (
    <main className="app-shell" tabIndex={-1}>
      <TopBar
        status={status}
        onSave={saveLocal}
        onLoad={loadLocal}
        onReset={resetPreset}
        onDownloadJson={downloadJson}
        onImportClick={() => fileInputRef.current?.click()}
        onAutoLayout={autoLayoutGraph}
        onRedo={redoEdit}
        onShowShortcuts={() => setIsShortcutDialogOpen(true)}
        onUndo={undoEdit}
        canRedo={canRedo}
        canUndo={canUndo}
      />
      <input
        ref={fileInputRef}
        className="hidden-input"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) {
            importJson(file);
          }
          event.currentTarget.value = "";
        }}
      />
      <section className="workspace">
        <NodePalette
          query={paletteQuery}
          onQueryChange={setPaletteQuery}
          quickAdd={quickAdd}
          graph={graph}
          onAddNode={addNode}
        />
        <div
          ref={canvasPanelRef}
          className={`canvas-panel ${isMiddlePanning ? "canvas-panel-panning" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          onPointerCancelCapture={handleCanvasPointerEndCapture}
          onPointerDownCapture={handleCanvasPointerDownCapture}
          onPointerMoveCapture={handleCanvasPointerMoveCapture}
          onPointerUpCapture={handleCanvasPointerEndCapture}
        >
          <ReactFlow<FlowNode, FlowEdge>
            className="threefx-flow"
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={{ threefxNode: ThreeFXNode }}
            fitView
            minZoom={0.24}
            maxZoom={1.8}
            isValidConnection={(connection) => isConnectionValid(graph, connection)}
            onConnect={handleConnect}
            onConnectEnd={handleConnectEnd}
            onPaneContextMenu={handlePaneContextMenu}
            onPaneClick={handlePaneClick}
            onNodeClick={handleNodeClick}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              event.stopPropagation();
              suppressFlowSelectionEcho();
              suppressPaneClickEcho();
              setSelectedNodeIds(new Set([node.id]));
              setSelectedEdgeIds(new Set());
              setQuickAdd(null);
              setNodeMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
            }}
            onEdgeClick={handleEdgeClick}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
            nodesFocusable
            edgesFocusable
            autoPanOnNodeFocus
            elevateNodesOnSelect={false}
            panOnDrag={[1]}
            selectionKeyCode={null}
            selectionMode={SelectionMode.Partial}
            selectionOnDrag={false}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls />
          </ReactFlow>
          {selectionDrag?.active ? (
            <CanvasSelectionRect drag={selectionDrag} bounds={canvasBounds} />
          ) : null}
          {pendingQuickAddPath ? (
            <svg className="pending-quick-add-edge" aria-hidden="true">
              <path d={pendingQuickAddPath} />
            </svg>
          ) : null}
          {quickAdd ? (
            <QuickAddPopover
              graph={graph}
              state={quickAdd}
              query={paletteQuery}
              onQueryChange={setPaletteQuery}
              onAddNode={addNode}
              onClose={() => setQuickAdd(null)}
            />
          ) : null}
          {nodeMenu ? (
            <NodeContextMenu
              state={nodeMenu}
              onDuplicate={duplicateSelected}
              onDelete={deleteSelection}
              onClose={() => setNodeMenu(null)}
            />
          ) : null}
        </div>
        <aside className="right-rail">
          <PreviewViewport params={previewParams} onTelemetry={setPreviewTelemetry} />
          <PerformancePanel telemetry={previewTelemetry} />
          <GraphStatusPanel
            compileResult={compileResult}
            diagnostics={validation.diagnostics}
            edgeCount={graph.edges.length}
            nodeCount={graph.nodes.length}
          />
          <ExportPanel compileResult={compileResult} />
        </aside>
      </section>
      <ShortcutDialog
        isApple={isApple}
        open={isShortcutDialogOpen}
        onClose={() => setIsShortcutDialogOpen(false)}
      />
    </main>
  );
}

function TopBar({
  status,
  onSave,
  onLoad,
  onReset,
  onDownloadJson,
  onImportClick,
  onAutoLayout,
  onRedo,
  onShowShortcuts,
  onUndo,
  canRedo,
  canUndo,
}: {
  readonly status: string;
  readonly onSave: () => void;
  readonly onLoad: () => void;
  readonly onReset: () => void;
  readonly onDownloadJson: () => void;
  readonly onImportClick: () => void;
  readonly onAutoLayout: () => void;
  readonly onRedo: () => void;
  readonly onShowShortcuts: () => void;
  readonly onUndo: () => void;
  readonly canRedo: boolean;
  readonly canUndo: boolean;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-logo" src="/logo.png" alt="" aria-hidden="true" />
        <div>
          <h1>ThreeFX Studio</h1>
          <span>{status}</span>
        </div>
      </div>
      <div className="topbar-actions">
        <IconButton title="Save" onClick={onSave} icon={<Save size={16} />} />
        <IconButton title="Load" onClick={onLoad} icon={<FolderOpen size={16} />} />
        <IconButton title="Import" onClick={onImportClick} icon={<Upload size={16} />} />
        <IconButton title="Download graph" onClick={onDownloadJson} icon={<FileDown size={16} />} />
        <IconButton title="Undo" onClick={onUndo} icon={<Undo2 size={16} />} disabled={!canUndo} />
        <IconButton title="Redo" onClick={onRedo} icon={<Redo2 size={16} />} disabled={!canRedo} />
        <IconButton title="Auto layout" onClick={onAutoLayout} icon={<WandSparkles size={16} />} />
        <IconButton
          title="Keyboard shortcuts"
          onClick={onShowShortcuts}
          icon={<Keyboard size={16} />}
        />
        <IconButton title="Reset preset" onClick={onReset} icon={<RotateCcw size={16} />} />
      </div>
    </header>
  );
}

function IconButton({
  title,
  onClick,
  icon,
  disabled = false,
}: {
  readonly title: string;
  readonly onClick: () => void;
  readonly icon: React.ReactNode;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
    </button>
  );
}

function ShortcutDialog({
  isApple,
  open,
  onClose,
}: {
  readonly isApple: boolean;
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const shortcuts = [
    {
      action: "Undo",
      description: "Previous graph edit",
      keys: [shortcutLabel(isApple, "Mod", "Z")],
    },
    {
      action: "Redo",
      description: "Restore undone edit",
      keys: [
        shortcutLabel(isApple, "Mod", "Shift", "Z"),
        ...(isApple ? [] : [shortcutLabel(isApple, "Mod", "Y")]),
      ],
    },
    {
      action: "Focus selection",
      description: "Center selected nodes",
      keys: ["F"],
    },
    {
      action: "Select all",
      description: "Select every node",
      keys: [shortcutLabel(isApple, "Mod", "A")],
    },
    {
      action: "Duplicate",
      description: "Copy selected nodes",
      keys: [shortcutLabel(isApple, "Mod", "D")],
    },
    {
      action: "Delete",
      description: "Remove selection",
      keys: ["Delete", "Backspace"],
    },
    {
      action: "Save",
      description: "Store local graph",
      keys: [shortcutLabel(isApple, "Mod", "S")],
    },
    {
      action: "Shortcuts",
      description: "Open this panel",
      keys: ["?"],
    },
    {
      action: "Dismiss",
      description: "Close active popover",
      keys: ["Esc"],
    },
  ];

  if (!open) {
    return null;
  }

  return (
    <div className="shortcut-backdrop" role="presentation" onPointerDown={onClose}>
      <section
        className="shortcut-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="shortcut-dialog-header">
          <div>
            <h2 id="shortcut-dialog-title">Keyboard Shortcuts</h2>
            <span>{isApple ? "macOS keymap" : "Windows/Linux keymap"}</span>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close shortcuts"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="shortcut-list">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.action} className="shortcut-row">
              <div>
                <strong>{shortcut.action}</strong>
                <span>{shortcut.description}</span>
              </div>
              <div className="shortcut-keys">
                {shortcut.keys.map((combo, index) => (
                  <span key={combo} className="shortcut-combo-group">
                    {index > 0 ? <span className="shortcut-key-separator">/</span> : null}
                    <span className="shortcut-combo">
                      {combo.split(" + ").map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CanvasSelectionRect({
  bounds,
  drag,
}: {
  readonly bounds: DOMRect | null;
  readonly drag: SelectionDragState;
}) {
  if (!bounds) {
    return null;
  }
  const rect = clientRectFromPoints(drag.start, drag.current);
  return (
    <div
      className="canvas-selection-rect"
      style={{
        height: rect.height,
        left: rect.left - bounds.left,
        top: rect.top - bounds.top,
        width: rect.width,
      }}
    />
  );
}

function formatNodeParameterValue(value: ParameterValue): string {
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

function ThreeFXNode({ data, selected }: NodeProps<FlowNode>) {
  const { definition, connectedPorts, parameterValues, onParameterChange } = data;
  const inputs = definition.ports.filter((port) => port.direction === "input");
  const outputs = definition.ports.filter((port) => port.direction === "output");
  const parameterMetadata = definition.parameterMetadata ?? [];
  const parameterSummary = parameterMetadata
    .map(
      (metadata) =>
        `${metadata.label}: ${formatNodeParameterValue(parameterValues[metadata.id] ?? metadata.defaultValue)}`,
    )
    .join(" / ");

  return (
    <article className={`graph-node ${selected ? "graph-node-selected" : ""}`}>
      {inputs.map((port, index) => (
        <PortKnob
          key={port.id}
          port={port}
          connected={connectedPorts.has(port.id)}
          index={index}
          side="left"
        />
      ))}
      {outputs.map((port, index) => (
        <PortKnob
          key={port.id}
          port={port}
          connected={connectedPorts.has(port.id)}
          index={index}
          side="right"
        />
      ))}
      <div className="graph-node-header">
        <span>{definition.label}</span>
        <small>{definition.category}</small>
      </div>
      <div className="port-grid">
        <div className="port-column">
          {inputs.map((port) => (
            <PortLabel key={port.id} port={port} side="left" />
          ))}
        </div>
        <div className="port-column port-column-right">
          {outputs.map((port) => (
            <PortLabel key={port.id} port={port} side="right" />
          ))}
        </div>
      </div>
      <NodeParameterPanel
        definition={definition}
        values={parameterValues}
        onParameterChange={onParameterChange}
      />
      {parameterSummary ? (
        <div className="node-value" title={parameterSummary}>
          {parameterSummary}
        </div>
      ) : null}
    </article>
  );
}

function groupParameterMetadata(
  parameters: readonly ParameterMetadata[],
): Array<{ group: string; parameters: readonly ParameterMetadata[] }> {
  const grouped = new Map<string, ParameterMetadata[]>();
  for (const parameter of parameters) {
    const group = parameter.group || "Parameters";
    grouped.set(group, [...(grouped.get(group) ?? []), parameter]);
  }
  return [...grouped.entries()].map(([group, groupParameters]) => ({
    group,
    parameters: groupParameters,
  }));
}

function defaultParameterGroupExpansion(
  groups: readonly { group: string; parameters: readonly ParameterMetadata[] }[],
): Record<string, boolean> {
  return Object.fromEntries(groups.map((group) => [group.group, false]));
}

function parameterGroupSignature(
  groups: readonly { group: string; parameters: readonly ParameterMetadata[] }[],
): string {
  return groups
    .map((group) => `${group.group}:${group.parameters.map((parameter) => parameter.id).join(",")}`)
    .join("|");
}

function NodeParameterPanel({
  definition,
  values,
  onParameterChange,
}: {
  readonly definition: NodeDefinition;
  readonly values: ParameterMap;
  readonly onParameterChange: (id: string, value: ParameterValue) => void;
}) {
  const parameterGroups = useMemo(
    () => groupParameterMetadata(definition.parameterMetadata ?? []),
    [definition.parameterMetadata],
  );
  const signature = useMemo(() => parameterGroupSignature(parameterGroups), [parameterGroups]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() =>
    defaultParameterGroupExpansion(parameterGroups),
  );

  useEffect(() => {
    setExpandedGroups(defaultParameterGroupExpansion(parameterGroups));
  }, [definition.type, parameterGroups, signature]);

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups((current) => ({
      ...current,
      [group]: !(current[group] ?? false),
    }));
  }, []);
  const expandAll = useCallback(() => {
    setExpandedGroups(Object.fromEntries(parameterGroups.map((group) => [group.group, true])));
  }, [parameterGroups]);
  const collapseAll = useCallback(() => {
    setExpandedGroups(defaultParameterGroupExpansion(parameterGroups));
  }, [parameterGroups]);

  if (parameterGroups.length === 0) {
    return null;
  }

  const parameterCount = parameterGroups.reduce(
    (count, group) => count + group.parameters.length,
    0,
  );
  const expandedCount = parameterGroups.filter((group) => expandedGroups[group.group]).length;
  const canExpandAll = expandedCount < parameterGroups.length;
  const canCollapseAll = expandedCount > 0;

  return (
    <div
      className="node-parameter-panel nodrag nopan"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="node-parameter-panel-header">
        <span>Parameters</span>
        <div className="node-parameter-panel-actions">
          <span className="node-parameter-count">{parameterCount}</span>
          <button
            type="button"
            title="Expand all parameter groups"
            aria-label={`Expand all ${definition.label} parameter groups`}
            disabled={!canExpandAll}
            onClick={expandAll}
          >
            <ChevronsUpDown size={13} />
          </button>
          <button
            type="button"
            title="Collapse all parameter groups"
            aria-label={`Collapse all ${definition.label} parameter groups`}
            disabled={!canCollapseAll}
            onClick={collapseAll}
          >
            <ChevronsDownUp size={13} />
          </button>
        </div>
      </div>
      <div className="node-parameter-groups">
        {parameterGroups.map((group) => {
          const expanded = expandedGroups[group.group] ?? false;
          return (
            <section key={group.group} className="node-parameter-group">
              <button
                type="button"
                className="node-parameter-group-trigger"
                aria-expanded={expanded}
                onClick={() => toggleGroup(group.group)}
              >
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span>{group.group}</span>
                <small>{group.parameters.length}</small>
              </button>
              {expanded ? (
                <div className="node-parameter-group-body">
                  {group.parameters.map((metadata) => (
                    <ParameterField
                      key={metadata.id}
                      metadata={metadata}
                      value={values[metadata.id] ?? metadata.defaultValue}
                      onChange={(value) => onParameterChange(metadata.id, value)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function PortKnob({
  port,
  connected,
  index,
  side,
}: {
  readonly port: PortDefinition;
  readonly connected: boolean;
  readonly index: number;
  readonly side: "left" | "right";
}) {
  const isSource = side === "right";
  return (
    <Handle
      id={port.id}
      type={isSource ? "source" : "target"}
      position={isSource ? Position.Right : Position.Left}
      className={`port-handle ${connected ? "port-handle-connected" : ""}`}
      data-port-connected={connected ? "true" : "false"}
      data-port-direction={port.direction}
      data-port-type={port.type}
      style={{ ...portToneStyle(port.type), top: 50 + index * 24 }}
      title={describePort(port)}
    />
  );
}

function PortLabel({
  port,
  side,
}: {
  readonly port: PortDefinition;
  readonly side: "left" | "right";
}) {
  const isSource = side === "right";
  return (
    <div
      className={`port-label ${isSource ? "port-label-out" : ""}`}
      data-port-direction={port.direction}
      data-port-type={port.type}
      style={portToneStyle(port.type)}
      title={describePort(port)}
    >
      <span>{port.label}</span>
    </div>
  );
}

function NodePalette({
  query,
  onQueryChange,
  quickAdd,
  graph,
  onAddNode,
}: {
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly quickAdd: QuickAddState | null;
  readonly graph: GraphDocument;
  readonly onAddNode: (
    type: string,
    position: { x: number; y: number },
    mode?: QuickAddMode,
  ) => void;
}) {
  const mode = quickAdd?.mode ?? { kind: "free" };
  const entries = useFilteredDefinitions(query, graph, mode);
  return (
    <aside className="node-palette">
      <div className="panel-heading">
        <h2>Nodes</h2>
        <Plus size={16} />
      </div>
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search"
        aria-label="Search nodes"
      />
      <div className="palette-list">
        {entries.map((entry) => (
          <button
            key={entry.type}
            type="button"
            className="palette-item"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/threefx-node", entry.type);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() =>
              onAddNode(entry.type, quickAdd?.flow ?? { x: -80, y: 40 }, quickAdd?.mode)
            }
          >
            <span>{entry.label}</span>
            <small>{getQuickAddEntrySubtitle(entry, graph, mode)}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

function useFilteredDefinitions(
  query: string,
  graph: GraphDocument,
  mode: QuickAddMode,
): readonly NodeDefinition[] {
  return useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const sourceNode =
      mode.kind === "fromOutput" ? graph.nodes.find((node) => node.id === mode.nodeId) : null;
    const sourcePort =
      sourceNode && mode.kind === "fromOutput" ? findNodePort(sourceNode, mode.portId) : null;
    const targetNode =
      mode.kind === "fromInput" ? graph.nodes.find((node) => node.id === mode.nodeId) : null;
    const targetPort =
      targetNode && mode.kind === "fromInput" ? findNodePort(targetNode, mode.portId) : null;
    return defaultNodeRegistry
      .list()
      .filter((definition) => {
        if (sourcePort && !nodeHasCompatibleInput(definition, sourcePort)) {
          return false;
        }
        if (targetPort && !nodeHasCompatibleOutput(definition, targetPort)) {
          return false;
        }
        if (!normalized) {
          return true;
        }
        return `${definition.label} ${definition.category} ${definition.type}`
          .toLowerCase()
          .includes(normalized);
      })
      .slice(0, 48);
  }, [graph.nodes, mode, query]);
}

function QuickAddPopover({
  graph,
  state,
  query,
  onQueryChange,
  onAddNode,
  onClose,
}: {
  readonly graph: GraphDocument;
  readonly state: QuickAddState;
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly onAddNode: (
    type: string,
    position: { x: number; y: number },
    mode?: QuickAddMode,
  ) => void;
  readonly onClose: () => void;
}) {
  const entries = useFilteredDefinitions(query, graph, state.mode);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="quick-add" style={{ left: state.screen.x, top: state.screen.y }}>
      <input
        autoFocus
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        aria-label="Add node"
        placeholder="Add node"
      />
      <div className="quick-add-list">
        {entries.map((entry) => (
          <button
            key={entry.type}
            type="button"
            onClick={() => onAddNode(entry.type, state.flow, state.mode)}
          >
            <span>{entry.label}</span>
            <small>{getQuickAddEntrySubtitle(entry, graph, state.mode)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function NodeContextMenu({
  state,
  onDuplicate,
  onDelete,
  onClose,
}: {
  readonly state: NodeMenuState;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [onClose]);
  return (
    <div
      className="node-menu"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" onClick={onDuplicate}>
        <Copy size={14} />
        <span>Duplicate</span>
      </button>
      <button type="button" onClick={onDelete}>
        <Trash2 size={14} />
        <span>Delete</span>
      </button>
    </div>
  );
}

function PerformancePanel({ telemetry }: { readonly telemetry: PreviewTelemetry }) {
  return (
    <section className="panel performance-panel">
      <div className="panel-heading">
        <h2>Performance</h2>
      </div>
      <div className="metric-grid">
        <Metric label="FPS" value={telemetry.fps > 0 ? String(telemetry.fps) : "--"} />
        <Metric
          label="Frame"
          value={telemetry.frameMs > 0 ? `${telemetry.frameMs.toFixed(1)} ms` : "--"}
        />
        <Metric
          label="Particles"
          value={`${telemetry.activeParticles}/${telemetry.maxParticles}`}
        />
        <Metric label="Renderer" value={telemetry.webgpuLabel} />
      </div>
    </section>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function GraphStatusPanel({
  compileResult,
  diagnostics,
  edgeCount,
  nodeCount,
}: {
  readonly diagnostics: readonly Diagnostic[];
  readonly compileResult: ReturnType<typeof compileGraphToIR>;
  readonly edgeCount: number;
  readonly nodeCount: number;
}) {
  const visibleDiagnostics = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "warning",
  );
  const exportError = compileResult.ir
    ? null
    : compileResult.diagnostics.find((diagnostic) => diagnostic.severity === "error");
  return (
    <section className="panel diagnostics-panel">
      <div className="panel-heading">
        <h2>Graph Overview</h2>
      </div>
      <div className="graph-facts">
        <Metric label="Nodes" value={String(nodeCount)} />
        <Metric label="Edges" value={String(edgeCount)} />
        <Metric label="Export" value={compileResult.ir ? "Ready" : "Blocked"} />
      </div>
      <div className="diagnostics">
        {visibleDiagnostics.slice(0, 6).map((diagnostic) => (
          <span key={diagnostic.id} className={`diagnostic diagnostic-${diagnostic.severity}`}>
            <CircleAlert size={14} />
            <span>{diagnostic.message}</span>
          </span>
        ))}
        {exportError &&
        !visibleDiagnostics.some((diagnostic) => diagnostic.id === exportError.id) ? (
          <span className="diagnostic diagnostic-error">
            <CircleAlert size={14} />
            <span>{exportError.message}</span>
          </span>
        ) : null}
      </div>
    </section>
  );
}

function ParameterField({
  metadata,
  value,
  onChange,
}: {
  readonly metadata: ParameterMetadata;
  readonly value: ParameterValue;
  readonly onChange: (value: ParameterValue) => void;
}) {
  if (metadata.type === "bool") {
    return (
      <label className="param-field param-field-row">
        <ParameterFieldLabel metadata={metadata} />
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  }

  if (metadata.type === "color") {
    return (
      <label className="param-field">
        <ParameterFieldLabel metadata={metadata} />
        <input
          type="color"
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }

  if (metadata.type === "quality") {
    return (
      <label className="param-field">
        <ParameterFieldLabel metadata={metadata} />
        <select value={String(value)} onChange={(event) => onChange(event.target.value)}>
          {(metadata.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (metadata.type === "vec3") {
    const tuple = Array.isArray(value) ? value : [0, 0, 0];
    return (
      <label className="param-field">
        <ParameterFieldLabel metadata={metadata} />
        <div className="vec-field">
          {[0, 1, 2].map((index) => (
            <input
              key={index}
              type="number"
              step={metadata.step ?? 0.1}
              value={Number(tuple[index] ?? 0)}
              onChange={(event) => {
                const next = [...tuple] as [number, number, number];
                next[index] = Number(event.target.value);
                onChange(next);
              }}
            />
          ))}
        </div>
      </label>
    );
  }

  return (
    <label className="param-field">
      <ParameterFieldLabel metadata={metadata} />
      <input
        type="number"
        min={metadata.min}
        max={metadata.max}
        step={metadata.step ?? 0.01}
        value={Number(value)}
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(metadata.type === "int" ? Math.round(next) : next);
        }}
      />
    </label>
  );
}

function ParameterFieldLabel({ metadata }: { readonly metadata: ParameterMetadata }) {
  const detail = [metadata.type, metadata.unit].filter(Boolean).join(" / ");
  return (
    <span className="param-field-label" title={metadata.description}>
      <span>{metadata.label}</span>
      <small>{detail}</small>
    </span>
  );
}

function PreviewViewport({
  params,
  onTelemetry,
}: {
  readonly params: WispySmokeVFXParams;
  readonly onTelemetry: (telemetry: PreviewTelemetry) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const effectRef = useRef<WispySmokeVFX | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const webgpu = useMemo(() => getWebGPUFeatureStatus(), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor("#06080d", 1);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog("#06080d", 4, 11);
    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 80);
    camera.position.set(0, 2.1, 7.2);
    camera.lookAt(0, 1.8, 0);

    const grid = new THREE.GridHelper(5.5, 16, "#243244", "#151d2a");
    grid.position.y = -0.02;
    scene.add(grid);
    const effect = new WispySmokeVFX({ ...params, renderer });
    scene.add(effect.object3D);
    effectRef.current = effect;
    onTelemetry({
      ...EMPTY_PREVIEW_STATS,
      ...effect.getStats(),
      webgpuLabel: webgpu.supported ? "WebGPU available" : "Compatible preview",
      webgpuSupported: webgpu.supported,
    });

    let frame = 0;
    let last = performance.now();
    let statsElapsed = 0;
    let statsFrames = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const tick = (now: number) => {
      const rawDelta = Math.max(0, (now - last) / 1000);
      const delta = Math.min(0.05, rawDelta);
      const sampleDelta = rawDelta > 0.5 ? 0 : rawDelta;
      last = now;
      effect.update(delta, now / 1000);
      renderer.render(scene, camera);
      if (sampleDelta > 0) {
        statsElapsed += sampleDelta;
        statsFrames += 1;
      }
      if (statsElapsed >= 0.25) {
        const averageFrameSeconds = statsElapsed / statsFrames;
        onTelemetry({
          ...effect.getStats(),
          fps: Math.round(statsFrames / Math.max(statsElapsed, 0.001)),
          frameMs: averageFrameSeconds * 1000,
          webgpuLabel: webgpu.supported ? "WebGPU available" : "Compatible preview",
          webgpuSupported: webgpu.supported,
        });
        statsElapsed = 0;
        statsFrames = 0;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      effect.dispose();
      renderer.dispose();
      rendererRef.current = null;
      effectRef.current = null;
    };
  }, [onTelemetry, webgpu.supported]);

  useEffect(() => {
    effectRef.current?.setParams(params);
  }, [params]);

  return (
    <section className="preview-panel">
      <canvas ref={canvasRef} aria-label="Wispy Smoke preview" />
    </section>
  );
}

function ExportPanel({
  compileResult,
}: {
  readonly compileResult: ReturnType<typeof compileGraphToIR>;
}) {
  const exportPackage = useMemo(
    () =>
      compileResult.ir
        ? exportEffectToTypeScript(compileResult.ir, { className: "WispySmokeVFX" })
        : null,
    [compileResult.ir],
  );
  const [message, setMessage] = useState("");

  const copy = useCallback(async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setMessage(`${label} copied`);
  }, []);

  const downloadZip = useCallback(() => {
    if (!exportPackage) {
      return;
    }
    const bytes = createExportZip(exportPackage);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const blob = new Blob([buffer], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "wispy-smoke-vfx.zip";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Zip exported");
  }, [exportPackage]);

  return (
    <section className="panel export-panel">
      <div className="panel-heading">
        <h2>Export</h2>
        <Download size={16} />
      </div>
      {exportPackage ? (
        <div className="export-actions">
          <button type="button" onClick={() => void copy(exportPackage.mainClassSource, "Class")}>
            <Copy size={15} />
            <span>Class</span>
          </button>
          <button type="button" onClick={() => void copy(exportPackage.usageSnippet, "Usage")}>
            <Clipboard size={15} />
            <span>Usage</span>
          </button>
          <button type="button" onClick={downloadZip}>
            <Download size={15} />
            <span>Zip</span>
          </button>
          <small>{message || exportPackage.graphHash}</small>
        </div>
      ) : (
        <div className="export-blocked">
          {compileResult.diagnostics.find((entry) => entry.severity === "error")?.message ??
            "Graph invalid"}
        </div>
      )}
    </section>
  );
}

export default App;
