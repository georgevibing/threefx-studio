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
  type Viewport,
} from "@xyflow/react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleAlert,
  Clipboard,
  Copy,
  Download,
  FileDown,
  FolderOpen,
  Keyboard,
  Link2,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
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
  createWispySmokeRuntimeConfig,
  defaultNodeRegistry,
  deserializeGraphDocument,
  findNodePort,
  getDefaultParameterNodeValue,
  getParameterNodeOptions,
  getParameterNodeValueType,
  isEditableValuePort,
  resolveWispySmokeParameterValues,
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
  type ParameterType,
  type ParameterValue,
  type PortDefinition,
  type PortType,
  type WispySmokeRuntimeConfig,
} from "@threefx/core";
import { WispySmokeVFX, type WispySmokeVFXParams, type WispySmokeVFXStats } from "@threefx/effects";
import { createExportZip, exportEffectToTypeScript } from "@threefx/exporter";
import { getWebGPUFeatureStatus } from "@threefx/runtime";
import { getPortTypeTone } from "@threefx/ui";
import {
  createLocalStorageEditorPersistence,
  createLocalStorageEditorPreference,
} from "./editorPersistence";
import {
  createEditorPresetGraph,
  EDITOR_PRESETS,
  getEditorPreset,
  type EditorPreset,
  type EditorPresetId,
} from "./editorPresets";
import {
  createNodeSearchMatches,
  searchGraph,
  searchHighlightRanges,
  type GraphSearchResult,
  type NodeSearchMatchView,
} from "./graphSearch";
import {
  editableInputEntries,
  formatNodeParameterValue,
  groupParameterEntries,
  resolveNodeInputBindings,
  type NodeInputBindingView,
  type NodeParameterEntry,
  type NodeParameterGroup,
} from "./nodeParameterModel";

type FlowNodeData = {
  readonly definition: NodeDefinition;
  readonly connectedPorts: ReadonlySet<string>;
  readonly graphParameters: ParameterMap;
  readonly inputBindings: readonly NodeInputBindingView[];
  readonly node: GraphNode;
  readonly onFocusNode: (nodeId: string) => void;
  readonly onNodeLabelChange: (nodeId: string, label: string) => void;
  readonly onNodeParameterChange: (
    nodeId: string,
    id: string,
    value: ParameterValue,
    options?: ParameterChangeOptions,
  ) => void;
  readonly searchMatch: NodeSearchMatchView | null;
  readonly searchQuery: string;
};

type FlowNode = Node<FlowNodeData, "threefxNode">;
type FlowEdge = Edge;

const FLOW_NODE_TYPES = { threefxNode: ThreeFXNode };
const FLOW_PRO_OPTIONS = { hideAttribution: true };

type FlowNodeMeasurement = {
  readonly height?: number;
  readonly measured?: {
    readonly height?: number;
    readonly width?: number;
  };
  readonly width?: number;
};

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
};

type ParameterChangeOptions = {
  readonly commitTransient?: boolean;
  readonly transient?: boolean;
};

type PreviewTelemetry = PreviewPerformanceStats & {
  readonly webgpuSupported: boolean;
  readonly webgpuLabel: string;
};

type ToastMessage = {
  readonly id: number;
  readonly message: string;
};

type NodeMenuState = {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
};

type NodeDefinitionGroup = {
  readonly category: string;
  readonly definitions: readonly NodeDefinition[];
};

type SelectionDragState = {
  readonly active: boolean;
  readonly additive: boolean;
  readonly current: { readonly x: number; readonly y: number };
  readonly pointerId: number;
  readonly start: { readonly x: number; readonly y: number };
};

type StartupGraphSource = "preset" | "saved-graph";

const LOCAL_STORAGE_KEY = "threefx-studio:wispy-smoke-graph:v1";
const NODE_PALETTE_EXPANDED_STORAGE_KEY = "threefx-studio:node-palette-visible:v1";
const STARTUP_GRAPH_CONFIG: {
  readonly presetId: EditorPresetId;
  readonly source: StartupGraphSource;
} = {
  presetId: "wispy-smoke",
  source: "preset",
};
const editorPersistence = createLocalStorageEditorPersistence(LOCAL_STORAGE_KEY);
const nodePaletteExpandedPersistence = createLocalStorageEditorPreference<boolean>(
  NODE_PALETTE_EXPANDED_STORAGE_KEY,
  {
    parse(source) {
      if (source === "true") {
        return true;
      }
      if (source === "false") {
        return false;
      }
      throw new Error(`Invalid node palette visibility preference '${source}'.`);
    },
    serialize(value) {
      return value ? "true" : "false";
    },
  },
);
const EMPTY_PREVIEW_STATS: PreviewPerformanceStats = {
  activeDebugView: "final",
  advectionMode: "trilinear",
  backend: "compat",
  diffusionIterations: 0,
  emitterCount: 0,
  fallbackActive: true,
  fieldCount: 0,
  fps: 0,
  forceCount: 0,
  frameMs: 0,
  gridCells: 0,
  gridResolution: [0, 0, 0],
  obstacleCount: 0,
  pressureIterations: 0,
  renderSteps: 0,
  requestedBackend: "auto",
  simulationMs: 0,
  solverPasses: 0,
};
const HISTORY_LIMIT = 100;
const QUICK_ADD_WIDTH = 280;
const QUICK_ADD_ANCHOR_Y = 42;
const QUICK_ADD_VIEWPORT_MARGIN = 12;
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
  field: 2,
  force: 3,
  obstacle: 3,
  simulation: 4,
  debug: 5,
  render: 6,
  output: 7,
};
const AUTO_LAYOUT_KIND_ORDER: Record<string, number> = {
  output: 0,
  emitter: 1,
  field: 2,
  force: 3,
  obstacle: 4,
  simulation: 5,
  debug: 6,
  render: 7,
  transform: 8,
  quality: 9,
  parameter: 10,
};
const PREVIEW_WEBGPU_PIXEL_RATIO_CAP = 1;
const PREVIEW_WEBGL_PIXEL_RATIO_CAP = 2;
const PREVIEW_WEBGPU_INTERNAL_PIXEL_BUDGET = 1_150_000;
const PREVIEW_WEBGL_INTERNAL_PIXEL_BUDGET = 2_000_000;
const DEFAULT_FLOW_VIEWPORT: Viewport = { x: 120, y: 80, zoom: 0.82 };
const EMPTY_GRAPH_SEARCH_RESULTS: readonly GraphSearchResult[] = [];

function normalizedSearchResultIndex(index: number, count: number): number {
  if (count <= 0) {
    return -1;
  }
  return Math.max(0, Math.min(index, count - 1));
}

function loadInitialGraph(): GraphDocument {
  return createEditorPresetGraph(STARTUP_GRAPH_CONFIG.presetId);
}

function shouldHydrateSavedGraphOnStartup(): boolean {
  return STARTUP_GRAPH_CONFIG.source === "saved-graph";
}

function viewportForGraph(graph: GraphDocument): Viewport {
  return graph.viewport ?? DEFAULT_FLOW_VIEWPORT;
}

function normalizeViewport(viewport: Viewport): Viewport {
  return {
    x: Number(viewport.x.toFixed(2)),
    y: Number(viewport.y.toFixed(2)),
    zoom: Number(viewport.zoom.toFixed(4)),
  };
}

function viewportEquals(left: Viewport | undefined, right: Viewport): boolean {
  if (!left) {
    return false;
  }
  return (
    Math.abs(left.x - right.x) < 0.01 &&
    Math.abs(left.y - right.y) < 0.01 &&
    Math.abs(left.zoom - right.zoom) < 0.0001
  );
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
  nodeMeasurements: ReadonlyMap<string, FlowNodeMeasurement>,
  searchMatches: ReadonlyMap<string, NodeSearchMatchView>,
  searchQuery: string,
  onNodeParameterChange: (
    nodeId: string,
    id: string,
    value: ParameterValue,
    options?: ParameterChangeOptions,
  ) => void,
  onNodeLabelChange: (nodeId: string, label: string) => void,
  onFocusNode: (nodeId: string) => void,
): FlowNode[] {
  const connected = connectedPorts(graph.edges);
  return graph.nodes.flatMap((node) => {
    const definition = defaultNodeRegistry.get(node.type);
    if (!definition) {
      return [];
    }
    const measurement = nodeMeasurements.get(node.id);
    return [
      {
        id: node.id,
        type: "threefxNode",
        position: { x: node.position[0], y: node.position[1] },
        selected: selectedNodeIds.has(node.id),
        ...(measurement ?? {}),
        data: {
          definition,
          connectedPorts: connected.get(node.id) ?? new Set<string>(),
          graphParameters: graph.parameters,
          inputBindings: resolveNodeInputBindings(graph, node),
          node,
          onFocusNode,
          onNodeLabelChange,
          onNodeParameterChange,
          searchMatch: searchMatches.get(node.id) ?? null,
          searchQuery,
        },
      },
    ];
  });
}

function graphWithNodeParameter(
  graph: GraphDocument,
  nodeId: string,
  id: string,
  value: ParameterValue,
): GraphDocument {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.id !== nodeId) {
        return node;
      }
      return {
        ...node,
        parameters: {
          ...(node.parameters ?? {}),
          [id]: value,
        },
      };
    }),
  };
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

