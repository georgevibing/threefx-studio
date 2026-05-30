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
- Do not use blue as a primary UI color for general chrome.
- Do not use purple, teal, or saturated accent themes for editor chrome.
- Keep semantic color rare. Destructive/error states may use the theme destructive token.
- Graph nodes, menus, panels, buttons, and inspector controls should remain neutral.
- The selected node/edge affordance is the Byrsa-inspired dashed dashboard-blue treatment.
- Ports may use small type-color accents on knobs and swatches only; do not expand those colors into node fills or editor chrome.

## Surface Rules

- Use flat fills and thin borders.
- Do not use gradients on nodes, panels, app backgrounds, or buttons.
- Do not add decorative glows, blobs, bokeh, or ornamental backgrounds.
- Keep border radius at `8px` or less unless a native control requires otherwise.
- Prefer subtle one-pixel borders over heavy shadows.

## Node Graph Rules

- Nodes use a single flat surface color.
- Selected nodes use a dashed dashboard-blue border treatment.
- Selected edges use the same dashboard-blue stroke and dash treatment as selected nodes.
- Ports sit halfway outside the node border and use type-colored borders; connected ports fill with the same type color.
- Type information should come from labels, typed tooltips, docs, and small port color accents.
- Configuration should live on the node that owns it. Use grouped node-local parameter panels with expand-all and collapse-all controls rather than exposing editor configuration in the right sidebar.
- Provide an Auto layout toolbar action for restoring a readable ranked graph without manual dragging.

## Layout Rules

- Prioritize dense, scannable tool surfaces.
- Avoid landing-page composition inside the app.
- Keep the graph canvas central, with the node palette on the left and preview/diagnostics/export on the right.
- Text must fit within nodes, buttons, and panels without overlap.

## Interaction Rules

- Icon buttons should have tooltips or clear accessible labels.
- Hover states may change neutral surface or border values.
- Focus states should use the neutral ring token.
- Avoid animation unless it directly improves interaction feedback.

## CSS Rules

- Put reusable theme values in CSS variables.
- Use flat colors from `--background`, `--card`, `--popover`, `--secondary`, `--border`, `--muted-foreground`, and `--foreground`.
- Do not hard-code accent colors in component CSS when they belong in shared type or theme tokens.
- Keep broad app chrome neutral; selection blue and port type colors are the intentional graph exceptions.
