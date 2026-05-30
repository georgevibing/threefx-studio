# ThreeFX Studio Architecture

## Product Architecture

ThreeFX Studio is an authoring tool, compiler, runtime, and exporter. The editor owns interactive UI state, but the saved graph is a versioned document independent of React Flow. The compiler consumes that graph, validates it, and emits deterministic Effect IR. Preview and export consume Effect IR or typed runtime params, never raw React state.

Main pipeline:

1. UI graph state
2. Versioned graph schema
3. Validated graph document
4. Effect IR
5. Runtime configuration
6. Live preview runtime instance
7. Exported TypeScript source package

## Package Architecture

- `@threefx/core`: graph schema, node definitions, port/type system, parameter metadata, validation, serialization, compiler interfaces, Effect IR.
- `@threefx/runtime`: renderer-facing lifecycle types, quality presets, disposal helpers, feature detection.
- `@threefx/effects`: built-in effects and presets. It may depend on core metadata and runtime helpers.
- `@threefx/exporter`: converts validated Effect IR into standalone TypeScript files.
- `@threefx/ui`: reusable UI styling helpers only.
- `@threefx/builder`: React app; depends on packages, but no package depends on the app.

## Editor Architecture

The builder uses React Flow for canvas interactions. React Flow nodes and edges are projections of `GraphDocument`. Node positions are persisted back to the graph document, but React Flow handles are not part of core. The inspector edits parameter metadata and graph parameter values. Preview receives typed `WispySmokeVFXParams`.

## Graph Schema

`GraphDocument` is versioned with `schemaVersion`. It contains nodes, edges, effect parameters, and viewport state. Nodes reference catalog `type` strings. Edges reference source/target node ids and source/target port ids.

## Node Registry

The registry maps node type ids to `NodeDefinition`. Definitions include label, category, description, ports, default parameters, and parameter metadata. New nodes are added by extending the registry and tests.

## Port/Type System

Ports are directional and typed. The compatibility layer allows exact assignment and narrow coercions such as `int` to `float`. Target ports may list accepted types. UI connection checks and core validation use the same rules.

## Validation Pipeline

Validation checks schema version, graph kind, supported effect type, duplicate ids, unknown node types, missing nodes/ports, direction errors, type mismatches, occupied single-input ports, missing required inputs, and cycles. Diagnostics are human-readable and include node/edge/path references.

## Compiler Pipeline

The compiler validates first. Valid graphs are topologically ordered, normalized, and hashed with stable JSON. The output is `EffectIR`, containing parameter metadata, parameter values, ordered nodes, deterministic connections, and a graph hash.

## Effect IR

Effect IR is the boundary between authoring and runtime/export. It is deterministic, renderer-neutral where practical, and intentionally smaller than UI state. Exporters should consume IR, not React Flow objects.

## Runtime Architecture

Runtime effects implement:

```ts
interface VFXEffect<TParams> {
  readonly object3D: THREE.Object3D;
  init?(): Promise<void>;
  update(deltaSeconds: number, elapsedSeconds?: number): void | Promise<void>;
  setParams(params: Partial<TParams>): void;
  getParams(): Readonly<TParams>;
  dispose(): void;
}
```

Wispy Smoke currently uses a conservative Three.js particle-volume impostor with procedural shader detail. This keeps the vertical slice usable while leaving space for WebGPU compute and TSL backends.

## Three.js WebGPU Boundaries

Core graph schema must avoid direct Three.js coupling. Runtime and effects may import Three.js. WebGPU feature detection lives in runtime. Future WebGPU renderer-specific handles must stay in runtime/effects adapters, not core or exporter schema.

## Exporter Architecture

The exporter accepts Effect IR and emits standalone files. Generated code must not import React, builder app code, or private workspace code. Output should be deterministic for the same IR.

## Generated Code

Generated classes include typed params, default values, lifecycle methods, and a usage snippet. Comments are limited to useful integration context. Generated code owns its local helper types so it can be pasted into another Three.js project.

## Testing Strategy

Vitest covers serialization/deserialization, port compatibility, validation diagnostics, registry behavior, compiler determinism, parameter metadata, exporter file shape, and generated source presence. Future work should add visual regression and runtime smoke tests.

## Performance Strategy

Default quality budgets avoid huge allocations. Runtime effects clamp delta time, use reusable typed arrays, and expose quality presets. Future WebGPU work should introspect device limits and scale resources automatically.

## Resource Lifecycle

Every geometry, material, texture, renderer-owned helper, and GPU resource must have disposal semantics. Effects own `dispose()`. Exported code must preserve disposal behavior.

## Errors And Diagnostics

Core diagnostics are structured and user-readable. Builder UI displays errors before export. Exporters throw only for unsupported effect types or programmer errors after validation.

## Serialization And Versioning

Graph documents include `schemaVersion`. Breaking schema changes require migrations before validation. Effect IR has its own version so exporter changes do not force graph changes.

## Extension Points

Future effect families can add node definitions, parameter metadata, validators, compiler passes, runtime classes, and exporter templates. Planned families include fire, embers, sparks, shockwaves, magic trails, shields, fog, portals, weather, fluids, particle-fluid hybrids, mesh deformation, SDF collisions, vector fields, flipbooks, and multiple export targets.

## Dependency Rules

Core must not depend on React, React Flow, Three.js runtime handles, builder app code, or exporter code. Runtime must not depend on React or builder app code. Exporter must consume validated IR. UI packages may depend on core patterns but must not leak UI concerns into core. Avoid circular dependencies.