function alternateShortcutModifierLabel(isApple: boolean): string {
  return isApple ? "Option" : "Alt";
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
  if (definition.kind === "parameter") {
    return { width: AUTO_LAYOUT_NODE_WIDTH, height: 178 };
  }
  const inputCount = definition.ports.filter((port) => port.direction === "input").length;
  const outputCount = definition.ports.filter((port) => port.direction === "output").length;
  const portRows = Math.max(inputCount, outputCount, 2);
  const portGridHeight = Math.max(48, portRows * 18 + Math.max(0, portRows - 1) * 10 + 24);
  const parameters = definition.ports.filter(isEditableValuePort);
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

function nodeKindToneStyle(kind: string): React.CSSProperties {
  const tone = getPortTypeTone(kind);
  return {
    "--category-color": tone.accent,
    "--category-background": tone.background,
    "--category-border-color": tone.border,
  } as React.CSSProperties;
}

function nodeCategoryToneStyle(category: NodeDefinitionGroup): React.CSSProperties {
  return nodeKindToneStyle(category.definitions[0]?.kind ?? "any");
}

function nodeDefinitionPickerItemToneStyle(definition: NodeDefinition): React.CSSProperties {
  const parameterType = getParameterNodeValueType(definition.type);
  const tone = getPortTypeTone(parameterType ?? definition.kind);
  return {
    "--category-color": tone.accent,
    "--category-background": tone.background,
    "--category-border-color": tone.border,
  } as React.CSSProperties;
}

function groupNodeDefinitions(
  definitions: readonly NodeDefinition[],
): readonly NodeDefinitionGroup[] {
  const groups = new Map<string, NodeDefinition[]>();
  for (const definition of definitions) {
    const existing = groups.get(definition.category) ?? [];
    existing.push(definition);
    groups.set(definition.category, existing);
  }
  return [...groups.entries()].map(([category, entries]) => ({
    category,
    definitions: entries,
  }));
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

function clampQuickAddScreenPosition(screen: { readonly x: number; readonly y: number }): {
  readonly x: number;
  readonly y: number;
} {
  const width = Math.min(
    QUICK_ADD_WIDTH,
    Math.max(0, window.innerWidth - QUICK_ADD_VIEWPORT_MARGIN * 2),
  );
  const maxX = Math.max(
    QUICK_ADD_VIEWPORT_MARGIN,
    window.innerWidth - width - QUICK_ADD_VIEWPORT_MARGIN,
  );
  return {
    x: Math.min(Math.max(screen.x, QUICK_ADD_VIEWPORT_MARGIN), maxX),
    y: Math.max(screen.y, QUICK_ADD_VIEWPORT_MARGIN),
  };
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

function nodeDimensionChanges(changes: readonly NodeChange<FlowNode>[]) {
  return changes.filter(
    (
      change,
    ): change is NodeChange<FlowNode> & {
      readonly dimensions: { readonly height: number; readonly width: number };
      readonly id: string;
      readonly setAttributes?: boolean | "width" | "height";
      readonly type: "dimensions";
    } => change.type === "dimensions" && "dimensions" in change && Boolean(change.dimensions),
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

function flowNodeMeasurementEquals(
  first: FlowNodeMeasurement | undefined,
  second: FlowNodeMeasurement,
): boolean {
  return (
    first?.measured?.width === second.measured?.width &&
    first?.measured?.height === second.measured?.height &&
    first?.width === second.width &&
    first?.height === second.height
  );
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
      ".react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .quick-add, .node-context-menu, .canvas-search-popover, .pending-quick-add-edge",
    )
  ) {
    return false;
  }
  return Boolean(target.closest(".react-flow__pane"));
}

function targetIsInsideElement(target: EventTarget | null, element: Element | null): boolean {
  return target instanceof Node && Boolean(element?.contains(target));
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
  const [canvasSearchOpen, setCanvasSearchOpen] = useState(false);
  const [canvasSearchQuery, setCanvasSearchQuery] = useState("");
  const [canvasSearchActiveIndex, setCanvasSearchActiveIndex] = useState(0);
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
  const [isMiddlePanning, setIsMiddlePanning] = useState(false);
  const [isNodePaletteExpanded, setIsNodePaletteExpanded] = useState(false);
  const [isShortcutDialogOpen, setIsShortcutDialogOpen] = useState(false);
  const [isPresetDialogOpen, setIsPresetDialogOpen] = useState(false);
  const [isEditorHydrating, setIsEditorHydrating] = useState(() =>
    shouldHydrateSavedGraphOnStartup(),
  );
  const [flowNodeMeasurements, setFlowNodeMeasurements] = useState<
    ReadonlyMap<string, FlowNodeMeasurement>
  >(() => new Map());
  const [historyRevision, setHistoryRevision] = useState(0);
  const [canvasBounds, setCanvasBounds] = useState<DOMRect | null>(null);
  const [selectionDrag, setSelectionDragState] = useState<SelectionDragState | null>(null);
  const [previewTelemetry, setPreviewTelemetry] = useState<PreviewTelemetry>({
    ...EMPTY_PREVIEW_STATS,
    webgpuLabel: "Checking",
    webgpuSupported: false,
  });
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [isApple] = useState(() => isApplePlatform());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasPanelRef = useRef<HTMLDivElement | null>(null);
  const canvasSearchInputRef = useRef<HTMLInputElement | null>(null);
  const canvasSearchPopoverRef = useRef<HTMLDivElement | null>(null);
  const canvasSearchFocusedResultKeyRef = useRef<string | null>(null);
  const nodePaletteRef = useRef<HTMLElement | null>(null);
  const nodePaletteSearchInputRef = useRef<HTMLInputElement | null>(null);
  const pendingMoveSnapshotRef = useRef<EditorSnapshot | null>(null);
  const pendingNodePaletteSearchFocusRef = useRef(false);
  const pendingParameterSnapshotRef = useRef<EditorSnapshot | null>(null);
  const selectionBaseNodeIdsRef = useRef<ReadonlySet<string>>(new Set());
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const nodePalettePreferenceTouchedRef = useRef(false);
  const suppressNextNodeSelectionChangeRef = useRef(false);
  const suppressNextPaneClickRef = useRef(false);
  const toastTimeoutRef = useRef<number | null>(null);
  const undoStackRef = useRef<EditorSnapshot[]>([]);
  const redoStackRef = useRef<EditorSnapshot[]>([]);
  const { fitView, flowToScreenPosition, getNodes, screenToFlowPosition, setCenter, setViewport } =
    useReactFlow<FlowNode, FlowEdge>();
  const canUndo = historyRevision >= 0 && undoStackRef.current.length > 0;
  const canRedo = historyRevision >= 0 && redoStackRef.current.length > 0;

  const setSelectionDrag = useCallback((next: SelectionDragState | null) => {
    selectionDragRef.current = next;
    setSelectionDragState(next);
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast({ id: Date.now(), message });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 3200);
  }, []);

  useEffect(
    () => () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    },
    [],
  );

  const createSnapshot = useCallback(
    (sourceGraph: GraphDocument = graph): EditorSnapshot => ({
      graph: sourceGraph,
      selectedEdgeIds: [...selectedEdgeIds],
      selectedNodeIds: [...selectedNodeIds],
    }),
    [graph, selectedEdgeIds, selectedNodeIds],
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
    setQuickAdd(null);
    setNodeMenu(null);
    setIsPresetDialogOpen(false);
  }, []);

  useEffect(() => {
    if (!shouldHydrateSavedGraphOnStartup()) {
      return;
    }
    let disposed = false;
    void editorPersistence
      .load()
      .then((result) => {
        if (disposed) {
          return;
        }
        if (result.status === "missing") {
          return;
        }
        if (result.status === "error") {
          showToast(`Local graph load failed: ${result.message}`);
          return;
        }
        pendingMoveSnapshotRef.current = null;
        undoStackRef.current = [];
        redoStackRef.current = [];
        setHistoryRevision((revision) => revision + 1);
        setGraph(result.state.graph);
        setSelectedNodeIds(new Set());
        setSelectedEdgeIds(new Set());
        setQuickAdd(null);
        setNodeMenu(null);
        setIsPresetDialogOpen(false);
        setFlowNodeMeasurements(new Map());
        showToast(
          result.valid ? "Loaded saved graph" : "Loaded saved graph with validation errors",
        );
      })
      .catch((error) => {
        if (!disposed) {
          console.error(error);
          showToast("Local graph load failed");
        }
      })
      .finally(() => {
        if (!disposed) {
          setIsEditorHydrating(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [showToast]);

  useEffect(() => {
    let disposed = false;
    void nodePaletteExpandedPersistence.load().then((result) => {
      if (disposed || nodePalettePreferenceTouchedRef.current) {
        return;
      }
      if (result.status === "loaded") {
        setIsNodePaletteExpanded(result.value);
      } else if (result.status === "error") {
        console.warn(result.message);
      }
    });
    return () => {
      disposed = true;
    };
  }, []);

  const setNodePaletteExpandedPreference = useCallback((next: boolean) => {
    nodePalettePreferenceTouchedRef.current = true;
    setIsNodePaletteExpanded(next);
    void nodePaletteExpandedPersistence.save(next).catch((error) => {
      console.error(error);
    });
  }, []);

  const toggleNodePalette = useCallback(() => {
    setNodePaletteExpandedPreference(!isNodePaletteExpanded);
  }, [isNodePaletteExpanded, setNodePaletteExpandedPreference]);

  const focusNodePaletteSearch = useCallback(() => {
    if (!isNodePaletteExpanded) {
      pendingNodePaletteSearchFocusRef.current = true;
      setNodePaletteExpandedPreference(true);
      return;
    }
    const input = nodePaletteSearchInputRef.current;
    if (!input) {
      pendingNodePaletteSearchFocusRef.current = true;
      return;
    }
    input.focus();
    input.select();
  }, [isNodePaletteExpanded, setNodePaletteExpandedPreference]);

  useEffect(() => {
    if (!isNodePaletteExpanded || !pendingNodePaletteSearchFocusRef.current) {
      return;
    }
    pendingNodePaletteSearchFocusRef.current = false;
    window.requestAnimationFrame(() => {
      const input = nodePaletteSearchInputRef.current;
      input?.focus();
      input?.select();
    });
  }, [isNodePaletteExpanded]);

  const focusCanvasSearchInput = useCallback((selectText = false) => {
    window.requestAnimationFrame(() => {
      const input = canvasSearchInputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      if (selectText) {
        input.select();
      }
    });
  }, []);

  const openCanvasSearch = useCallback(() => {
    canvasSearchFocusedResultKeyRef.current = null;
    setCanvasSearchOpen(true);
    focusCanvasSearchInput(true);
  }, [focusCanvasSearchInput]);

  const dismissCanvasSearch = useCallback(() => {
    canvasSearchFocusedResultKeyRef.current = null;
    setCanvasSearchOpen(false);
  }, []);

  const updateCanvasSearchQuery = useCallback((query: string) => {
    canvasSearchFocusedResultKeyRef.current = null;
    setCanvasSearchQuery(query);
    setCanvasSearchActiveIndex(0);
  }, []);

  const clearCanvasSearchQuery = useCallback(() => {
    updateCanvasSearchQuery("");
    focusCanvasSearchInput(false);
  }, [focusCanvasSearchInput, updateCanvasSearchQuery]);

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
        showToast(options.status);
      }
      return true;
    },
    [createSnapshot, graph, pushUndoSnapshot, showToast],
  );

  const undoEdit = useCallback(() => {
    const snapshot = undoStackRef.current.pop();
    if (!snapshot) {
      return;
    }
    redoStackRef.current.push(createSnapshot(graph));
    restoreSnapshot(snapshot);
    showToast("Undo");
    setHistoryRevision((revision) => revision + 1);
  }, [createSnapshot, graph, restoreSnapshot, showToast]);

  const redoEdit = useCallback(() => {
    const snapshot = redoStackRef.current.pop();
    if (!snapshot) {
      return;
    }
    undoStackRef.current.push(createSnapshot(graph));
    restoreSnapshot(snapshot);
    showToast("Redo");
    setHistoryRevision((revision) => revision + 1);
  }, [createSnapshot, graph, restoreSnapshot, showToast]);

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
          let node = defaultNodeRegistry.instantiate(type, id, [position.x, position.y]);
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
              if (definition.kind === "parameter" && targetPort) {
                node = {
                  ...node,
                  label: targetPort.label,
                  parameters: {
                    ...(node.parameters ?? {}),
                    value:
                      targetPort.defaultValue ??
                      getDefaultParameterNodeValue(getParameterNodeValueType(type) ?? "float"),
                  },
                };
              }
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

  const updateNodeParameter = useCallback(
    (nodeId: string, id: string, value: ParameterValue, options: ParameterChangeOptions = {}) => {
      if (options.transient || options.commitTransient) {
        if (!pendingParameterSnapshotRef.current) {
          pendingParameterSnapshotRef.current = createSnapshot(graph);
        }
        setGraph((current) => graphWithNodeParameter(current, nodeId, id, value));
        if (options.commitTransient) {
          pushUndoSnapshot(pendingParameterSnapshotRef.current);
          pendingParameterSnapshotRef.current = null;
        }
        return;
      }

      if (pendingParameterSnapshotRef.current) {
        pushUndoSnapshot(pendingParameterSnapshotRef.current);
        pendingParameterSnapshotRef.current = null;
      }
      commitGraphChange((current) => graphWithNodeParameter(current, nodeId, id, value));
    },
    [commitGraphChange, createSnapshot, graph, pushUndoSnapshot],
  );

  const updateNodeLabel = useCallback(
    (nodeId: string, label: string) => {
      const nextLabel = label.trim();
      if (!nextLabel) {
        return;
      }
      commitGraphChange((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === nodeId ? { ...node, label: nextLabel } : node,
        ),
      }));
    },
    [commitGraphChange],
  );

  const focusGraphNode = useCallback(
    (nodeId: string) => {
      const graphNode = graph.nodes.find((node) => node.id === nodeId);
      if (!graphNode) {
        return;
      }
      setSelectedNodeIds(new Set([nodeId]));
      setSelectedEdgeIds(new Set());
      setQuickAdd(null);
      setNodeMenu(null);
      const flowNode = getNodes().find((node) => node.id === nodeId) as
        | (FlowNode & {
            readonly height?: number;
            readonly measured?: { readonly width?: number; readonly height?: number };
            readonly width?: number;
          })
        | undefined;
      const estimated = estimateAutoLayoutNodeSize(
        graphNode,
        defaultNodeRegistry.get(graphNode.type),
      );
      const width = flowNode?.measured?.width ?? flowNode?.width ?? AUTO_LAYOUT_NODE_WIDTH;
      const height = flowNode?.measured?.height ?? flowNode?.height ?? estimated.height;
      void setCenter(graphNode.position[0] + width / 2, graphNode.position[1] + height / 2, {
        zoom: 1.12,
        duration: 180,
      });
    },
    [getNodes, graph.nodes, setCenter],
  );

  const isCanvasSearchActive = canvasSearchOpen && canvasSearchQuery.trim().length > 0;
  const canvasSearchResults = useMemo(
    () => (isCanvasSearchActive ? searchGraph(graph, canvasSearchQuery) : EMPTY_GRAPH_SEARCH_RESULTS),
    [canvasSearchQuery, graph, isCanvasSearchActive],
  );
  const canvasSearchResultCount = canvasSearchResults.length;
  const visibleCanvasSearchIndex = normalizedSearchResultIndex(
    canvasSearchActiveIndex,
    canvasSearchResultCount,
  );
  const activeCanvasSearchResult =
    visibleCanvasSearchIndex >= 0 ? canvasSearchResults[visibleCanvasSearchIndex] : null;
  const canvasNodeSearchMatches = useMemo(
    () =>
      isCanvasSearchActive
        ? createNodeSearchMatches(canvasSearchResults, activeCanvasSearchResult?.key ?? null)
        : new Map<string, NodeSearchMatchView>(),
    [activeCanvasSearchResult?.key, canvasSearchResults, isCanvasSearchActive],
  );

  useEffect(() => {
    setCanvasSearchActiveIndex((current) =>
      canvasSearchResultCount === 0
        ? 0
        : Math.max(0, Math.min(current, canvasSearchResultCount - 1)),
    );
  }, [canvasSearchResultCount]);

  const focusCanvasSearchResult = useCallback(
    (index: number) => {
      const result = canvasSearchResults[index];
      if (!result) {
        return;
      }
      canvasSearchFocusedResultKeyRef.current = result.key;
      setCanvasSearchActiveIndex(index);
      focusGraphNode(result.nodeId);
      focusCanvasSearchInput(false);
    },
    [canvasSearchResults, focusCanvasSearchInput, focusGraphNode],
  );

  const jumpCanvasSearchResult = useCallback(
    (direction: -1 | 1) => {
      if (canvasSearchResultCount === 0) {
        return;
      }
      const currentIndex = visibleCanvasSearchIndex >= 0 ? visibleCanvasSearchIndex : 0;
      const nextIndex =
        (currentIndex + direction + canvasSearchResultCount) % canvasSearchResultCount;
      focusCanvasSearchResult(nextIndex);
    },
    [canvasSearchResultCount, focusCanvasSearchResult, visibleCanvasSearchIndex],
  );

  const confirmOrJumpCanvasSearchResult = useCallback(
    (direction: -1 | 1) => {
      if (canvasSearchResultCount === 0 || visibleCanvasSearchIndex < 0) {
        return;
      }
      const activeResult = canvasSearchResults[visibleCanvasSearchIndex];
      if (!activeResult) {
        return;
      }
      if (canvasSearchFocusedResultKeyRef.current !== activeResult.key) {
        focusCanvasSearchResult(visibleCanvasSearchIndex);
        return;
      }
      jumpCanvasSearchResult(direction);
    },
    [
      canvasSearchResultCount,
      canvasSearchResults,
      focusCanvasSearchResult,
      jumpCanvasSearchResult,
      visibleCanvasSearchIndex,
    ],
  );

  const validation = useMemo(() => validateGraphDocument(graph), [graph]);
  const compileResult = useMemo(() => compileGraphToIR(graph), [graph]);
  const flowNodes = useMemo(
    () =>
      graphToFlowNodes(
        graph,
        selectedNodeIds,
        flowNodeMeasurements,
        canvasNodeSearchMatches,
        isCanvasSearchActive ? canvasSearchQuery : "",
        updateNodeParameter,
        updateNodeLabel,
        focusGraphNode,
      ),
    [
      canvasNodeSearchMatches,
      canvasSearchQuery,
      flowNodeMeasurements,
      focusGraphNode,
      graph,
      isCanvasSearchActive,
      selectedNodeIds,
      updateNodeLabel,
      updateNodeParameter,
    ],
  );
  const flowEdges = useMemo(
    () => graphToFlowEdges(graph, selectedEdgeIds),
    [graph, selectedEdgeIds],
  );

  const saveLocal = useCallback(() => {
    if (isEditorHydrating) {
      showToast("Loading saved graph");
      return;
    }
    void editorPersistence
      .save({ graph })
      .then(() => showToast("Saved graph locally"))
      .catch((error) => {
        console.error(error);
        showToast("Save failed");
      });
  }, [graph, isEditorHydrating, showToast]);

  const loadLocal = useCallback(() => {
    if (isEditorHydrating) {
      showToast("Loading saved graph");
      return;
    }
    void editorPersistence.load().then((result) => {
      if (result.status === "missing") {
        showToast("No local graph saved");
        return;
      }
      if (result.status === "error") {
        showToast(`Local graph load failed: ${result.message}`);
        return;
      }
      commitGraphChange(() => result.state.graph, {
        nextSelectedEdgeIds: [],
        nextSelectedNodeIds: [],
        status: result.valid ? "Loaded local graph" : "Loaded graph with validation errors",
      });
      void setViewport(viewportForGraph(result.state.graph));
    });
  }, [commitGraphChange, isEditorHydrating, setViewport, showToast]);

  const startFromPreset = useCallback(
    (presetId: EditorPresetId) => {
      const preset = getEditorPreset(presetId);
      const nextGraph = createEditorPresetGraph(presetId);
      commitGraphChange(() => nextGraph, {
        nextSelectedEdgeIds: [],
        nextSelectedNodeIds: [],
        status: `Loaded ${preset.name} preset`,
      });
      setFlowNodeMeasurements(new Map());
      setQuickAdd(null);
      setNodeMenu(null);
      setIsPresetDialogOpen(false);
      void setViewport(viewportForGraph(nextGraph));
    },
    [commitGraphChange, setViewport],
  );

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
        void setViewport(viewportForGraph(result.graph));
      });
      reader.readAsText(file);
    },
    [commitGraphChange, setViewport],
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
      const clampedScreen = clampQuickAddScreenPosition(screen);
      setQuickAdd({
        screen: clampedScreen,
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

  const clearSelection = useCallback(() => {
    setSelectedNodeIds((current) => (current.size === 0 ? current : new Set<string>()));
    setSelectedEdgeIds((current) => (current.size === 0 ? current : new Set<string>()));
  }, []);

  const handleCanvasPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        !isEditableEventTarget(event.target) &&
        event.target instanceof Element &&
        event.target.closest(".react-flow__pane")
      ) {
        event.currentTarget.focus({ preventScroll: true });
      }
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
        } else {
          clearSelection();
          setQuickAdd(null);
          setNodeMenu(null);
        }
        setSelectionDrag(null);
      }
      setIsMiddlePanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [clearSelection, setSelectionDrag],
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
      if (event.defaultPrevented) {
        return;
      }
      const key = event.key.toLowerCase();
      const primary = isPrimaryModifierPressed(event, isApple);
      const target = event.target;
      const isNodePaletteTarget =
        target instanceof window.Node && Boolean(nodePaletteRef.current?.contains(target));
      const isCanvasSearchTarget = targetIsInsideElement(target, canvasSearchPopoverRef.current);
      const isCanvasTarget = targetIsInsideElement(target, canvasPanelRef.current);
      if (primary && key === "s") {
        consumeShortcutEvent(event);
        saveLocal();
        return;
      }
      if (primary && key === "l") {
        consumeShortcutEvent(event);
        loadLocal();
        return;
      }
      if (primary && key === "f" && isNodePaletteTarget) {
        consumeShortcutEvent(event);
        focusNodePaletteSearch();
        return;
      }
      if (primary && key === "f" && (isCanvasSearchTarget || (isCanvasTarget && !isEditableEventTarget(target)))) {
        consumeShortcutEvent(event);
        openCanvasSearch();
        return;
      }
      if (event.key === "Escape" && canvasSearchOpen) {
        consumeShortcutEvent(event);
        dismissCanvasSearch();
        return;
      }
      if (isEditableEventTarget(event.target)) {
        return;
      }
      if (isEditorHydrating) {
        return;
      }
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
      if (primary && key === "n") {
        consumeShortcutEvent(event);
        setIsPresetDialogOpen(true);
        return;
      }
      if (!primary && key === "f") {
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
        clearSelection();
        setQuickAdd(null);
        setNodeMenu(null);
        setIsShortcutDialogOpen(false);
        setIsPresetDialogOpen(false);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        consumeShortcutEvent(event);
        deleteSelection();
        return;
      }
    },
    [
      clearSelection,
      canvasSearchOpen,
      deleteSelection,
      dismissCanvasSearch,
      duplicateSelected,
      focusSelection,
      focusNodePaletteSearch,
      isApple,
      isEditorHydrating,
      loadLocal,
      openCanvasSearch,
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
    clearSelection();
    setQuickAdd(null);
    setNodeMenu(null);
  }, [clearSelection]);

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

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      const nextViewport = normalizeViewport(viewport);
      setGraph((current) =>
        viewportEquals(current.viewport, nextViewport)
          ? current
          : {
              ...current,
              viewport: nextViewport,
            },
      );
    },
    [],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const dimensionChanges = nodeDimensionChanges(changes);
      if (dimensionChanges.length > 0) {
        setFlowNodeMeasurements((current) => {
          let changed = false;
          const next = new Map(current);
          for (const change of dimensionChanges) {
            const previous = next.get(change.id);
            const nextWidth =
              change.setAttributes === true || change.setAttributes === "width"
                ? change.dimensions.width
                : previous?.width;
            const nextHeight =
              change.setAttributes === true || change.setAttributes === "height"
                ? change.dimensions.height
                : previous?.height;
            const measurement = {
              measured: {
                width: change.dimensions.width,
                height: change.dimensions.height,
              },
              ...(nextWidth !== undefined ? { width: nextWidth } : {}),
              ...(nextHeight !== undefined ? { height: nextHeight } : {}),
            } satisfies FlowNodeMeasurement;
            if (!flowNodeMeasurementEquals(previous, measurement)) {
              next.set(change.id, measurement);
              changed = true;
            }
          }
          return changed ? next : current;
        });
      }

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
          showToast("Moved nodes");
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
    [createSnapshot, graph, pushUndoSnapshot, showToast],
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

  const previewParams = useMemo(
    () => resolveWispySmokeParameterValues(graph) as unknown as WispySmokeVFXParams,
    [graph],
  );
  const previewConfig = useMemo(
    () =>
      compileResult.ir?.runtimeConfig ??
      createWispySmokeRuntimeConfig(previewParams as unknown as ParameterMap),
    [compileResult.ir, previewParams],
  );
  const previewState = useMemo(
    () => ({ params: previewParams, runtimeConfig: previewConfig }),
    [previewConfig, previewParams],
  );

  if (isEditorHydrating) {
    return <EditorLoadingShell />;
  }

  return (
    <main className="app-shell" tabIndex={-1}>
      <TopBar
        onSave={saveLocal}
        onLoad={loadLocal}
        onNewProject={() => setIsPresetDialogOpen(true)}
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
      <section className={`workspace ${isNodePaletteExpanded ? "workspace-palette-expanded" : ""}`}>
        <NodePalette
          expanded={isNodePaletteExpanded}
          paletteRef={nodePaletteRef}
          query={paletteQuery}
          onQueryChange={setPaletteQuery}
          quickAdd={quickAdd}
          searchInputRef={nodePaletteSearchInputRef}
          graph={graph}
          onAddNode={addNode}
          onToggleExpanded={toggleNodePalette}
        />
        <div
          ref={canvasPanelRef}
          className={`canvas-panel ${isMiddlePanning ? "canvas-panel-panning" : ""}`}
          aria-label="Graph canvas"
          tabIndex={0}
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
            nodeTypes={FLOW_NODE_TYPES}
            defaultViewport={viewportForGraph(graph)}
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
            onMoveEnd={handleMoveEnd}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            deleteKeyCode={null}
            proOptions={FLOW_PRO_OPTIONS}
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
          {canvasSearchOpen ? (
            <CanvasSearchPopover
              activeIndex={visibleCanvasSearchIndex}
              inputRef={canvasSearchInputRef}
              popoverRef={canvasSearchPopoverRef}
              query={canvasSearchQuery}
              resultCount={canvasSearchResultCount}
              onClear={clearCanvasSearchQuery}
              onConfirmNext={() => confirmOrJumpCanvasSearchResult(1)}
              onConfirmPrevious={() => confirmOrJumpCanvasSearchResult(-1)}
              onJumpNext={() => jumpCanvasSearchResult(1)}
              onJumpPrevious={() => jumpCanvasSearchResult(-1)}
              onQueryChange={updateCanvasSearchQuery}
            />
          ) : null}
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
          <PreviewViewport
            isApple={isApple}
            params={previewState.params}
            runtimeConfig={previewState.runtimeConfig}
            onTelemetry={setPreviewTelemetry}
          />
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
      <PresetDialog
        currentGraphName={graph.name}
        open={isPresetDialogOpen}
        presets={EDITOR_PRESETS}
        onClose={() => setIsPresetDialogOpen(false)}
        onSelectPreset={startFromPreset}
      />
      <ToastViewport toast={toast} />
    </main>
  );
}

