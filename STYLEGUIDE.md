# ThreeFX Studio Style Guide

## Visual Direction

ThreeFX Studio uses a Vercel-inspired monochrome dark interface. The UI should feel like a serious authoring tool: quiet, dense, flat, and precise.

## Theme Source

Use the TweakCN Vercel theme as the source for design tokens:

```bash
pnpm dlx shadcn@latest add https://tweakcn.com/r/themes/vercel.json
```

This repository is a pnpm monorepo. When applying shadcn tooling to the builder app, target `apps/builder` explicitly:

```bash
pnpm dlx shadcn@latest add https://tweakcn.com/r/themes/vercel.json -c apps/builder
```

The current app uses plain CSS variables rather than Tailwind utility classes, so theme values are mirrored in `apps/builder/src/styles.css`.

## Color Rules

- Prefer black, white, and neutral gray surfaces.
- Do not use blue as a primary UI color.
- Do not use purple, teal, or saturated accent themes for editor chrome.
- Keep semantic color rare. Destructive/error states may use the theme destructive token.
- Graph nodes, edges, ports, menus, panels, buttons, and inspector controls should remain neutral.

## Surface Rules

- Use flat fills and thin borders.
- Do not use gradients on nodes, panels, app backgrounds, or buttons.
- Do not add decorative glows, blobs, bokeh, or ornamental backgrounds.
- Keep border radius at `8px` or less unless a native control requires otherwise.
- Prefer subtle one-pixel borders over heavy shadows.

## Node Graph Rules

- Nodes use a single flat surface color.
- Selected nodes use a white border/outline, not a colored glow.
- Ports are neutral gray by default and white when connected.
- Edges are neutral gray by default and white when selected.
- Type information should come from labels and structure, not color coding.

## Layout Rules

- Prioritize dense, scannable tool surfaces.
- Avoid landing-page composition inside the app.
- Keep the graph canvas central, with the node palette on the left and preview/inspector/export on the right.
- Text must fit within nodes, buttons, and panels without overlap.

## Interaction Rules

- Icon buttons should have tooltips or clear accessible labels.
- Hover states may change neutral surface or border values.
- Focus states should use the neutral ring token.
- Avoid animation unless it directly improves interaction feedback.

## CSS Rules

- Put reusable theme values in CSS variables.
- Use flat colors from `--background`, `--card`, `--popover`, `--secondary`, `--border`, `--muted-foreground`, and `--foreground`.
- Do not hard-code blue/teal/purple accents in app CSS.
- When adding shared UI tokens, keep `packages/ui` neutral unless a feature explicitly needs semantic color.
