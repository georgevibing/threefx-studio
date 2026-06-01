# Contributing

Thanks for contributing to ThreeFX Studio. Use pnpm for all package operations and route changes through pull requests.

## Workflow

1. Create a branch from the latest `main`. Do not push directly to `main`.
2. Install dependencies with `pnpm install`.
3. Run the builder with `pnpm dev`.
4. Keep changes scoped to the package that owns the behavior.
5. Add tests for graph, compiler, exporter, runtime, or generated-code behavior changes.
6. Run validation before submitting:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Pull Requests

- Open pull requests against `main` and fill out the PR template.
- Keep PRs focused. Separate refactors from behavior changes when practical.
- Include screenshots or recordings for visible builder UI changes.
- Update `README.md` for user-facing workflow changes and `architecture.md` for package or pipeline changes.
- Follow `STYLEGUIDE.md` before changing visual styling, graph nodes, controls, or editor layout.
- Do not commit generated clutter, local planning files, build output, or large binary assets.

## Issues

Use the GitHub issue templates for bugs and feature requests. Include enough reproduction detail for builder, graph, compiler, exporter, or runtime issues to be validated locally.

## Boundaries

Core graph logic must not depend on React, React Flow, Three.js renderer handles, or app code. Runtime/effects may depend on Three.js. Exporter consumes Effect IR and generates standalone source.

## Style

Use strict TypeScript, explicit public types, deterministic output, and concise comments only where they clarify non-obvious logic.