function EditorLoadingShell() {
  return (
    <main className="app-shell" tabIndex={-1}>
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="" aria-hidden="true" />
          <div>
            <h1>ThreeFX Studio</h1>
          </div>
        </div>
      </header>
      <section className="editor-loading" aria-live="polite">
        <span className="editor-loading-indicator" aria-hidden="true" />
        <span>Loading saved graph</span>
      </section>
    </main>
  );
}

function TopBar({
  onSave,
  onLoad,
  onNewProject,
  onDownloadJson,
  onImportClick,
  onAutoLayout,
  onRedo,
  onShowShortcuts,
  onUndo,
  canRedo,
  canUndo,
}: {
  readonly onSave: () => void;
  readonly onLoad: () => void;
  readonly onNewProject: () => void;
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
        </div>
      </div>
      <div className="topbar-actions" aria-label="Editor actions">
        <div className="topbar-action-group" role="group" aria-label="Project">
          <IconButton title="New from preset" onClick={onNewProject} icon={<Plus size={16} />} />
          <IconButton title="Save" onClick={onSave} icon={<Save size={16} />} />
          <IconButton title="Load" onClick={onLoad} icon={<FolderOpen size={16} />} />
        </div>
        <ToolbarDivider />
        <div className="topbar-action-group" role="group" aria-label="Import and export">
          <IconButton title="Import" onClick={onImportClick} icon={<Upload size={16} />} />
          <IconButton
            title="Download graph"
            onClick={onDownloadJson}
            icon={<FileDown size={16} />}
          />
        </div>
        <ToolbarDivider />
        <div className="topbar-action-group" role="group" aria-label="Edit history">
          <IconButton
            title="Undo"
            onClick={onUndo}
            icon={<Undo2 size={16} />}
            disabled={!canUndo}
          />
          <IconButton
            title="Redo"
            onClick={onRedo}
            icon={<Redo2 size={16} />}
            disabled={!canRedo}
          />
        </div>
        <ToolbarDivider />
        <div className="topbar-action-group" role="group" aria-label="Layout and help">
          <IconButton
            title="Auto layout"
            onClick={onAutoLayout}
            icon={<WandSparkles size={16} />}
          />
          <IconButton
            title="Keyboard shortcuts"
            onClick={onShowShortcuts}
            icon={<Keyboard size={16} />}
          />
        </div>
      </div>
    </header>
  );
}

function ToolbarDivider() {
  return <span className="topbar-action-divider" role="separator" aria-orientation="vertical" />;
}

