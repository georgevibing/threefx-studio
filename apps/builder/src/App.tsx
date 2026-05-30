import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  Clipboard,
  Copy,
  Download,
  FileDown,
  FolderOpen,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  WISPY_SMOKE_PARAMETER_METADATA,
  canConnectPorts,
  compileGraphToIR,
  createWispySmokeGraph,
  defaultNodeRegistry,
  deserializeGraphDocument,
  findNodePort,
  getNodePorts,
  serializeGraphDocument,
  toGraphEdgeId,
  validateGraphDocument,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type NodeDefinition,
  type ParameterMetadata,
  type ParameterValue,
  type PortDefinition,
} from "@threefx/core";
import { WispySmokeVFX, type WispySmokeVFXParams } from "@threefx/effects";
import { createExportZip, exportEffectToTypeScript } from "@threefx/exporter";
import { getWebGPUFeatureStatus } from "@threefx/runtime";

type FlowNodeData = {
  readonly graphNode: GraphNode;
  readonly definition: NodeDefinition;
  readonly connectedPorts: ReadonlySet<string>;
};

type FlowNode = Node<FlowNodeData, "threefxNode">;
type FlowEdge = Edge;

type QuickAddMode =
  | { readonly kind: "free" }
  | { readonly kind: "fromOutput"; readonly nodeId: string; readonly portId: string }
  | { readonly kind: "fromInput"; readonly nodeId: string; readonly portId: string };

type QuickAddState = {
  readonly screen: { readonly x: number; readonly y: number };
  readonly flow: { readonly x: number; readonly y: number };
  readonly mode: QuickAddMode;
};

type NodeMenuState = {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
};

const LOCAL_STORAGE_KEY = "threefx-studio:wispy-smoke-graph";

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
          graphNode: node,
          definition,
          connectedPorts: connected.get(node.id) ?? new Set<string>(),
        },
      },
    ];
  });
}

function graphToFlowEdges(graph: GraphDocument, selectedEdgeIds: ReadonlySet<string>): FlowEdge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourcePort,
    target: edge.target,
    targetHandle: edge.targetPort,
    selected: selectedEdgeIds.has(edge.id),
    className: selectedEdgeIds.has(edge.id) ? "threefx-edge threefx-edge-selected" : "threefx-edge",
  }));
}

