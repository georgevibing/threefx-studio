# Contributing

Thanks for contributing to ThreeFX Studio. Use pnpm for all package operations.

## Workflow

1. Install dependencies with `pnpm install`.
2. Run the builder with `pnpm dev`.
3. Keep changes scoped to the package that owns the behavior.
4. Add tests for graph, compiler, exporter, or runtime behavior changes.
5. Run validation before submitting:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Boundaries

Core graph logic must not depend on React, React Flow, Three.js renderer handles, or app code. Runtime/effects may depend on Three.js. Exporter consumes Effect IR and generates standalone source.

## Style

Use strict TypeScript, explicit public types, deterministic output, and concise comments only where they clarify non-obvious logic.
