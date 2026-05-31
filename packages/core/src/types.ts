export const THREEFX_GRAPH_SCHEMA_VERSION = 1;
export const THREEFX_IR_SCHEMA_VERSION = 1;

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type ColorValue = `#${string}`;

export type CurveKeyframe = {
  readonly time: number;
  readonly value: number;
  readonly inTangent?: number;
  readonly outTangent?: number;
};

export type CurveValue = readonly CurveKeyframe[];

export type ParameterValue =
  | number
  | boolean
  | string
  | Vec2
  | Vec3
  | CurveValue
  | null;

export type ParameterMap = Record<string, ParameterValue>;

export type ParameterType =
  | "float"
  | "int"
  | "bool"
  | "string"
  | "color"
  | "vec2"
  | "vec3"
  | "curve"
  | "quality";

export type QualityPreset = "low" | "medium" | "high" | "cinematic";

export type WispySmokeBackendMode = "auto" | "webgpu" | "compat";
export type WispySmokeGridResolution = "low" | "medium" | "high" | "cinematic";

export interface ParameterMetadata {
  readonly id: string;
  readonly label: string;
  readonly type: ParameterType;
  readonly defaultValue: ParameterValue;
  readonly group: string;
  readonly description?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly options?: readonly string[];
}

export type PortDirection = "input" | "output";

export type PortType =
  | "flow"
  | "float"
  | "int"
  | "bool"
  | "string"
  | "color"
  | "vec2"
  | "vec3"
  | "curve"
  | "quality"
  | "emitter"
  | "force"
  | "field"
  | "simulation"
  | "volume"
  | "transform"
  | "render"
  | "effect"
  | "any";

export interface PortDefinition {
  readonly id: string;
  readonly label: string;
  readonly direction: PortDirection;
  readonly type: PortType;
  readonly acceptedTypes?: readonly PortType[];
  readonly required?: boolean;
  readonly multiple?: boolean;
  readonly defaultValue?: ParameterValue;
  readonly group?: string;
  readonly description?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly options?: readonly string[];
  readonly effectParameterId?: string;
}

export type NodeKind =
  | "output"
  | "emitter"
  | "parameter"
  | "noise"
  | "force"
  | "simulation"
  | "render"
  | "transform"
  | "quality";

export interface NodeDefinition {
  readonly type: string;
  readonly kind: NodeKind;
  readonly label: string;
  readonly category: string;
  readonly description: string;
  readonly ports: readonly PortDefinition[];
  readonly defaultParameters?: ParameterMap;
}

export interface GraphNode {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly position: Vec2;
  readonly parameters?: ParameterMap;
  readonly enabled?: boolean;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly sourcePort: string;
  readonly target: string;
  readonly targetPort: string;
}

export interface GraphViewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface GraphDocument {
  readonly schemaVersion: typeof THREEFX_GRAPH_SCHEMA_VERSION;
  readonly kind: "ThreeFXGraph";
  readonly effectType: "wispy-smoke";
  readonly name: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly parameters: ParameterMap;
  readonly viewport?: GraphViewport;
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  readonly id: string;
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly nodeId?: string;
  readonly edgeId?: string;
  readonly path?: string;
}

export interface ValidationResult {
  readonly graph: GraphDocument;
  readonly diagnostics: readonly Diagnostic[];
  readonly valid: boolean;
}

export interface EffectIRNode {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly parameters: ParameterMap;
}

export interface EffectIRConnection {
  readonly source: string;
  readonly sourcePort: string;
  readonly target: string;
  readonly targetPort: string;
}

export interface EffectIR {
  readonly schemaVersion: typeof THREEFX_IR_SCHEMA_VERSION;
  readonly kind: "ThreeFXEffectIR";
  readonly effectType: "wispy-smoke";
  readonly effectName: string;
  readonly graphHash: string;
  readonly runtime: {
    readonly backendMode: WispySmokeBackendMode;
    readonly fallback: "compat";
    readonly gridResolution: WispySmokeGridResolution;
    readonly quality: QualityPreset;
    readonly renderModel: "volume-raymarch";
    readonly solver: "eulerian-fluid-grid";
  };
  readonly parameters: readonly ParameterMetadata[];
  readonly parameterValues: ParameterMap;
  readonly nodes: readonly EffectIRNode[];
  readonly connections: readonly EffectIRConnection[];
}

export interface CompileResult {
  readonly ir: EffectIR | null;
  readonly diagnostics: readonly Diagnostic[];
}