function isConnectionValid(graph: GraphDocument, connection: Connection | FlowEdge): boolean {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
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
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
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

function nodeHasCompatibleInput(definition: NodeDefinition, sourcePort: PortDefinition): boolean {
  return definition.ports.some((port) => canConnectPorts(sourcePort, port));
}

function nodeHasCompatibleOutput(definition: NodeDefinition, targetPort: PortDefinition): boolean {
  return definition.ports.some((port) => canConnectPorts(port, targetPort));
}

function firstCompatibleInput(definition: NodeDefinition, sourcePort: PortDefinition): PortDefinition | null {
  return definition.ports.find((port) => canConnectPorts(sourcePort, port)) ?? null;
}

function firstCompatibleOutput(definition: NodeDefinition, targetPort: PortDefinition): PortDefinition | null {
  return definition.ports.find((port) => canConnectPorts(port, targetPort)) ?? null;
}

function App() {
  const [graph, setGraph] = useState<GraphDocument>(() => loadInitialGraph());
  const [selectedNodeIds, setSelectedNodeIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<ReadonlySet<string>>(new Set());
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
  const [status, setStatus] = useState("Ready");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { screenToFlowPosition } = useReactFlow<FlowNode, FlowEdge>();

  const validation = useMemo(() => validateGraphDocument(graph), [graph]);
  const compileResult = useMemo(() => compileGraphToIR(graph), [graph]);
  const flowNodes = useMemo(() => graphToFlowNodes(graph, selectedNodeIds), [graph, selectedNodeIds]);
  const flowEdges = useMemo(() => graphToFlowEdges(graph, selectedEdgeIds), [graph, selectedEdgeIds]);
  const selectedNode = useMemo(
    () => graph.nodes.find((node) => selectedNodeIds.has(node.id)) ?? null,
    [graph.nodes, selectedNodeIds],
  );

  const updateGraph = useCallback((updater: (current: GraphDocument) => GraphDocument) => {
    setGraph((current) => updater(current));
  }, []);

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
      updateGraph((current) => {
        const id = createUniqueNodeId(type, current.nodes);
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
      });
      setSelectedNodeIds(new Set([createUniqueNodeId(type, graph.nodes)]));
      setSelectedEdgeIds(new Set());
      setQuickAdd(null);
      setNodeMenu(null);
    },
    [graph.nodes, updateGraph],
  );

  const deleteSelection = useCallback(() => {
    updateGraph((current) => {
      const nodeIds = selectedNodeIds;
      const edgeIds = selectedEdgeIds;
      return {
        ...current,
        nodes: current.nodes.filter((node) => !nodeIds.has(node.id)),
        edges: current.edges.filter(
          (edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target),
        ),
      };
    });
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setNodeMenu(null);
  }, [selectedEdgeIds, selectedNodeIds, updateGraph]);

  const duplicateSelected = useCallback(() => {
    const node = graph.nodes.find((entry) => selectedNodeIds.has(entry.id));
    if (!node) {
      return;
    }
    const id = createUniqueNodeId(node.type, graph.nodes);
    const copy: GraphNode = {
      ...node,
      id,
      label: `${node.label} Copy`,
      position: [node.position[0] + 32, node.position[1] + 32],
    };
    updateGraph((current) => ({ ...current, nodes: [...current.nodes, copy] }));
    setSelectedNodeIds(new Set([id]));
    setSelectedEdgeIds(new Set());
    setNodeMenu(null);
  }, [graph.nodes, selectedNodeIds, updateGraph]);

  const updateParameter = useCallback(
    (id: string, value: ParameterValue) => {
      updateGraph((current) => ({
        ...current,
        parameters: { ...current.parameters, [id]: value },
        nodes: current.nodes.map((node) => {
          if (node.type !== `parameter.${id}`) {
            return node;
          }
          return {
            ...node,
            parameters: { ...(node.parameters ?? {}), value },
          };
        }),
      }));
    },
    [updateGraph],
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
    setGraph(result.graph);
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setStatus(result.valid ? "Loaded local graph" : "Loaded graph with validation errors");
  }, []);

  const resetPreset = useCallback(() => {
    setGraph(createWispySmokeGraph());
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setStatus("Loaded Wispy Smoke preset");
  }, []);

  const downloadJson = useCallback(() => {
    const blob = new Blob([serializeGraphDocument(graph)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "wispy-smoke.threefx.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [graph]);

  const importJson = useCallback((file: File) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const source = String(reader.result ?? "");
      const result = deserializeGraphDocument(source);
      setGraph(result.graph);
      setSelectedNodeIds(new Set());
      setSelectedEdgeIds(new Set());
      setStatus(result.valid ? "Imported graph" : "Imported graph with validation errors");
    });
    reader.readAsText(file);
  }, []);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!isConnectionValid(graph, connection)) {
        return;
      }
      const edge = makeEdge(connection);
      updateGraph((current) => {
        if (current.edges.some((entry) => entry.id === edge.id)) {
          return current;
        }
        return { ...current, edges: [...current.edges, edge] };
      });
    },
    [graph, updateGraph],
  );

  const openQuickAddAt = useCallback(
    (screen: { x: number; y: number }, mode: QuickAddMode) => {
      setQuickAdd({
        screen,
        flow: screenToFlowPosition(screen),
        mode,
      });
      setPaletteQuery("");
    },
    [screenToFlowPosition],
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: unknown) => {
      const state = connectionState as {
        isValid?: boolean;
        fromHandle?: { id?: string; nodeId?: string; type?: string };
      };
      if (state.isValid) {
        return;
      }
      const point = clientPoint(event);
      const handle = state.fromHandle;
      if (!point || !handle?.nodeId || !handle.id) {
        return;
      }
      if (handle.type === "source") {
        openQuickAddAt(point, { kind: "fromOutput", nodeId: handle.nodeId, portId: handle.id });
      } else if (handle.type === "target") {
        openQuickAddAt(point, { kind: "fromInput", nodeId: handle.nodeId, portId: handle.id });
      }
    },
    [openQuickAddAt],
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

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelection();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveLocal();
      }
    },
    [deleteSelection, duplicateSelected, saveLocal],
  );

  const previewParams = graph.parameters as unknown as WispySmokeVFXParams;

  return (
    <main className="app-shell" tabIndex={-1} onKeyDown={handleKeyDown}>
      <TopBar
        status={status}
        nodeCount={graph.nodes.length}
        edgeCount={graph.edges.length}
        errorCount={validation.diagnostics.filter((entry) => entry.severity === "error").length}
        exportReady={Boolean(compileResult.ir)}
        onSave={saveLocal}
        onLoad={loadLocal}
        onReset={resetPreset}
        onDownloadJson={downloadJson}
        onImportClick={() => fileInputRef.current?.click()}
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
        <div className="canvas-panel" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
          <ReactFlow<FlowNode, FlowEdge>
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
            onPaneClick={() => {
              setSelectedNodeIds(new Set());
              setSelectedEdgeIds(new Set());
              setQuickAdd(null);
              setNodeMenu(null);
            }}
            onNodeClick={(_, node) => {
              setSelectedNodeIds(new Set([node.id]));
              setSelectedEdgeIds(new Set());
              setQuickAdd(null);
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              setSelectedNodeIds(new Set([node.id]));
              setSelectedEdgeIds(new Set());
              setNodeMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeIds(new Set([edge.id]));
              setSelectedNodeIds(new Set());
              setQuickAdd(null);
            }}
            onNodesChange={(changes) => {
              updateGraph((current) => ({
                ...current,
                nodes: current.nodes.map((node) => {
                  const change = changes.find((entry) => "id" in entry && entry.id === node.id);
                  if (change?.type === "position" && change.position) {
                    return { ...node, position: [change.position.x, change.position.y] };
                  }
                  return node;
                }),
              }));
              for (const change of changes) {
                if (change.type === "select") {
                  setSelectedNodeIds((current) => {
                    const next = new Set(current);
                    if (change.selected) next.add(change.id);
                    else next.delete(change.id);
                    return next;
                  });
                }
              }
            }}
            onEdgesChange={(changes) => {
              for (const change of changes) {
                if (change.type === "select") {
                  setSelectedEdgeIds((current) => {
                    const next = new Set(current);
                    if (change.selected) next.add(change.id);
                    else next.delete(change.id);
                    return next;
                  });
                }
              }
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <MiniMap
              pannable
              zoomable
              bgColor="#000000"
              maskColor="rgba(255, 255, 255, 0.08)"
              nodeColor="#1a1a1a"
              nodeStrokeColor="#737373"
            />
            <Controls />
          </ReactFlow>
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
          <PreviewViewport params={previewParams} />
          <InspectorPanel
            graph={graph}
            selectedNode={selectedNode}
            diagnostics={validation.diagnostics}
            onParameterChange={updateParameter}
          />
          <ExportPanel compileResult={compileResult} />
        </aside>
      </section>
    </main>
  );
}

function TopBar({
  status,
  nodeCount,
  edgeCount,
  errorCount,
  exportReady,
  onSave,
  onLoad,
  onReset,
  onDownloadJson,
  onImportClick,
}: {
  readonly status: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly errorCount: number;
  readonly exportReady: boolean;
  readonly onSave: () => void;
  readonly onLoad: () => void;
  readonly onReset: () => void;
  readonly onDownloadJson: () => void;
  readonly onImportClick: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">FX</span>
        <div>
          <h1>ThreeFX Studio</h1>
          <span>{status}</span>
        </div>
      </div>
      <div className="topbar-center" aria-label="Graph status">
        <span className="status-pill">{nodeCount} nodes</span>
        <span className="status-pill">{edgeCount} edges</span>
        <span className="status-pill">{errorCount === 0 ? "Graph valid" : `${errorCount} errors`}</span>
        <span className="status-pill">{exportReady ? "Export ready" : "Export blocked"}</span>
      </div>
      <div className="topbar-actions">
        <IconButton title="Save" onClick={onSave} icon={<Save size={16} />} />
        <IconButton title="Load" onClick={onLoad} icon={<FolderOpen size={16} />} />
        <IconButton title="Import" onClick={onImportClick} icon={<Upload size={16} />} />
        <IconButton title="Download graph" onClick={onDownloadJson} icon={<FileDown size={16} />} />
        <IconButton title="Reset preset" onClick={onReset} icon={<RotateCcw size={16} />} />
      </div>
    </header>
  );
}

function IconButton({
  title,
  onClick,
  icon,
}: {
  readonly title: string;
  readonly onClick: () => void;
  readonly icon: React.ReactNode;
}) {
  return (
    <button type="button" className="icon-button" title={title} aria-label={title} onClick={onClick}>
      {icon}
    </button>
  );
}

function ThreeFXNode({ data, selected }: NodeProps<FlowNode>) {
  const { graphNode, definition, connectedPorts } = data;
  const inputs = definition.ports.filter((port) => port.direction === "input");
  const outputs = definition.ports.filter((port) => port.direction === "output");

  return (
    <article className={`graph-node ${selected ? "graph-node-selected" : ""}`}>
      <div className="graph-node-header">
        <span>{definition.label}</span>
        <small>{definition.category}</small>
      </div>
      <div className="port-grid">
        <div className="port-column">
          {inputs.map((port) => (
            <PortLabel key={port.id} port={port} connected={connectedPorts.has(port.id)} side="left" />
          ))}
        </div>
        <div className="port-column port-column-right">
          {outputs.map((port) => (
            <PortLabel key={port.id} port={port} connected={connectedPorts.has(port.id)} side="right" />
          ))}
        </div>
      </div>
      {graphNode.type.startsWith("parameter.") ? (
        <div className="node-value">{String(graphNode.parameters?.value ?? "")}</div>
      ) : null}
    </article>
  );
}

function PortLabel({
  port,
  connected,
  side,
}: {
  readonly port: PortDefinition;
  readonly connected: boolean;
  readonly side: "left" | "right";
}) {
  const isSource = side === "right";
  return (
    <div
      className={`port-label ${isSource ? "port-label-out" : ""}`}
      title={`${port.label}: ${port.type}`}
    >
      <Handle
        id={port.id}
        type={isSource ? "source" : "target"}
        position={isSource ? Position.Right : Position.Left}
        className={`port-handle ${connected ? "port-handle-connected" : ""}`}
      />
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
  readonly onAddNode: (type: string, position: { x: number; y: number }, mode?: QuickAddMode) => void;
}) {
  const entries = useFilteredDefinitions(query, graph, quickAdd?.mode ?? { kind: "free" });
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
            onClick={() => onAddNode(entry.type, quickAdd?.flow ?? { x: -80, y: 40 }, quickAdd?.mode)}
          >
            <span>{entry.label}</span>
            <small>{entry.category}</small>
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
    const sourceNode = mode.kind === "fromOutput" ? graph.nodes.find((node) => node.id === mode.nodeId) : null;
    const sourcePort = sourceNode && mode.kind === "fromOutput" ? findNodePort(sourceNode, mode.portId) : null;
    const targetNode = mode.kind === "fromInput" ? graph.nodes.find((node) => node.id === mode.nodeId) : null;
    const targetPort = targetNode && mode.kind === "fromInput" ? findNodePort(targetNode, mode.portId) : null;
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
  readonly onAddNode: (type: string, position: { x: number; y: number }, mode?: QuickAddMode) => void;
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
            <small>{entry.category}</small>
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
    <div className="node-menu" style={{ left: state.x, top: state.y }} onPointerDown={(event) => event.stopPropagation()}>
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

function InspectorPanel({
  graph,
  selectedNode,
  diagnostics,
  onParameterChange,
}: {
  readonly graph: GraphDocument;
  readonly selectedNode: GraphNode | null;
  readonly diagnostics: readonly { severity: string; message: string; id: string }[];
  readonly onParameterChange: (id: string, value: ParameterValue) => void;
}) {
  const selectedDefinition = selectedNode ? defaultNodeRegistry.get(selectedNode.type) : null;
  return (
    <section className="panel inspector">
      <div className="panel-heading">
        <h2>Inspector</h2>
      </div>
      {selectedNode && selectedDefinition ? (
        <div className="selected-node">
          <strong>{selectedNode.label}</strong>
          <span>{selectedDefinition.type}</span>
          <p>{selectedDefinition.description}</p>
          <div className="port-summary">
            {getNodePorts(selectedNode).map((port) => (
              <span key={port.id}>{port.label}</span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="param-list">
        {WISPY_SMOKE_PARAMETER_METADATA.map((metadata) => (
          <ParameterField
            key={metadata.id}
            metadata={metadata}
            value={graph.parameters[metadata.id] ?? metadata.defaultValue}
            onChange={(value) => onParameterChange(metadata.id, value)}
          />
        ))}
      </div>
      <div className="diagnostics">
        {diagnostics.length === 0 ? (
          <span className="diagnostic-ok">Graph valid</span>
        ) : (
          diagnostics.slice(0, 6).map((diagnostic) => (
            <span key={diagnostic.id} className={`diagnostic diagnostic-${diagnostic.severity}`}>
              {diagnostic.message}
            </span>
          ))
        )}
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
        <span>{metadata.label}</span>
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
      </label>
    );
  }

  if (metadata.type === "color") {
    return (
      <label className="param-field">
        <span>{metadata.label}</span>
        <input type="color" value={String(value)} onChange={(event) => onChange(event.target.value)} />
      </label>
    );
  }

  if (metadata.type === "quality") {
    return (
      <label className="param-field">
        <span>{metadata.label}</span>
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
        <span>{metadata.label}</span>
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
      <span>{metadata.label}</span>
      <input
        type="number"
        min={metadata.min}
        max={metadata.max}
        step={metadata.step ?? 0.01}
        value={Number(value)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function PreviewViewport({ params }: { readonly params: WispySmokeVFXParams }) {
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

    let frame = 0;
    let last = performance.now();
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
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      effect.update(delta, now / 1000);
      renderer.render(scene, camera);
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
  }, []);

  useEffect(() => {
    effectRef.current?.setParams(params);
  }, [params]);

  return (
    <section className="preview-panel">
      <canvas ref={canvasRef} aria-label="Wispy Smoke preview" />
      <span className={`preview-badge ${webgpu.supported ? "preview-badge-ok" : ""}`}>
        {webgpu.supported ? "WebGPU available" : "Compatible preview"}
      </span>
    </section>
  );
}

function ExportPanel({ compileResult }: { readonly compileResult: ReturnType<typeof compileGraphToIR> }) {
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
          {compileResult.diagnostics.find((entry) => entry.severity === "error")?.message ?? "Graph invalid"}
        </div>
      )}
    </section>
  );
}

export default App;
