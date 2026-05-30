# ThreeFX Studio

ThreeFX Studio is a browser-based procedural VFX builder for Three.js projects targeting the WebGPU era. The goal is a clean web-first authoring workflow: edit a live effect graph, preview it in the browser, then export small typed TypeScript source files that can be dropped into another Three.js project.

The current MVP is a vertical slice around one effect, `WispySmokeVFX`. It includes a typed node graph, node-local parameter editing, live preview, graph JSON save/load, and TypeScript export.

## Why WebGPU

Long-term ThreeFX effects need compute-style simulation, storage buffers, explicit GPU limits, and predictable performance tiers. Those are WebGPU-shaped requirements. The MVP runtime deliberately uses a conservative Three.js particle/impostor path so it works today while keeping the package boundaries ready for a WebGPU/TSL backend.

## Install

```bash
pnpm install
```

## Run

```bash
pnpm dev
```

Open the Vite URL printed by pnpm. The builder app lives in `apps/builder`.

## Edit Wispy Smoke

The default graph is the Wispy Smoke preset. Use the node palette or right-click the canvas to add nodes. Drag between compatible ports to connect nodes. Drag from a port into empty canvas space to open a filtered node menu. Use the Auto layout toolbar button to rearrange nodes into ranked, non-overlapping lanes. Node configuration lives in grouped parameter panels on each node; the right rail is reserved for preview, graph diagnostics, and export.

Parameter changes update the preview immediately. Save/load uses browser local storage, and graph JSON can also be imported or downloaded.

## Port Types

Ports are directional and typed. Exact matches are accepted, `int` can feed `float`, `float` and `int` can feed `curve`, inputs can declare `acceptedTypes`, and single-input ports reject additional edges unless `multiple: true` is set. See `PORT_TYPES.md` for the full type reference and output compatibility rules.

## Export

The Export panel compiles the validated graph to Effect IR and generates:

- `WispySmokeVFX.ts`
- `usage.ts`
- `README.md`
- `threefx-export.json`

Use the copy buttons for the class or integration snippet, or download the zip.

## Use Exported Code

```ts
import { WispySmokeVFX } from "./WispySmokeVFX";

const smoke = new WispySmokeVFX({
  renderer,
  quality: "high",
  worldPosition: [0, 0, 0],
  spawnRate: 96,
  lifetime: 2.4,
  turbulence: 0.35,
  density: 0.8,
  color: "#b9c7cf",
});

scene.add(smoke.object3D);

function frame(deltaSeconds: number, elapsedSeconds: number) {
  smoke.update(deltaSeconds, elapsedSeconds);
}
```

The exported class depends on `three`, not React or the builder app.

## Package Structure

- `apps/builder`: Vite React app with React Flow canvas, inspector, preview, and export panel.
- `packages/core`: graph schema, node registry, typed ports, validation, serialization, Effect IR compiler.
- `packages/runtime`: shared VFX lifecycle interfaces, quality profiles, feature detection, disposal helpers.
- `packages/effects`: built-in effect implementations and parameter metadata, starting with Wispy Smoke.
- `packages/exporter`: Effect IR to standalone TypeScript source, usage snippets, README snippets, and zip generation.
- `packages/ui`: shared editor tone/style helpers.
- `packages/config`: placeholder for shared config as the repo grows.

## Commands

```bash
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm format
```

## Current Limitations

- The MVP runtime is a robust CPU-driven particle-volume impostor, not a full WebGPU grid solver.
- The graph compiler currently targets the Wispy Smoke vertical slice only.
- Exported code is TypeScript source, not an npm package artifact yet.
- Visual regression and GPU performance benchmarks are planned but not implemented.

## Contributing

Use pnpm, keep core graph logic independent from React, and run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` before opening a PR. See `CONTRIBUTING.md`, `architecture.md`, and `AGENTS.md`.
