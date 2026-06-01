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

The default graph is the Wispy Smoke preset. It is built from generic fluid nodes: sphere or box emitters, curl/fBm fields, buoyancy/wind/vortex forces, optional sphere or box obstacles, a 3D fluid solver, a volume renderer, source glow, and debug view. Use the node palette or right-click the canvas to add nodes. Drag between compatible ports to connect nodes. Drag from a port into empty canvas space to open a filtered node menu. Use the Auto layout toolbar button to rearrange nodes into ranked, non-overlapping lanes. Node configuration lives in grouped parameter panels on each node. When the canvas is focused, `Ctrl` + `F` or `Cmd` + `F` opens canvas find for fuzzy node and parameter search; matching nodes are highlighted, matching groups expand, Enter and the arrow buttons jump between results, the `X` clears the term, and `Esc` dismisses the search box. Unlinked value inputs can be edited inline; linked value inputs show the upstream source button instead. Reusable primitive parameter nodes such as `parameter.float`, `parameter.color`, and `parameter.quality` carry custom labels and values when you want a value to drive one or more inputs. The right rail is reserved for preview, graph diagnostics, and export.

Parameter changes update the preview live from the current graph state. While hovering the preview, middle-drag orbits, `Shift` + middle-drag pans, and the scroll wheel zooms within clamped limits. On macOS, `Option` + left-drag orbits, `Option` + `Cmd` + left-drag pans, and `Option` + `Control` + left-drag zooms. Use the preview maximize button for a larger modal view; `Esc` restores it. The editor starts from the configured startup preset by default, the New Project button opens the Wispy Smoke template for a clean graph reset, toolbar save/load uses browser local storage explicitly, and graph JSON can also be imported or downloaded. Flip `STARTUP_GRAPH_CONFIG.source` in `apps/builder/src/App.tsx` to hydrate from the saved local graph during development.

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
  spawnRate: 1350,
  lifetime: 8.2,
  radius: 0.38,
  height: 7.4,
  density: 0.9,
  baseDensity: 1.85,
  opacity: 0.86,
  riseSpeed: 1.85,
  buoyantLift: 2.8,
  turbulence: 5,
  curlStrength: 7.2,
  vorticityConfinement: 12.5,
  wind: [0, 0, 0],
  sourceVelocity: [0, 0.72, 0],
  vortexStrength: 0,
  pressureIterations: 16,
  diffusion: 0,
  diffusionIterations: 0,
  advectionMode: "maccormack",
  sourceTemperature: 1.1,
  plumeTaper: 0.12,
  emissionColor: "#b8bcc0",
  emissionIntensity: 0,
  absorption: 10.8,
  scattering: 2.15,
  detailScale: 18,
  detailStrength: 3.8,
  detailSpeed: 0.45,
  detailOctaves: 4,
  flowWarpStrength: 1.05,
  lightDirection: [0.35, 0.85, 0.25],
  phaseAnisotropy: 0.32,
  sourceGlowEnabled: false,
  sourceGlowColor: "#ffaa66",
  sourceGlowIntensity: 0,
  sourceGlowRadius: 1.15,
  blendMode: "normal",
  renderStepScale: 1.1,
  shadowQuality: 8,
  shadowStrength: 1.65,
  debugView: "final",
  color: "#b8bcc0",
});

scene.add(smoke.object3D);

function frame(deltaSeconds: number, elapsedSeconds: number) {
  smoke.update(deltaSeconds, elapsedSeconds);
}
```

The exported class depends on `three` and, for the quality path, Three's `three/webgpu`, `three/tsl`, and raymarching example helper modules. Pass a `THREE.WebGPURenderer` with `backendMode: "auto"` or `"webgpu"` to run the Eulerian solver; the effect logs a one-time warning if it falls back to the compatibility particle path. The builder preview uses AgX tone mapping. It does not depend on React, the builder app, or ThreeFX workspace packages.

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

- The high-quality smoke backend requires a WebGPU renderer. It runs a cubic Eulerian grid (`32^3` through `96^3`) with TSL compute passes for source injection, semi-Lagrangian or MacCormack advection, optional diffusion, gradient-driven buoyancy/wind, curl and vorticity confinement, obstacle masking, divergence, Jacobi pressure solve, projection, and render-volume packing. Rendering raymarches simulated density/temperature with absorption, phase-biased scattering, flow-warped procedural detail, multi-tap self-shadow sampling, soft top/bottom fades, and debug views. The compatibility backend is intentionally lower fidelity.
- The graph compiler currently targets the Wispy Smoke vertical slice only.
- Exported code is TypeScript source, not an npm package artifact yet.
- Visual regression and deeper GPU performance benchmarks are planned but not implemented.

## Contributing

Use pnpm, keep core graph logic independent from React, and run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` before opening a PR. See `CONTRIBUTING.md`, `architecture.md`, and `AGENTS.md`.
