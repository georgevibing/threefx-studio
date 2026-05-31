# ThreeFX Studio

ThreeFX Studio is a browser-based procedural VFX builder for Three.js projects targeting the WebGPU era. The goal is a clean web-first authoring workflow: edit a live effect graph, preview it in the browser, then export small typed TypeScript source files that can be dropped into another Three.js project.

The current MVP is a vertical slice around one effect, `WispySmokeVFX`. It includes a typed node graph, node-local parameter editing, WebGPU-first live preview with compatibility fallback, graph JSON save/load, and TypeScript export.

## Why WebGPU

Long-term ThreeFX effects need compute-style simulation, storage buffers, explicit GPU limits, and predictable performance tiers. Those are WebGPU-shaped requirements. The current smoke runtime selects a WebGPU Eulerian fluid-grid path when the renderer supports it, while keeping a conservative Three.js compatibility path for browsers and integrations without WebGPU.

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

Parameter changes update the preview immediately. While hovering the preview, middle-drag orbits, `Shift` + middle-drag pans, and the scroll wheel zooms within clamped limits. On macOS, `Option` + left-drag orbits, `Option` + `Cmd` + left-drag pans, and `Option` + `Control` + left-drag zooms. Use the preview maximize button for a larger modal view; `Esc` restores it. Save/load uses browser local storage, and graph JSON can also be imported or downloaded.

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
  backendMode: "auto",
  quality: "high",
  gridResolution: "high",
  worldPosition: [0, 0, 0],
  spawnRate: 118,
  lifetime: 3.8,
  radius: 0.32,
  height: 5.1,
  turbulence: 0.38,
  density: 1.04,
  baseDensity: 1.12,
  pressureIterations: 18,
  diffusion: 0.018,
  sourceTemperature: 1.28,
  emissionColor: "#ff7a2f",
  emissionIntensity: 1.1,
  absorption: 1.35,
  scattering: 0.68,
  detailScale: 3.6,
  detailStrength: 0.46,
  detailSpeed: 0.28,
  opacity: 0.74,
  renderStepScale: 0.42,
  shadowQuality: 8,
  color: "#c6cfd2",
});

scene.add(smoke.object3D);

function frame(deltaSeconds: number, elapsedSeconds: number) {
  smoke.update(deltaSeconds, elapsedSeconds);
}
```

The exported class depends on `three` and, for the quality path, Three's `three/webgpu`, `three/tsl`, and raymarching example helper modules. It does not depend on React, the builder app, or ThreeFX workspace packages.

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

- The high-quality smoke backend requires a WebGPU renderer. It runs a low-resolution cubic Eulerian grid (`32^3` through `96^3`) with TSL compute passes for density/velocity advection, source injection, buoyancy/wind, vorticity confinement, pressure projection, dissipation, and render-volume packing, then raymarches the simulated density with absorption, scattering, source glow, self-shadow sampling, and procedural detail. The compatibility backend is intentionally lower fidelity.
- The graph compiler currently targets the Wispy Smoke vertical slice only.
- Exported code is TypeScript source, not an npm package artifact yet.
- Visual regression and deeper GPU performance benchmarks are planned but not implemented.

## Contributing

Use pnpm, keep core graph logic independent from React, and run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` before opening a PR. See `CONTRIBUTING.md`, `architecture.md`, and `AGENTS.md`.
