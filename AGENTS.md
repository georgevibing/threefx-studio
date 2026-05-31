# ThreeFX Studio Agent Guide

## Summary

ThreeFX Studio is a pnpm workspace for a Three.js WebGPU-oriented procedural VFX builder. The MVP is the Wispy Smoke vertical slice: typed graph, inspector, preview, Effect IR compiler, and standalone TypeScript export.

## Goals

- Keep exported effects simple, typed, documented, and independent from the builder.
- Keep graph/core logic deterministic and UI-agnostic.
- Make future WebGPU simulation work possible without rewriting package boundaries.

## Non-Goals

- No server infrastructure in the initial version.
- No direct dependency on `D:\workspace\byrsa-engine`.
- No large binary assets or external smoke textures for the main look.
- No speculative node library beyond the active vertical slice.

## Package Map

- `apps/builder`: React/Vite app.
- `packages/core`: graph schema, registry, ports, validation, compiler, metadata.
- `packages/runtime`: lifecycle interfaces, disposal, quality, feature detection.
- `packages/effects`: built-in effect implementations.
- `packages/exporter`: Effect IR to standalone TypeScript files.
- `packages/ui`: reusable UI helpers.

## Commands

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Coding Standards

- TypeScript strict mode.
- Public APIs need explicit types.
- Avoid `any`; justify it with a short comment if unavoidable.
- Keep modules small and named for behavior.
- Prefer deterministic output and stable ordering.
- Use pnpm only.

## Pre-Public Schema Changes

- Until the first public release, prefer clean breaking changes over compatibility layers.
- Do not add graph migrations, legacy schema adapters, or schema-version bumps for internal saved graph changes yet.
- Update the current schema, presets, docs, and tests in place. Add migrations only after a public version exists that users need to load.

## Testing

Add or update Vitest coverage when changing schema, ports, validation, compiler, exporter, runtime params, or generated code shape.

## Documentation

Update `README.md` for user-facing workflow changes and `architecture.md` for package or pipeline changes.
Follow `STYLEGUIDE.md` before changing visual styling, graph nodes, controls, or editor layout.

## Git Hygiene

Do not commit generated clutter. `roadmap.md` is local planning context and is gitignored by design.

## Add A Node Type

1. Add a `NodeDefinition` in `packages/core/src/registry.ts`.
2. Use existing `PortType` values or extend the type system deliberately.
3. Add validation/compiler tests if behavior changes.
4. Add UI handling only in `apps/builder` if the default renderer is insufficient.

## Add An Effect

1. Add parameter metadata in core.
2. Add graph preset and compiler support.
3. Add runtime implementation in `packages/effects`.
4. Add exporter template support.
5. Add tests for metadata, compiler output, and generated files.

## Runtime Changes

Preserve `VFXEffect<TParams>`. Dispose all geometries, materials, textures, buffers, and renderer resources. Clamp deltas and avoid unbounded allocations.

## Exporter Changes

Exporter input is Effect IR, not React state. Generated code must not import React, builder modules, or private local code. Keep output deterministic.

## GPU/WebGPU Rules

Keep WebGPU handles out of core. Feature detection belongs in runtime. Document fallback behavior. Avoid allocating large GPU resources by default.

## Pitfalls

- React Flow handles are UI details; do not store them outside graph ports.
- Parameter nodes mirror graph parameters; update both when editing defaults.
- A valid preview is not proof that export is valid; run compiler/exporter tests.
- Do not copy Byrsa source into this repo.

## Final Checklist

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