function ToastViewport({ toast }: { readonly toast: ToastMessage | null }) {
  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="true">
      {toast ? (
        <div key={toast.id} className="toast-message" role="status">
          {toast.message}
        </div>
      ) : null}
    </div>
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
  const alternateModifier = alternateShortcutModifierLabel(isApple);
  const keyboardShortcuts = [
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
      action: "Find fields",
      description: "Search canvas nodes and parameters",
      keys: [shortcutLabel(isApple, "Mod", "F")],
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
      action: "Load",
      description: "Restore local graph",
      keys: [shortcutLabel(isApple, "Mod", "L")],
    },
    {
      action: "New project",
      description: "Choose a graph preset",
      keys: [shortcutLabel(isApple, "Mod", "N")],
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
  const previewShortcuts = [
    {
      action: "Preview orbit",
      description: "Rotate around the effect",
      keys: ["Middle Drag", `${alternateModifier} + Left Drag`],
    },
    {
      action: "Preview pan",
      description: "Move the preview target",
      keys: [
        "Shift + Middle Drag",
        isApple ? "Option + Cmd + Left Drag" : "Alt + Ctrl + Left Drag",
      ],
    },
    {
      action: "Preview zoom",
      description: "Move closer or farther within limits",
      keys: ["Scroll Wheel", ...(isApple ? ["Option + Control + Left Drag"] : [])],
    },
    {
      action: "Maximize preview",
      description: "Expand the preview; Esc restores it",
      keys: ["Maximize Button", "Esc"],
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
          {keyboardShortcuts.map((shortcut) => (
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
          <div className="shortcut-divider" role="separator">
            <span>Preview controls</span>
          </div>
          {previewShortcuts.map((shortcut) => (
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

function PresetDialog({
  currentGraphName,
  open,
  presets,
  onClose,
  onSelectPreset,
}: {
  readonly currentGraphName: string;
  readonly open: boolean;
  readonly presets: readonly EditorPreset[];
  readonly onClose: () => void;
  readonly onSelectPreset: (presetId: EditorPresetId) => void;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="preset-backdrop" role="presentation" onPointerDown={onClose}>
      <section
        className="preset-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="preset-dialog-header">
          <div>
            <h2 id="preset-dialog-title">New Project</h2>
            <span>{currentGraphName}</span>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close presets"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="preset-grid">
          {presets.map((preset) => (
            <article key={preset.id} className="preset-card">
              <div>
                <h3>{preset.name}</h3>
                <span>{preset.summary}</span>
                <p>{preset.description}</p>
              </div>
              <button type="button" onClick={() => onSelectPreset(preset.id)}>
                Start
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function CanvasSearchPopover({
  activeIndex,
  inputRef,
  popoverRef,
  query,
  resultCount,
  onClear,
  onConfirmNext,
  onConfirmPrevious,
  onJumpNext,
  onJumpPrevious,
  onQueryChange,
}: {
  readonly activeIndex: number;
  readonly inputRef: React.MutableRefObject<HTMLInputElement | null>;
  readonly popoverRef: React.MutableRefObject<HTMLDivElement | null>;
  readonly query: string;
  readonly resultCount: number;
  readonly onClear: () => void;
  readonly onConfirmNext: () => void;
  readonly onConfirmPrevious: () => void;
  readonly onJumpNext: () => void;
  readonly onJumpPrevious: () => void;
  readonly onQueryChange: (value: string) => void;
}) {
  const displayIndex = resultCount > 0 && activeIndex >= 0 ? activeIndex + 1 : 0;
  const resultLabel = `${displayIndex}/${resultCount}`;
  return (
    <div
      ref={(element) => {
        popoverRef.current = element;
      }}
      className="canvas-search-popover"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="canvas-search-input-wrap">
        <Search size={14} aria-hidden="true" />
        <input
          ref={(element) => {
            inputRef.current = element;
          }}
          value={query}
          aria-label="Search canvas fields"
          placeholder="Find fields"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) {
              onConfirmPrevious();
            } else {
              onConfirmNext();
            }
          }}
        />
        <span className="canvas-search-count" aria-live="polite">
          {resultLabel}
        </span>
        {query ? (
          <button
            type="button"
            className="canvas-search-clear"
            aria-label="Clear canvas search"
            title="Clear search"
            onClick={onClear}
          >
            <X size={13} />
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="canvas-search-nav"
        aria-label="Previous canvas search result"
        title="Previous result"
        disabled={resultCount === 0}
        onClick={onJumpPrevious}
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        className="canvas-search-nav"
        aria-label="Next canvas search result"
        title="Next result"
        disabled={resultCount === 0}
        onClick={onJumpNext}
      >
        <ChevronDown size={14} />
      </button>
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

function TypePill({ type }: { readonly type: PortType | ParameterType }) {
  const tone = getPortTypeTone(type);
  return (
    <span
      className="type-pill"
      data-port-type={type}
      style={
        {
          "--port-color": tone.accent,
          "--port-fill": tone.background,
          "--port-border-color": tone.border,
        } as React.CSSProperties
      }
    >
      {String(type).toUpperCase()}
    </span>
  );
}

function HighlightedText({
  query,
  text,
}: {
  readonly query: string;
  readonly text: string;
}) {
  const ranges = searchHighlightRanges(text, query);
  if (ranges.length === 0) {
    return <>{text}</>;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      parts.push(text.slice(cursor, range.start));
    }
    parts.push(
      <mark key={`${range.start}:${range.end}:${index}`} className="search-text-highlight">
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return <>{parts}</>;
}

function EditableNodeLabel({
  node,
  onNodeLabelChange,
}: {
  readonly node: GraphNode;
  readonly onNodeLabelChange: (nodeId: string, label: string) => void;
}) {
  const [draft, setDraft] = useState(node.label);
  useEffect(() => {
    setDraft(node.label);
  }, [node.id, node.label]);

  const commit = useCallback(() => {
    const next = draft.trim();
    if (next && next !== node.label) {
      onNodeLabelChange(node.id, next);
    } else {
      setDraft(node.label);
    }
  }, [draft, node.id, node.label, onNodeLabelChange]);

  return (
    <input
      className="graph-node-label-input nodrag nopan"
      aria-label="Parameter label"
      value={draft}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(node.label);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function ThreeFXNode({ data, selected }: NodeProps<FlowNode>) {
  const {
    definition,
    connectedPorts,
    graphParameters,
    inputBindings,
    node,
    onFocusNode,
    onNodeLabelChange,
    onNodeParameterChange,
    searchMatch,
    searchQuery,
  } = data;
  const inputs = definition.ports.filter((port) => port.direction === "input");
  const outputs = definition.ports.filter((port) => port.direction === "output");
  const isParameterNode = definition.kind === "parameter";
  const entries = editableInputEntries(node, definition, graphParameters, inputBindings);
  const parameterSummary = entries
    .map((entry) => {
      const linkedSource = entry.binding?.sourceNode?.label;
      return linkedSource
        ? `${entry.metadata.label}: ${linkedSource}`
        : `${entry.metadata.label}: ${formatNodeParameterValue(entry.value)}`;
    })
    .join(" / ");
  const parameterType = getParameterNodeValueType(node.type);

  return (
    <article
      className={[
        "graph-node",
        selected ? "graph-node-selected" : "",
        searchMatch ? "graph-node-search-match" : "",
        searchMatch?.active ? "graph-node-search-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={nodeKindToneStyle(definition.kind)}
    >
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
        {isParameterNode ? (
          <EditableNodeLabel node={node} onNodeLabelChange={onNodeLabelChange} />
        ) : (
          <span>
            <HighlightedText text={node.label} query={searchQuery} />
          </span>
        )}
        <div className="graph-node-header-meta">
          {parameterType ? <TypePill type={parameterType} /> : null}
          {!isParameterNode ? (
            <small className="graph-node-category">{definition.category}</small>
          ) : null}
        </div>
      </div>
      <div className="port-grid">
        <div className="port-column">
          {inputs.map((port) => (
            <PortLabel key={port.id} port={port} query={searchQuery} side="left" />
          ))}
        </div>
        <div className="port-column port-column-right">
          {outputs.map((port) => (
            <PortLabel key={port.id} port={port} query={searchQuery} side="right" />
          ))}
        </div>
      </div>
      {isParameterNode && parameterType ? (
        <ParameterNodeValuePanel
          node={node}
          searchQuery={searchQuery}
          searchMatch={searchMatch}
          type={parameterType}
          onNodeParameterChange={onNodeParameterChange}
        />
      ) : (
        <NodeParameterPanel
          entries={entries}
          node={node}
          onFocusNode={onFocusNode}
          onNodeParameterChange={onNodeParameterChange}
          searchQuery={searchQuery}
          searchMatch={searchMatch}
        />
      )}
      {!isParameterNode && parameterSummary && !searchMatch ? (
        <div className="node-value" title={parameterSummary}>
          {parameterSummary}
        </div>
      ) : null}
    </article>
  );
}

function defaultParameterGroupExpansion(
  groups: readonly NodeParameterGroup[],
): Record<string, boolean> {
  return Object.fromEntries(groups.map((group) => [group.group, false]));
}

function parameterGroupSignature(
  groups: readonly NodeParameterGroup[],
): string {
  return groups
    .map((group) => `${group.group}:${group.entries.map((entry) => entry.metadata.id).join(",")}`)
    .join("|");
}

function parameterGroupsVisibleForSearch(
  groups: readonly NodeParameterGroup[],
  searchMatch: NodeSearchMatchView | null,
): NodeParameterGroup[] {
  if (!searchMatch) {
    return [...groups];
  }
  return groups.flatMap((group) => {
    const groupMatches = searchMatch.directGroupIds.has(group.group);
    const entries = groupMatches
      ? group.entries
      : group.entries.filter((entry) => searchMatch.fieldIds.has(entry.metadata.id));
    return entries.length > 0 ? [{ group: group.group, entries }] : [];
  });
}

function ParameterNodeValuePanel({
  node,
  searchQuery,
  searchMatch,
  type,
  onNodeParameterChange,
}: {
  readonly node: GraphNode;
  readonly searchQuery: string;
  readonly searchMatch: NodeSearchMatchView | null;
  readonly type: ParameterType;
  readonly onNodeParameterChange: (
    nodeId: string,
    id: string,
    value: ParameterValue,
    options?: ParameterChangeOptions,
  ) => void;
}) {
  const options = getParameterNodeOptions(type);
  const metadata: ParameterMetadata = {
    id: "value",
    label: "Value",
    type,
    defaultValue: getDefaultParameterNodeValue(type),
    group: "Parameters",
    ...(options ? { options } : {}),
  };
  return (
    <div
      className="node-parameter-panel nodrag nopan"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="node-parameter-field-list">
        <div
          className={`node-parameter-field-row ${
            searchMatch ? "node-parameter-field-row-search-match" : ""
          }`}
        >
          <div className="node-parameter-field-title">
            <span>
              <HighlightedText text={metadata.label} query={searchQuery} />
            </span>
          </div>
          <ParameterField
            hideLabel
            metadata={metadata}
            value={node.parameters?.value ?? metadata.defaultValue}
            onChange={(value, options) => onNodeParameterChange(node.id, "value", value, options)}
          />
        </div>
      </div>
    </div>
  );
}

function NodeParameterPanel({
  entries,
  node,
  onFocusNode,
  onNodeParameterChange,
  searchQuery,
  searchMatch,
}: {
  readonly entries: readonly NodeParameterEntry[];
  readonly node: GraphNode;
  readonly onFocusNode: (nodeId: string) => void;
  readonly onNodeParameterChange: (
    nodeId: string,
    id: string,
    value: ParameterValue,
    options?: ParameterChangeOptions,
  ) => void;
  readonly searchQuery: string;
  readonly searchMatch: NodeSearchMatchView | null;
}) {
  const parameterGroups = useMemo(() => groupParameterEntries(entries), [entries]);
  const visibleParameterGroups = useMemo(
    () => parameterGroupsVisibleForSearch(parameterGroups, searchMatch),
    [parameterGroups, searchMatch],
  );
  const signature = useMemo(() => parameterGroupSignature(parameterGroups), [parameterGroups]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() =>
    defaultParameterGroupExpansion(parameterGroups),
  );

  useEffect(() => {
    setExpandedGroups(defaultParameterGroupExpansion(parameterGroups));
  }, [node.id, signature]);

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups((current) => ({
      ...current,
      [group]: !(current[group] ?? false),
    }));
  }, []);
  const setAllGroupsExpanded = useCallback(
    (expanded: boolean) => {
      setExpandedGroups(
        Object.fromEntries(parameterGroups.map((group) => [group.group, expanded])),
      );
    },
    [parameterGroups],
  );

  if (visibleParameterGroups.length === 0) {
    return null;
  }

  const searchMode = Boolean(searchMatch);
  const parameterCount = visibleParameterGroups.reduce(
    (count, group) => count + group.entries.length,
    0,
  );
  const expandedCount = parameterGroups.filter((group) => expandedGroups[group.group]).length;
  const allGroupsExpanded = expandedCount === parameterGroups.length;

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
          <ExpandCollapseAllButton
            allExpanded={searchMode || allGroupsExpanded}
            disabled={searchMode}
            targetLabel={`${node.label} parameter groups`}
            onCollapseAll={() => setAllGroupsExpanded(false)}
            onExpandAll={() => setAllGroupsExpanded(true)}
          />
        </div>
      </div>
      <div className="node-parameter-groups">
        {visibleParameterGroups.map((group) => {
          const expanded = searchMode || (expandedGroups[group.group] ?? false);
          const groupMatches = searchMatch?.directGroupIds.has(group.group) ?? false;
          return (
            <section
              key={group.group}
              className={`node-parameter-group ${
                groupMatches ? "node-parameter-group-search-match" : ""
              }`}
            >
              <button
                type="button"
                className="node-parameter-group-trigger"
                aria-expanded={expanded}
                aria-disabled={searchMode ? "true" : undefined}
                onClick={() => {
                  if (!searchMode) {
                    toggleGroup(group.group);
                  }
                }}
              >
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span>
                  <HighlightedText text={group.group} query={searchQuery} />
                </span>
                <small>{group.entries.length}</small>
              </button>
              {expanded ? (
                <div className="node-parameter-group-body">
                  {group.entries.map((entry) => (
                    <NodeParameterField
                      key={entry.metadata.id}
                      entry={entry}
                      node={node}
                      onFocusNode={onFocusNode}
                      onNodeParameterChange={onNodeParameterChange}
                      searchQuery={searchQuery}
                      searchMatched={searchMatch?.fieldIds.has(entry.metadata.id) ?? false}
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

function NodeParameterField({
  entry,
  node,
  onFocusNode,
  onNodeParameterChange,
  searchQuery,
  searchMatched,
}: {
  readonly entry: NodeParameterEntry;
  readonly node: GraphNode;
  readonly onFocusNode: (nodeId: string) => void;
  readonly onNodeParameterChange: (
    nodeId: string,
    id: string,
    value: ParameterValue,
    options?: ParameterChangeOptions,
  ) => void;
  readonly searchQuery: string;
  readonly searchMatched: boolean;
}) {
  const binding = entry.binding;
  const sourceNode = binding?.sourceNode ?? null;
  return (
    <div
      className={`node-parameter-field-row ${
        searchMatched ? "node-parameter-field-row-search-match" : ""
      }`}
      data-linked-state={binding?.linked ? "linked" : "local"}
    >
      <div className="node-parameter-field-title">
        <span>
          <HighlightedText text={entry.metadata.label} query={searchQuery} />
        </span>
        <TypePill type={entry.metadata.type} />
      </div>
      {binding?.linked ? (
        <div className="linked-source-line">
          <Link2 size={13} />
          <span>Source</span>
          {sourceNode ? (
            <button type="button" onClick={() => onFocusNode(sourceNode.id)}>
              <HighlightedText text={binding.sourceLabel} query={searchQuery} />
            </button>
          ) : (
            <strong>
              <HighlightedText text={binding.sourceLabel} query={searchQuery} />
            </strong>
          )}
        </div>
      ) : (
        <ParameterField
          hideLabel
          metadata={entry.metadata}
          value={entry.value}
          onChange={(value, options) =>
            onNodeParameterChange(node.id, entry.port.id, value, options)
          }
        />
      )}
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
      style={{ ...portToneStyle(port.type), top: 58 + index * 28 }}
      title={describePort(port)}
    />
  );
}

function PortLabel({
  port,
  query,
  side,
}: {
  readonly port: PortDefinition;
  readonly query: string;
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
      <span>
        <HighlightedText text={port.label} query={query} />
      </span>
    </div>
  );
}

function ExpandCollapseAllButton({
  allExpanded,
  disabled = false,
  iconSize = 13,
  targetLabel,
  onCollapseAll,
  onExpandAll,
}: {
  readonly allExpanded: boolean;
  readonly disabled?: boolean;
  readonly iconSize?: number;
  readonly targetLabel: string;
  readonly onCollapseAll: () => void;
  readonly onExpandAll: () => void;
}) {
  const action = allExpanded ? "Collapse" : "Expand";
  return (
    <button
      type="button"
      className="expand-collapse-all-button"
      title={`${action} all ${targetLabel}`}
      aria-label={`${action} all ${targetLabel}`}
      disabled={disabled}
      onClick={allExpanded ? onCollapseAll : onExpandAll}
    >
      {allExpanded ? <ChevronsDownUp size={iconSize} /> : <ChevronsUpDown size={iconSize} />}
    </button>
  );
}

function NodePalette({
  expanded,
  paletteRef,
  query,
  onQueryChange,
  quickAdd,
  searchInputRef,
  graph,
  onAddNode,
  onToggleExpanded,
}: {
  readonly expanded: boolean;
  readonly paletteRef: React.MutableRefObject<HTMLElement | null>;
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly quickAdd: QuickAddState | null;
  readonly searchInputRef: React.MutableRefObject<HTMLInputElement | null>;
  readonly graph: GraphDocument;
  readonly onAddNode: (
    type: string,
    position: { x: number; y: number },
    mode?: QuickAddMode,
  ) => void;
  readonly onToggleExpanded: () => void;
}) {
  const mode = quickAdd?.mode ?? { kind: "free" };
  return (
    <aside
      className={`node-palette ${expanded ? "node-palette-expanded" : "node-palette-collapsed"}`}
      ref={(element) => {
        paletteRef.current = element;
      }}
    >
      <div className="node-palette-header">
        {expanded ? <h2>Nodes</h2> : null}
        <IconButton
          title={expanded ? "Collapse node palette" : "Expand node palette"}
          onClick={onToggleExpanded}
          icon={expanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        />
      </div>
      {expanded ? (
        <NodeDefinitionPicker
          graph={graph}
          mode={mode}
          query={query}
          searchLabel="Search nodes"
          searchPlaceholder="Search"
          searchInputRef={searchInputRef}
          onAddNode={(type) => onAddNode(type, quickAdd?.flow ?? { x: -80, y: 40 }, quickAdd?.mode)}
          onQueryChange={onQueryChange}
          draggable
        />
      ) : null}
    </aside>
  );
}

function useFilteredDefinitionGroups(
  query: string,
  graph: GraphDocument,
  mode: QuickAddMode,
): readonly NodeDefinitionGroup[] {
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
    const definitions = defaultNodeRegistry
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
    return groupNodeDefinitions(definitions);
  }, [graph.nodes, mode, query]);
}

function SearchInput({
  autoFocus = false,
  inputRef,
  label,
  placeholder,
  value,
  onChange,
}: {
  readonly autoFocus?: boolean;
  readonly inputRef?: React.MutableRefObject<HTMLInputElement | null> | undefined;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="node-search">
      <input
        autoFocus={autoFocus}
        ref={(element) => {
          if (inputRef) {
            inputRef.current = element;
          }
        }}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      {value ? (
        <button
          type="button"
          className="node-search-clear"
          title="Clear search"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
}

function NodeDefinitionPicker({
  autoFocus = false,
  draggable = false,
  graph,
  mode,
  query,
  searchInputRef,
  searchLabel,
  searchPlaceholder,
  onAddNode,
  onQueryChange,
}: {
  readonly autoFocus?: boolean;
  readonly draggable?: boolean;
  readonly graph: GraphDocument;
  readonly mode: QuickAddMode;
  readonly query: string;
  readonly searchInputRef?: React.MutableRefObject<HTMLInputElement | null> | undefined;
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  readonly onAddNode: (type: string) => void;
  readonly onQueryChange: (value: string) => void;
}) {
  const groups = useFilteredDefinitionGroups(query, graph, mode);
  const isSearching = query.trim().length > 0;
  const [openCategories, setOpenCategories] = useState<ReadonlySet<string>>(() => new Set());
  const toggleCategory = useCallback((category: string) => {
    setOpenCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);
  const setAllCategoriesExpanded = useCallback(
    (expanded: boolean) => {
      setOpenCategories((current) => {
        const next = new Set(current);
        for (const group of groups) {
          if (expanded) {
            next.add(group.category);
          } else {
            next.delete(group.category);
          }
        }
        return next;
      });
    },
    [groups],
  );
  const expandedCategoryCount = groups.filter((group) => openCategories.has(group.category)).length;
  const allCategoriesExpanded = groups.length > 0 && expandedCategoryCount === groups.length;

  return (
    <>
      <div className="node-picker-toolbar">
        <SearchInput
          autoFocus={autoFocus}
          inputRef={searchInputRef}
          label={searchLabel}
          placeholder={searchPlaceholder}
          value={query}
          onChange={onQueryChange}
        />
        <ExpandCollapseAllButton
          allExpanded={allCategoriesExpanded}
          disabled={isSearching || groups.length === 0}
          iconSize={14}
          targetLabel="node categories"
          onCollapseAll={() => setAllCategoriesExpanded(false)}
          onExpandAll={() => setAllCategoriesExpanded(true)}
        />
      </div>
      <div className="node-picker-list">
        {groups.length > 0 ? (
          groups.map((group) => {
            const expanded = isSearching || openCategories.has(group.category);
            return (
              <section
                key={group.category}
                className="node-picker-category"
                style={nodeCategoryToneStyle(group)}
              >
                <button
                  type="button"
                  className="node-picker-category-trigger"
                  aria-expanded={expanded}
                  aria-disabled={isSearching ? "true" : undefined}
                  onClick={() => {
                    if (!isSearching) {
                      toggleCategory(group.category);
                    }
                  }}
                >
                  <span className="node-picker-category-accent" aria-hidden="true" />
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span>{group.category}</span>
                  <small>{group.definitions.length}</small>
                </button>
                {expanded ? (
                  <div className="node-picker-category-body">
                    {group.definitions.map((entry) => (
                      <button
                        key={entry.type}
                        type="button"
                        className="node-picker-item"
                        draggable={draggable}
                        style={nodeDefinitionPickerItemToneStyle(entry)}
                        onDragStart={(event) => {
                          if (!draggable) {
                            return;
                          }
                          event.dataTransfer.setData("application/threefx-node", entry.type);
                          event.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => onAddNode(entry.type)}
                      >
                        <span className="node-picker-item-label">
                          <span className="node-picker-item-dot" aria-hidden="true" />
                          <span>{entry.label}</span>
                        </span>
                        <small>{getQuickAddEntrySubtitle(entry, graph, mode)}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })
        ) : (
          <div className="node-picker-empty">No nodes found</div>
        )}
      </div>
    </>
  );
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
      <NodeDefinitionPicker
        autoFocus
        graph={graph}
        mode={state.mode}
        query={query}
        searchLabel="Add node"
        searchPlaceholder="Add node"
        onAddNode={(type) => onAddNode(type, state.flow, state.mode)}
        onQueryChange={onQueryChange}
      />
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
  const gridValue =
    telemetry.gridCells > 0
      ? `${telemetry.gridResolution.join("x")} (${telemetry.gridCells.toLocaleString()})`
      : "--";
  const backendValue = telemetry.fallbackActive
    ? `${telemetry.backend} fallback`
    : telemetry.backend;
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
        <Metric label="Grid" value={gridValue} />
        <Metric label="Backend" value={backendValue} />
        <Metric
          label="Steps"
          value={telemetry.renderSteps > 0 ? String(telemetry.renderSteps) : "--"}
        />
        <Metric
          label="Solver"
          value={telemetry.solverPasses > 0 ? `${telemetry.solverPasses} passes` : "--"}
        />
        <Metric label="Sources" value={String(telemetry.emitterCount)} />
        <Metric label="Forces" value={`${telemetry.forceCount}/${telemetry.obstacleCount}`} />
        <Metric label="Mode" value={telemetry.advectionMode} />
        <Metric label="Debug" value={telemetry.activeDebugView} />
        <Metric
          label="Sim"
          value={telemetry.simulationMs > 0 ? `${telemetry.simulationMs.toFixed(1)} ms` : "--"}
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

const COMPLETE_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function numberDraftFromValue(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

function parseNumberDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (!COMPLETE_NUMBER_PATTERN.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function clampNumericValue(value: number, min?: number, max?: number): number {
  let next = value;
  if (min !== undefined) {
    next = Math.max(min, next);
  }
  if (max !== undefined) {
    next = Math.min(max, next);
  }
  return next;
}

function precisionForStep(step: number | undefined): number {
  if (!step || !Number.isFinite(step)) {
    return 4;
  }
  const text = String(step).toLowerCase();
  if (text.includes("e-")) {
    return Number(text.split("e-")[1] ?? 4);
  }
  const decimal = text.split(".")[1];
  return decimal ? decimal.length : 0;
}

function normalizeNumericValue(
  value: number,
  options: {
    readonly integer: boolean;
    readonly max?: number | undefined;
    readonly min?: number | undefined;
    readonly step?: number | undefined;
  },
): number {
  const clamped = clampNumericValue(value, options.min, options.max);
  if (options.integer) {
    return Math.round(clamped);
  }
  const step = options.step;
  if (!step || !Number.isFinite(step) || step <= 0) {
    return Number(clamped.toFixed(6));
  }
  const precision = Math.min(8, precisionForStep(step));
  const snapped = Math.round(clamped / step) * step;
  return Number(snapped.toFixed(precision));
}

function normalizeColorString(value: ParameterValue): string {
  const candidate = typeof value === "string" ? value : "";
  return HEX_COLOR_PATTERN.test(candidate) ? candidate.toLowerCase() : "#000000";
}

type NumberDragState = {
  readonly pointerId: number;
  readonly startValue: number;
  readonly startX: number;
  captured: boolean;
  lastValue: number;
  moved: boolean;
};

function NumberDraftInput({
  ariaLabel,
  integer = false,
  max,
  min,
  onValueChange,
  step,
  value,
}: {
  readonly ariaLabel?: string | undefined;
  readonly integer?: boolean;
  readonly max?: number | undefined;
  readonly min?: number | undefined;
  readonly onValueChange: (value: number, options?: ParameterChangeOptions) => void;
  readonly step?: number | undefined;
  readonly value: number;
}) {
  const externalDraft = numberDraftFromValue(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<NumberDragState | null>(null);
  const suppressClickRef = useRef(false);
  const [draft, setDraft] = useState(externalDraft);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraft(externalDraft);
    }
  }, [editing, externalDraft]);

  const normalizeValue = useCallback(
    (nextValue: number) =>
      normalizeNumericValue(nextValue, {
        integer,
        max,
        min,
        step,
      }),
    [integer, max, min, step],
  );

  const commitDraft = useCallback(
    (nextDraft: string) => {
      const parsed = parseNumberDraft(nextDraft);
      if (parsed === null) {
        return;
      }
      onValueChange(normalizeValue(parsed));
    },
    [normalizeValue, onValueChange],
  );

  const applyDragValue = useCallback(
    (nextValue: number, options: ParameterChangeOptions) => {
      const normalized = normalizeValue(nextValue);
      const drag = dragRef.current;
      if (drag && Object.is(drag.lastValue, normalized) && !options.commitTransient) {
        return;
      }
      if (drag) {
        drag.lastValue = normalized;
      }
      setDraft(numberDraftFromValue(normalized));
      onValueChange(normalized, options);
    },
    [normalizeValue, onValueChange],
  );

  return (
    <input
      ref={inputRef}
      aria-label={ariaLabel}
      className={`number-draft-input ${dragging ? "number-draft-input-dragging" : ""}`}
      inputMode={integer ? "numeric" : "decimal"}
      type="text"
      value={draft}
      onBlur={() => {
        if (dragRef.current) {
          return;
        }
        setEditing(false);
        const parsed = parseNumberDraft(draft);
        setDraft(parsed === null ? externalDraft : numberDraftFromValue(normalizeValue(parsed)));
      }}
      onChange={(event) => {
        const nextDraft = event.target.value;
        setEditing(true);
        setDraft(nextDraft);
        commitDraft(nextDraft);
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (!suppressClickRef.current) {
          return;
        }
        event.preventDefault();
        suppressClickRef.current = false;
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        if (document.activeElement === event.currentTarget) {
          return;
        }
        const startValue = parseNumberDraft(draft) ?? value;
        dragRef.current = {
          pointerId: event.pointerId,
          startValue: normalizeValue(startValue),
          startX: event.clientX,
          captured: false,
          lastValue: normalizeValue(startValue),
          moved: false,
        };
        const handleWindowPointerEnd = (windowEvent: PointerEvent) => {
          if (windowEvent.pointerId !== event.pointerId) {
            return;
          }
          const drag = dragRef.current;
          if (drag && drag.pointerId === windowEvent.pointerId && !drag.captured) {
            dragRef.current = null;
            setDragging(false);
          }
          window.removeEventListener("pointerup", handleWindowPointerEnd);
          window.removeEventListener("pointercancel", handleWindowPointerEnd);
        };
        window.addEventListener("pointerup", handleWindowPointerEnd);
        window.addEventListener("pointercancel", handleWindowPointerEnd);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
          return;
        }
        const deltaX = event.clientX - drag.startX;
        if (!drag.moved && Math.abs(deltaX) < 3) {
          return;
        }
        const selectionStart = event.currentTarget.selectionStart;
        const selectionEnd = event.currentTarget.selectionEnd;
        if (
          !drag.captured &&
          selectionStart !== null &&
          selectionEnd !== null &&
          selectionStart !== selectionEnd
        ) {
          dragRef.current = null;
          setDragging(false);
          return;
        }
        if (!drag.captured) {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.captured = true;
        }
        drag.moved = true;
        setDragging(true);
        event.preventDefault();
        const dragStep = step ?? (integer ? 1 : 0.01);
        const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
        applyDragValue(drag.startValue + deltaX * dragStep * multiplier, { transient: true });
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
          return;
        }
        dragRef.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (drag.moved) {
          event.preventDefault();
          suppressClickRef.current = true;
          applyDragValue(drag.lastValue, { commitTransient: true });
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
        }
      }}
      onPointerCancel={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
          return;
        }
        dragRef.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (drag.moved) {
          applyDragValue(drag.lastValue, { commitTransient: true });
        }
      }}
    />
  );
}

function CustomSelect({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  readonly ariaLabel: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly string[];
  readonly value: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = Math.max(0, options.indexOf(value));
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex);

  useEffect(() => {
    if (!open) {
      return;
    }
    setHighlightedIndex(selectedIndex);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof window.Node && rootRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, selectedIndex]);

  const commitOption = useCallback(
    (index: number) => {
      const nextValue = options[index];
      if (nextValue === undefined) {
        return;
      }
      onChange(nextValue);
      setOpen(false);
    },
    [onChange, options],
  );

  const moveHighlight = useCallback(
    (direction: 1 | -1) => {
      setHighlightedIndex((current) => {
        if (options.length === 0) {
          return 0;
        }
        return (current + direction + options.length) % options.length;
      });
    },
    [options.length],
  );

  return (
    <div ref={rootRef} className="custom-select">
      <button
        type="button"
        className="custom-select-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
            } else {
              moveHighlight(1);
            }
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
            } else {
              moveHighlight(-1);
            }
            return;
          }
          if (event.key === "Home") {
            event.preventDefault();
            setOpen(true);
            setHighlightedIndex(0);
            return;
          }
          if (event.key === "End") {
            event.preventDefault();
            setOpen(true);
            setHighlightedIndex(Math.max(0, options.length - 1));
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) {
              commitOption(highlightedIndex);
            } else {
              setOpen(true);
            }
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <span>{value}</span>
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div className="custom-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => (
            <button
              key={option}
              type="button"
              className="custom-select-option"
              role="option"
              aria-selected={option === value}
              data-highlighted={index === highlightedIndex ? "true" : "false"}
              onPointerEnter={() => setHighlightedIndex(index)}
              onClick={() => commitOption(index)}
            >
              <span>{option}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ColorParameterField({
  label,
  metadata,
  onChange,
  value,
}: {
  readonly label: React.ReactNode;
  readonly metadata: ParameterMetadata;
  readonly onChange: (value: ParameterValue) => void;
  readonly value: ParameterValue;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const color = normalizeColorString(value);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof window.Node && rootRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const handleColorChange = useCallback(
    (nextColor: string) => {
      if (HEX_COLOR_PATTERN.test(nextColor)) {
        onChange(nextColor.toLowerCase());
      }
    },
    [onChange],
  );

  return (
    <div ref={rootRef} className="param-field color-field">
      {label}
      <div className="color-field-control">
        <button
          type="button"
          className="color-swatch-button"
          aria-label={`Open ${metadata.label} color picker`}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="color-swatch-fill" style={{ background: color }} />
        </button>
        <HexColorInput
          className="color-hex-input"
          color={color}
          onChange={handleColorChange}
          prefixed
          aria-label={`${metadata.label} hex color`}
        />
      </div>
      {open ? (
        <div className="color-picker-popover" onPointerDown={(event) => event.stopPropagation()}>
          <HexColorPicker color={color} onChange={handleColorChange} />
        </div>
      ) : null}
    </div>
  );
}

function ParameterField({
  hideLabel = false,
  metadata,
  value,
  onChange,
}: {
  readonly hideLabel?: boolean;
  readonly metadata: ParameterMetadata;
  readonly value: ParameterValue;
  readonly onChange: (value: ParameterValue, options?: ParameterChangeOptions) => void;
}) {
  const label = hideLabel ? null : <ParameterFieldLabel metadata={metadata} />;
  if (metadata.type === "bool") {
    return (
      <label className="param-field param-field-row">
        {label}
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
      <ColorParameterField label={label} metadata={metadata} value={value} onChange={onChange} />
    );
  }

  if (metadata.options && (metadata.type === "quality" || metadata.type === "string")) {
    return (
      <div className="param-field">
        {label}
        <CustomSelect
          ariaLabel={metadata.label}
          value={String(value)}
          options={metadata.options}
          onChange={(nextValue) => onChange(nextValue)}
        />
      </div>
    );
  }

  if (metadata.type === "string") {
    return (
      <label className="param-field">
        {label}
        <input
          type="text"
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }

  if (metadata.type === "curve") {
    const keyframes = Array.isArray(value)
      ? value.filter(
          (entry): entry is { readonly time: number; readonly value: number } =>
            Boolean(entry) && typeof entry === "object" && "time" in entry && "value" in entry,
        )
      : [];
    return (
      <label className="param-field">
        {label}
        <div className="curve-field">
          {keyframes.map((keyframe, index) => (
            <span key={index}>
              <NumberDraftInput
                ariaLabel={`${metadata.label} key ${index + 1} time`}
                min={0}
                max={1}
                step={0.01}
                value={keyframe.time}
                onValueChange={(nextValue, options) => {
                  const next = [...keyframes];
                  const current = next[index] ?? { time: 0, value: 0 };
                  next[index] = { ...current, time: nextValue };
                  onChange(next, options);
                }}
              />
              <NumberDraftInput
                ariaLabel={`${metadata.label} key ${index + 1} value`}
                min={0}
                max={1}
                step={0.01}
                value={keyframe.value}
                onValueChange={(nextValue, options) => {
                  const next = [...keyframes];
                  const current = next[index] ?? { time: 0, value: 0 };
                  next[index] = { ...current, value: nextValue };
                  onChange(next, options);
                }}
              />
            </span>
          ))}
        </div>
      </label>
    );
  }

  if (metadata.type === "vec3") {
    const tuple = Array.isArray(value) ? value : [0, 0, 0];
    return (
      <label className="param-field">
        {label}
        <div className="vec-field">
          {[0, 1, 2].map((index) => (
            <NumberDraftInput
              key={index}
              ariaLabel={`${metadata.label} component ${index + 1}`}
              step={metadata.step ?? 0.1}
              value={Number(tuple[index] ?? 0)}
              onValueChange={(nextValue, options) => {
                const next = [...tuple] as [number, number, number];
                next[index] = nextValue;
                onChange(next, options);
              }}
            />
          ))}
        </div>
      </label>
    );
  }

  if (metadata.type === "vec2") {
    const tuple = Array.isArray(value) ? value : [0, 0];
    return (
      <label className="param-field">
        {label}
        <div className="vec-field vec-field-2">
          {[0, 1].map((index) => (
            <NumberDraftInput
              key={index}
              ariaLabel={`${metadata.label} component ${index + 1}`}
              step={metadata.step ?? 0.1}
              value={Number(tuple[index] ?? 0)}
              onValueChange={(nextValue, options) => {
                const next = [...tuple] as [number, number];
                next[index] = nextValue;
                onChange(next, options);
              }}
            />
          ))}
        </div>
      </label>
    );
  }

  return (
    <label className="param-field">
      {label}
      <NumberDraftInput
        ariaLabel={metadata.label}
        min={metadata.min}
        max={metadata.max}
        step={metadata.step ?? 0.01}
        value={Number(value)}
        integer={metadata.type === "int"}
        onValueChange={(next, options) => onChange(next, options)}
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

type PreviewRenderer = {
  readonly isWebGPURenderer?: true;
  dispose(): void;
  init?(): Promise<unknown>;
  outputColorSpace?: string;
  render(scene: unknown, camera: unknown): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  toneMapping?: THREE.ToneMapping;
  toneMappingExposure?: number;
};

type WebGPUAdapterLike = {
  readonly limits?: {
    readonly maxStorageBuffersPerShaderStage?: number;
  };
};

type WebGPUAccessLike = {
  requestAdapter(options?: unknown): Promise<WebGPUAdapterLike | null>;
};

type NavigatorWithOptionalWebGPU = Navigator & {
  readonly gpu?: WebGPUAccessLike;
};

const PREVIEW_WEBGPU_INIT_TIMEOUT_MS = 6000;
const PREVIEW_WEBGPU_REQUIRED_STORAGE_BUFFERS_PER_STAGE = 9;
const PREVIEW_WEBGPU_LIMIT_REQUEST_CAP = 16;
const CANVAS_FALLBACK_SMOKE_LAYERS = 28;

function configurePreviewRendererColor(renderer: PreviewRenderer): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1;
}

function resolvePreviewPixelRatio(
  renderer: PreviewRenderer,
  width: number,
  height: number,
): number {
  const pixelRatioCap = renderer.isWebGPURenderer
    ? PREVIEW_WEBGPU_PIXEL_RATIO_CAP
    : PREVIEW_WEBGL_PIXEL_RATIO_CAP;
  const internalPixelBudget = renderer.isWebGPURenderer
    ? PREVIEW_WEBGPU_INTERNAL_PIXEL_BUDGET
    : PREVIEW_WEBGL_INTERNAL_PIXEL_BUDGET;
  const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const cappedDeviceRatio = Math.min(devicePixelRatio, pixelRatioCap);
  const budgetRatio = Math.sqrt(internalPixelBudget / Math.max(1, width * height));

  return Math.max(0.55, Math.min(cappedDeviceRatio, budgetRatio));
}

async function resolvePreviewWebGPURequiredLimits(): Promise<Record<string, number> | null> {
  const gpu = (navigator as NavigatorWithOptionalWebGPU).gpu;
  if (!gpu) {
    return null;
  }

  try {
    const adapter = await gpu.requestAdapter({
      featureLevel: "compatibility",
      powerPreference: "high-performance",
    });
    const storageBufferLimit = adapter?.limits?.maxStorageBuffersPerShaderStage ?? 0;
    if (storageBufferLimit < PREVIEW_WEBGPU_REQUIRED_STORAGE_BUFFERS_PER_STAGE) {
      return null;
    }

    return {
      maxStorageBuffersPerShaderStage: Math.min(
        storageBufferLimit,
        PREVIEW_WEBGPU_LIMIT_REQUEST_CAP,
      ),
    };
  } catch {
    return null;
  }
}

async function waitForPreviewWebGPUInit(renderer: PreviewRenderer): Promise<boolean> {
  const init = renderer.init?.();
  if (!init) {
    return true;
  }

  return await Promise.race([
    init.then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((resolve) => {
      window.setTimeout(() => resolve(false), PREVIEW_WEBGPU_INIT_TIMEOUT_MS);
    }),
  ]);
}

async function createPreviewWebGPURenderer(
  canvas: HTMLCanvasElement,
): Promise<PreviewRenderer | null> {
  let renderer: PreviewRenderer | null = null;
  try {
    const initialized = await Promise.race([
      (async () => {
        const webgpu = await import("three/webgpu");
        const requiredLimits = await resolvePreviewWebGPURequiredLimits();
        if (!requiredLimits) {
          return false;
        }
        renderer = new webgpu.WebGPURenderer({
          canvas,
          antialias: true,
          powerPreference: "high-performance",
          requiredLimits,
        }) as unknown as PreviewRenderer;
        return await waitForPreviewWebGPUInit(renderer);
      })(),
      new Promise<boolean>((resolve) => {
        window.setTimeout(() => resolve(false), PREVIEW_WEBGPU_INIT_TIMEOUT_MS);
      }),
    ]);
    if (initialized && renderer) {
      return renderer;
    }
  } catch {
    // WebGPU exposure can be blocked by adapter/device selection. The editor still needs a preview.
  }

  const staleRenderer = renderer as PreviewRenderer | null;
  staleRenderer?.dispose();
  return null;
}

function createCanvasFallbackRenderer(canvas: HTMLCanvasElement): PreviewRenderer {
  let clearColor = "#06080d";
  let clearAlpha = 1;
  let fallbackCanvas: HTMLCanvasElement | null = null;
  const getDrawingContext = (): CanvasRenderingContext2D | null => {
    let directContext: CanvasRenderingContext2D | null = null;
    try {
      directContext = canvas.getContext("2d");
    } catch {
      directContext = null;
    }
    if (directContext) {
      return directContext;
    }
    if (!fallbackCanvas) {
      fallbackCanvas = canvas.ownerDocument.createElement("canvas");
      fallbackCanvas.setAttribute("aria-hidden", "true");
      fallbackCanvas.style.position = "absolute";
      fallbackCanvas.style.inset = "0";
      fallbackCanvas.style.width = "100%";
      fallbackCanvas.style.height = "100%";
      fallbackCanvas.style.pointerEvents = "none";
      fallbackCanvas.style.display = "block";
      canvas.style.opacity = "0";
      canvas.parentElement?.appendChild(fallbackCanvas);
    }
    fallbackCanvas.width = canvas.width;
    fallbackCanvas.height = canvas.height;
    return fallbackCanvas.getContext("2d");
  };

  return {
    dispose() {
      fallbackCanvas?.remove();
      fallbackCanvas = null;
      canvas.style.opacity = "";
      // Canvas fallback has no GPU-owned resources.
    },
    render() {
      const context = getDrawingContext();
      if (!context) {
        return;
      }
      drawCanvasFallbackSmoke(context, canvas.width, canvas.height, clearColor, clearAlpha);
    },
    setClearColor(color: THREE.ColorRepresentation, alpha = 1) {
      clearColor = new THREE.Color(color).getStyle();
      clearAlpha = alpha;
    },
    setPixelRatio() {
      // The fallback writes directly to the canvas backing size set below.
    },
    setSize(width: number, height: number) {
      canvas.width = Math.max(1, Math.floor(width));
      canvas.height = Math.max(1, Math.floor(height));
      if (fallbackCanvas) {
        fallbackCanvas.width = canvas.width;
        fallbackCanvas.height = canvas.height;
      }
    },
  };
}

function drawCanvasFallbackSmoke(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  clearColor: string,
  clearAlpha: number,
): void {
  const time = performance.now() * 0.001;
  const centerX = width * 0.5;
  const baseY = height * 0.82;
  const plumeHeight = height * 0.68;
  context.save();
  context.globalAlpha = clearAlpha;
  context.fillStyle = clearColor;
  context.fillRect(0, 0, width, height);
  context.globalAlpha = 1;

  const backdrop = context.createRadialGradient(
    centerX,
    height * 0.48,
    width * 0.04,
    centerX,
    height * 0.46,
    Math.max(width, height) * 0.72,
  );
  backdrop.addColorStop(0, "rgba(47, 58, 64, 0.3)");
  backdrop.addColorStop(1, "rgba(6, 8, 13, 0)");
  context.fillStyle = backdrop;
  context.fillRect(0, 0, width, height);

  context.globalCompositeOperation = "source-over";
  context.filter = `blur(${Math.max(7, Math.min(16, width * 0.025))}px)`;
  for (let layer = 0; layer < CANVAS_FALLBACK_SMOKE_LAYERS; layer += 1) {
    const normalized = layer / Math.max(1, CANVAS_FALLBACK_SMOKE_LAYERS - 1);
    const advected = (normalized + time * 0.052 + layer * 0.017) % 1;
    const shoulder = Math.sin(Math.min(1, advected) * Math.PI);
    const driftX =
      Math.sin(advected * 6.4 + time * 0.46 + layer * 1.7) * width * (0.018 + advected * 0.07);
    const driftY = Math.sin(time * (0.38 + layer * 0.011) + layer) * height * 0.018;
    const x = centerX + driftX;
    const y = baseY - advected * plumeHeight + driftY;
    const radiusX = width * (0.08 + shoulder * 0.17 + advected * 0.06);
    const radiusY = height * (0.052 + shoulder * 0.12 + advected * 0.045);
    const alpha = (0.13 + shoulder * 0.08) * (1 - advected * 0.46);
    const gradient = context.createRadialGradient(x, y, radiusX * 0.1, x, y, radiusX);
    gradient.addColorStop(0, `rgba(188, 200, 204, ${alpha})`);
    gradient.addColorStop(0.42, `rgba(135, 153, 160, ${alpha * 0.54})`);
    gradient.addColorStop(1, "rgba(63, 75, 82, 0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(x, y, radiusX, radiusY, Math.sin(time * 0.28 + layer) * 0.55, 0, Math.PI * 2);
    context.fill();
  }

  context.filter = `blur(${Math.max(1.5, Math.min(4, width * 0.007))}px)`;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (let strand = 0; strand < 12; strand += 1) {
    const offset = strand / 11;
    const phase = time * (0.32 + offset * 0.2) + strand * 0.9;
    const startY = baseY - plumeHeight * (0.18 + offset * 0.58);
    const endY = startY - height * (0.12 + offset * 0.1);
    const startX = centerX + Math.sin(phase) * width * (0.035 + offset * 0.08);
    const endX = startX + Math.cos(phase * 0.82) * width * (0.08 + offset * 0.12);
    context.globalAlpha = 0.12 * (1 - offset * 0.35);
    context.strokeStyle = "rgba(174, 190, 198, 0.74)";
    context.lineWidth = Math.max(1, width * (0.006 + offset * 0.004));
    context.beginPath();
    context.moveTo(startX, startY);
    context.bezierCurveTo(
      startX + Math.sin(phase + 1.2) * width * 0.12,
      startY - height * 0.08,
      endX - Math.cos(phase) * width * 0.08,
      endY + height * 0.04,
      endX,
      endY,
    );
    context.stroke();
  }

  context.globalAlpha = 0.58;
  context.filter = "blur(10px)";
  const baseGradient = context.createRadialGradient(
    centerX,
    baseY,
    width * 0.035,
    centerX,
    baseY,
    width * 0.18,
  );
  baseGradient.addColorStop(0, "rgba(190, 199, 201, 0.24)");
  baseGradient.addColorStop(0.58, "rgba(121, 134, 139, 0.17)");
  baseGradient.addColorStop(1, "rgba(42, 48, 54, 0)");
  context.fillStyle = baseGradient;
  context.beginPath();
  context.ellipse(centerX, baseY, width * 0.18, height * 0.12, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function createPreviewWebGLRenderer(canvas: HTMLCanvasElement): PreviewRenderer | null {
  let probeRenderer: THREE.WebGLRenderer | null = null;
  try {
    probeRenderer = new THREE.WebGLRenderer({
      canvas: canvas.ownerDocument.createElement("canvas"),
      antialias: true,
    });
  } catch {
    return null;
  } finally {
    probeRenderer?.dispose();
  }

  try {
    return new THREE.WebGLRenderer({
      canvas,
      antialias: true,
    });
  } catch {
    return null;
  }
}

async function createPreviewRenderer(
  canvas: HTMLCanvasElement,
  preferWebGPU: boolean,
): Promise<{ readonly label: string; readonly renderer: PreviewRenderer }> {
  if (preferWebGPU) {
    const renderer = await createPreviewWebGPURenderer(canvas);
    if (renderer) {
      return { label: "WebGPU volume", renderer };
    }
  }

  const webglRenderer = createPreviewWebGLRenderer(canvas);
  if (webglRenderer) {
    return {
      label: "Compatible preview",
      renderer: webglRenderer,
    };
  }

  return {
    label: "Canvas fallback",
    renderer: createCanvasFallbackRenderer(canvas),
  };
}

type PreviewCameraDragMode = "orbit" | "pan" | "zoom";

type PreviewCameraDragState = {
  readonly mode: PreviewCameraDragMode;
  readonly pointerId: number;
  previousX: number;
  previousY: number;
};

type PreviewCameraState = {
  readonly spherical: THREE.Spherical;
  readonly target: THREE.Vector3;
};

const PREVIEW_CAMERA_FOV = 44;
const PREVIEW_CAMERA_MIN_DISTANCE = 1.35;
const PREVIEW_CAMERA_MAX_DISTANCE = 16;
const PREVIEW_POINTER_ORBIT_SPEED = 0.012;
const PREVIEW_POINTER_ZOOM_SPEED = 0.01;
const PREVIEW_WHEEL_ZOOM_SPEED = 0.001;
const PREVIEW_PITCH_EPSILON = 0.01;
const PREVIEW_CAMERA_NAVIGATION_RATE = 18;

function createPreviewCameraState(camera: THREE.PerspectiveCamera): PreviewCameraState {
  const target = new THREE.Vector3(0, 3.15, 0);
  const spherical = new THREE.Spherical().setFromVector3(
    new THREE.Vector3().subVectors(camera.position, target),
  );
  spherical.radius = THREE.MathUtils.clamp(
    spherical.radius,
    PREVIEW_CAMERA_MIN_DISTANCE,
    PREVIEW_CAMERA_MAX_DISTANCE,
  );
  spherical.phi = THREE.MathUtils.clamp(
    spherical.phi,
    PREVIEW_PITCH_EPSILON,
    Math.PI - PREVIEW_PITCH_EPSILON,
  );
  return { spherical, target };
}

function syncPreviewCamera(camera: THREE.PerspectiveCamera, cameraState: PreviewCameraState): void {
  const offset = new THREE.Vector3().setFromSpherical(cameraState.spherical);
  camera.position.copy(cameraState.target).add(offset);
  camera.lookAt(cameraState.target);
  camera.updateMatrixWorld();
}

function clonePreviewCameraState(cameraState: PreviewCameraState): PreviewCameraState {
  return {
    spherical: new THREE.Spherical(
      cameraState.spherical.radius,
      cameraState.spherical.phi,
      cameraState.spherical.theta,
    ),
    target: cameraState.target.clone(),
  };
}

function copyPreviewCameraState(target: PreviewCameraState, source: PreviewCameraState): void {
  target.spherical.radius = source.spherical.radius;
  target.spherical.phi = source.spherical.phi;
  target.spherical.theta = source.spherical.theta;
  target.target.copy(source.target);
}

function lerpAngleRadians(current: number, target: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * alpha;
}

function previewNavigationAlpha(deltaSeconds: number): number {
  if (deltaSeconds <= 0) {
    return 0;
  }
  return 1 - Math.exp(-PREVIEW_CAMERA_NAVIGATION_RATE * Math.min(deltaSeconds, 0.1));
}

function previewCameraPositionFromState(cameraState: PreviewCameraState): THREE.Vector3 {
  return new THREE.Vector3().setFromSpherical(cameraState.spherical).add(cameraState.target);
}

function previewCameraBasis(cameraState: PreviewCameraState): {
  readonly right: THREE.Vector3;
  readonly up: THREE.Vector3;
} {
  const position = previewCameraPositionFromState(cameraState);
  const forward = cameraState.target.clone().sub(position).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  return { right, up };
}

function updatePreviewCameraSmoothing(
  camera: THREE.PerspectiveCamera,
  renderedState: PreviewCameraState,
  desiredState: PreviewCameraState,
  deltaSeconds: number,
): void {
  const alpha = previewNavigationAlpha(deltaSeconds);
  renderedState.target.lerp(desiredState.target, alpha);
  renderedState.spherical.radius = THREE.MathUtils.lerp(
    renderedState.spherical.radius,
    desiredState.spherical.radius,
    alpha,
  );
  renderedState.spherical.phi = THREE.MathUtils.lerp(
    renderedState.spherical.phi,
    desiredState.spherical.phi,
    alpha,
  );
  renderedState.spherical.theta = lerpAngleRadians(
    renderedState.spherical.theta,
    desiredState.spherical.theta,
    alpha,
  );

  const targetDelta = renderedState.target.distanceToSquared(desiredState.target);
  const radiusDelta = Math.abs(renderedState.spherical.radius - desiredState.spherical.radius);
  const phiDelta = Math.abs(renderedState.spherical.phi - desiredState.spherical.phi);
  const thetaDelta = Math.abs(
    Math.atan2(
      Math.sin(desiredState.spherical.theta - renderedState.spherical.theta),
      Math.cos(desiredState.spherical.theta - renderedState.spherical.theta),
    ),
  );
  if (targetDelta < 1e-6 && radiusDelta < 1e-4 && phiDelta < 1e-4 && thetaDelta < 1e-4) {
    copyPreviewCameraState(renderedState, desiredState);
  }

  syncPreviewCamera(camera, renderedState);
}

function getPreviewPointerNavigationMode(
  event: Pick<
    PointerEvent | React.PointerEvent,
    "altKey" | "button" | "ctrlKey" | "metaKey" | "shiftKey"
  >,
  isApple: boolean,
): PreviewCameraDragMode | null {
  if (event.button === 1) {
    return event.shiftKey ? "pan" : "orbit";
  }
  if (event.button !== 0 || !event.altKey) {
    return null;
  }
  if (isApple && event.metaKey && !event.ctrlKey) {
    return "pan";
  }
  if (isApple && event.ctrlKey && !event.metaKey) {
    return "zoom";
  }
  if (!isApple && event.ctrlKey && !event.metaKey) {
    return "pan";
  }
  if (event.ctrlKey || event.metaKey) {
    return null;
  }
  return "orbit";
}

function orbitPreviewCamera(cameraState: PreviewCameraState, deltaX: number, deltaY: number): void {
  cameraState.spherical.theta -= deltaX * PREVIEW_POINTER_ORBIT_SPEED;
  cameraState.spherical.phi = THREE.MathUtils.clamp(
    cameraState.spherical.phi - deltaY * PREVIEW_POINTER_ORBIT_SPEED,
    PREVIEW_PITCH_EPSILON,
    Math.PI - PREVIEW_PITCH_EPSILON,
  );
}

function panPreviewCamera(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  cameraState: PreviewCameraState,
  deltaX: number,
  deltaY: number,
): void {
  const viewportHeight = Math.max(canvas.clientHeight || canvas.getBoundingClientRect().height, 1);
  const visibleHalfHeight =
    (Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) * cameraState.spherical.radius) /
    Math.max(camera.zoom, 0.001);
  const unitsPerPixel = (2 * visibleHalfHeight) / viewportHeight;
  const { right, up } = previewCameraBasis(cameraState);
  cameraState.target.addScaledVector(right, -deltaX * unitsPerPixel);
  cameraState.target.addScaledVector(up, deltaY * unitsPerPixel);
}

function zoomPreviewCamera(cameraState: PreviewCameraState, multiplier: number): void {
  cameraState.spherical.radius = THREE.MathUtils.clamp(
    cameraState.spherical.radius * multiplier,
    PREVIEW_CAMERA_MIN_DISTANCE,
    PREVIEW_CAMERA_MAX_DISTANCE,
  );
}

function normalizedWheelDeltaY(
  event: Pick<WheelEvent | React.WheelEvent, "deltaMode" | "deltaY">,
): number {
  if (event.deltaMode === 1) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === 2) {
    return event.deltaY * 160;
  }
  return event.deltaY;
}

function PreviewViewport({
  isApple = false,
  params,
  runtimeConfig,
  onTelemetry,
}: {
  readonly isApple: boolean;
  readonly params: WispySmokeVFXParams;
  readonly runtimeConfig: WispySmokeRuntimeConfig;
  readonly onTelemetry: (telemetry: PreviewTelemetry) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraDesiredStateRef = useRef<PreviewCameraState | null>(null);
  const cameraRenderedStateRef = useRef<PreviewCameraState | null>(null);
  const cameraDragRef = useRef<PreviewCameraDragState | null>(null);
  const effectRef = useRef<WispySmokeVFX | null>(null);
  const paramsRef = useRef(params);
  const previewLabelRef = useRef("Starting preview");
  const previewStartMsRef = useRef(performance.now());
  const runtimeConfigRef = useRef(runtimeConfig);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const webgpu = useMemo(() => getWebGPUFeatureStatus(), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let disposed = false;
    let frame = 0;
    let observer: ResizeObserver | null = null;
    let started = false;
    let startupFallback = 0;

    const startPreview = (label: string, renderer: PreviewRenderer): void => {
      if (disposed || started) {
        renderer.dispose();
        return;
      }
      started = true;
      window.clearTimeout(startupFallback);
      configurePreviewRendererColor(renderer);
      renderer.setClearColor("#06080d", 1);
      rendererRef.current = renderer;

      const scene = new THREE.Scene();
      sceneRef.current = scene;
      previewLabelRef.current = label;
      previewStartMsRef.current = performance.now();
      const camera = new THREE.PerspectiveCamera(PREVIEW_CAMERA_FOV, 1, 0.1, 80);
      camera.position.set(1.15, 3.55, 12.8);
      camera.lookAt(0, 3.15, 0);
      const cameraDesiredState = createPreviewCameraState(camera);
      const cameraRenderedState = clonePreviewCameraState(cameraDesiredState);
      cameraRef.current = camera;
      cameraDesiredStateRef.current = cameraDesiredState;
      cameraRenderedStateRef.current = cameraRenderedState;
      syncPreviewCamera(camera, cameraRenderedState);

      const grid = new THREE.GridHelper(5.5, 16, "#243244", "#151d2a");
      grid.position.y = -0.02;
      for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
        material.transparent = true;
        material.opacity = 0.18;
      }
      scene.add(grid);
      const effect = new WispySmokeVFX({
        ...paramsRef.current,
        config: runtimeConfigRef.current,
        renderer,
      });
      scene.add(effect.object3D);
      effectRef.current = effect;
      onTelemetry({
        ...EMPTY_PREVIEW_STATS,
        ...effect.getStats(),
        webgpuLabel: label,
        webgpuSupported: webgpu.supported,
      });

      let last = performance.now();
      let statsElapsed = 0;
      let statsFrames = 0;
      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        renderer.setPixelRatio(resolvePreviewPixelRatio(renderer, width, height));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.zoom = camera.aspect < 1 ? Math.max(0.66, Math.min(1, camera.aspect * 1.1)) : 1;
        camera.updateProjectionMatrix();
      };
      observer = new ResizeObserver(resize);
      observer.observe(canvas);
      resize();

      const tick = (now: number) => {
        const rawDelta = Math.max(0, (now - last) / 1000);
        const delta = Math.min(0.05, rawDelta);
        const sampleDelta = rawDelta > 0.5 ? 0 : rawDelta;
        last = now;
        const activeEffect = effectRef.current;
        activeEffect?.update(delta, (now - previewStartMsRef.current) / 1000);
        if (cameraRenderedStateRef.current && cameraDesiredStateRef.current) {
          updatePreviewCameraSmoothing(
            camera,
            cameraRenderedStateRef.current,
            cameraDesiredStateRef.current,
            delta,
          );
        }
        renderer.render(scene, camera);
        if (sampleDelta > 0) {
          statsElapsed += sampleDelta;
          statsFrames += 1;
        }
        if (statsElapsed >= 0.25) {
          const averageFrameSeconds = statsElapsed / statsFrames;
          onTelemetry({
            ...(activeEffect?.getStats() ?? EMPTY_PREVIEW_STATS),
            fps: Math.round(statsFrames / Math.max(statsElapsed, 0.001)),
            frameMs: averageFrameSeconds * 1000,
            webgpuLabel: label,
            webgpuSupported: webgpu.supported,
          });
          statsElapsed = 0;
          statsFrames = 0;
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    startupFallback = window.setTimeout(() => {
      if (disposed || started) {
        return;
      }
      const renderer = createPreviewWebGLRenderer(canvas);
      startPreview(
        renderer ? "Compatible preview" : "Canvas fallback",
        renderer ?? createCanvasFallbackRenderer(canvas),
      );
    }, PREVIEW_WEBGPU_INIT_TIMEOUT_MS + 500);

    void (async () => {
      onTelemetry({
        ...EMPTY_PREVIEW_STATS,
        webgpuLabel: "Starting preview",
        webgpuSupported: webgpu.supported,
      });
      const { label, renderer } = await createPreviewRenderer(canvas, webgpu.supported);
      startPreview(label, renderer);
    })();

    return () => {
      disposed = true;
      window.clearTimeout(startupFallback);
      cancelAnimationFrame(frame);
      observer?.disconnect();
      effectRef.current?.dispose();
      rendererRef.current?.dispose();
      cameraDragRef.current = null;
      cameraRef.current = null;
      cameraDesiredStateRef.current = null;
      cameraRenderedStateRef.current = null;
      rendererRef.current = null;
      effectRef.current = null;
      sceneRef.current = null;
    };
  }, [onTelemetry, webgpu.supported]);

  useEffect(() => {
    paramsRef.current = params;
    runtimeConfigRef.current = runtimeConfig;
    effectRef.current?.setParamsAndRuntimeConfig(params, runtimeConfig);
  }, [params, runtimeConfig]);

  const resetPreviewEffect = useCallback(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    if (!scene || !renderer) {
      return;
    }

    const previousEffect = effectRef.current;
    if (previousEffect) {
      scene.remove(previousEffect.object3D);
      previousEffect.dispose();
    }

    previewStartMsRef.current = performance.now();
    const nextEffect = new WispySmokeVFX({
      ...paramsRef.current,
      config: runtimeConfigRef.current,
      renderer,
    });
    scene.add(nextEffect.object3D);
    effectRef.current = nextEffect;
    onTelemetry({
      ...EMPTY_PREVIEW_STATS,
      ...nextEffect.getStats(),
      webgpuLabel: previewLabelRef.current,
      webgpuSupported: webgpu.supported,
    });
  }, [onTelemetry, webgpu.supported]);

  const endPreviewNavigation = useCallback((event?: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = cameraDragRef.current;
    if (event && drag && drag.pointerId !== event.pointerId) {
      return;
    }
    if (event && drag) {
      try {
        if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
          event.currentTarget.releasePointerCapture(drag.pointerId);
        }
      } catch {
        // Pointer capture cleanup can fail in synthetic or detached event paths.
      }
    }
    cameraDragRef.current = null;
    setIsNavigating(false);
  }, []);

  const handlePreviewPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const mode = getPreviewPointerNavigationMode(event, isApple);
      if (!mode) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      cameraDragRef.current = {
        mode,
        pointerId: event.pointerId,
        previousX: event.clientX,
        previousY: event.clientY,
      };
      setIsNavigating(true);
      event.currentTarget.focus({ preventScroll: true });
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can be unavailable in some browser test environments.
      }
    },
    [isApple],
  );

  const handlePreviewPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = cameraDragRef.current;
    const camera = cameraRef.current;
    const cameraState = cameraDesiredStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !camera || !cameraState) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const deltaX = event.clientX - drag.previousX;
    const deltaY = event.clientY - drag.previousY;
    drag.previousX = event.clientX;
    drag.previousY = event.clientY;
    if (Math.abs(deltaX) < 0.01 && Math.abs(deltaY) < 0.01) {
      return;
    }
    if (drag.mode === "pan") {
      panPreviewCamera(event.currentTarget, camera, cameraState, deltaX, deltaY);
      return;
    }
    if (drag.mode === "zoom") {
      zoomPreviewCamera(cameraState, Math.exp(deltaY * PREVIEW_POINTER_ZOOM_SPEED));
      return;
    }
    orbitPreviewCamera(cameraState, deltaX, deltaY);
  }, []);

  const handlePreviewWheel = useCallback((event: WheelEvent) => {
    const camera = cameraRef.current;
    const cameraState = cameraDesiredStateRef.current;
    const deltaY = normalizedWheelDeltaY(event);
    if (!camera || !cameraState || Math.abs(deltaY) < 0.01) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    zoomPreviewCamera(cameraState, Math.exp(deltaY * PREVIEW_WHEEL_ZOOM_SPEED));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.addEventListener("wheel", handlePreviewWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handlePreviewWheel);
  }, [handlePreviewWheel]);

  useEffect(() => {
    const handleBlur = () => endPreviewNavigation();
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [endPreviewNavigation]);

  useEffect(() => {
    if (!isMaximized) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setIsMaximized(false);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isMaximized]);

  return (
    <>
      <section
        className={`preview-panel ${isMaximized ? "preview-panel-maximized" : ""} ${
          isNavigating ? "preview-panel-navigating" : ""
        }`}
      >
        <div className="preview-controls">
          <button
            type="button"
            className="icon-button preview-control-button"
            title="Restart preview"
            aria-label="Restart preview"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={resetPreviewEffect}
          >
            <RotateCcw size={15} />
          </button>
          <button
            type="button"
            className="icon-button preview-control-button"
            title={isMaximized ? "Minimize preview" : "Maximize preview"}
            aria-label={isMaximized ? "Minimize preview" : "Maximize preview"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setIsMaximized((current) => !current)}
          >
            {isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
        <canvas
          ref={canvasRef}
          aria-label="Wispy Smoke preview"
          tabIndex={0}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onPointerCancel={endPreviewNavigation}
          onPointerDown={handlePreviewPointerDown}
          onPointerMove={handlePreviewPointerMove}
          onPointerUp={endPreviewNavigation}
          onLostPointerCapture={endPreviewNavigation}
        />
      </section>
      {isMaximized ? (
        <div
          className="preview-modal-backdrop"
          role="presentation"
          onPointerDown={() => setIsMaximized(false)}
        />
      ) : null}
    </>
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
