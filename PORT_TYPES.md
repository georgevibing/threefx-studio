# ThreeFX Port Types

Ports are directional and typed. Outputs can connect only to compatible inputs, and the same compatibility rules are used by the React Flow UI, graph validation, and export compiler.

## Compatibility Rules

- Exact type matches are accepted.
- `any` is a wildcard source or target.
- `int` outputs may feed `float` inputs.
- `float` and `int` outputs may feed `curve` inputs.
- Inputs may declare `acceptedTypes` to allow extra source types.
- Inputs accept one edge unless `multiple: true` is set.
- Outputs may fan out when `multiple: true` is set.
- Dragging from an input or output port to empty canvas opens a filtered add-node menu containing only nodes with a compatible opposite port.

## Primitive Parameter Nodes

Parameter nodes are reusable primitive value sources. Their labels are authoring labels and can be customized per graph node. The exported Wispy Smoke API still uses the fixed parameter keys from effect metadata.

Each primitive parameter node exposes a single `value` output with the matching port type:

| Node Type           | Output Port Type |
| ------------------- | ---------------- |
| `parameter.bool`    | `bool`           |
| `parameter.color`   | `color`          |
| `parameter.curve`   | `curve`          |
| `parameter.float`   | `float`          |
| `parameter.int`     | `int`            |
| `parameter.quality` | `quality`        |
| `parameter.string`  | `string`         |
| `parameter.vec2`    | `vec2`           |
| `parameter.vec3`    | `vec3`           |

Editable input ports declare value metadata directly on the `PortDefinition`, including defaults, grouping, descriptions, min/max/step, units, options, and optional `effectParameterId`. If an editable input is unlinked, the builder shows its inline control on the owning node. If it is linked, the inline control is hidden and the input shows a clickable upstream source label.

## Type Reference

| Type         | Used For                                                                 | Accepts                 |
| ------------ | ------------------------------------------------------------------------ | ----------------------- |
| `flow`       | Execution or ordering links between graph stages                         | `flow`                  |
| `float`      | Scalar numeric parameters such as spawn rate, opacity, density, or speed | `float`, `int`          |
| `int`        | Integer parameters such as seeds or counts                               | `int`                   |
| `bool`       | Toggle parameters                                                        | `bool`                  |
| `string`     | Text or enum-like string values                                          | `string`                |
| `color`      | Color parameters                                                         | `color`                 |
| `vec2`       | Two-component vectors                                                    | `vec2`                  |
| `vec3`       | Three-component vectors such as wind or world position                   | `vec3`                  |
| `curve`      | Curve/value-over-time inputs                                             | `curve`, `float`, `int` |
| `quality`    | Runtime quality preset values                                            | `quality`               |
| `emitter`    | Emitter objects produced by emitter nodes                                | `emitter`               |
| `force`      | Force objects produced by force nodes                                    | `force`                 |
| `field`      | Field/noise objects produced by field nodes                              | `field`                 |
| `obstacle`   | Collision or mask objects consumed by fluid solver nodes                 | `obstacle`              |
| `simulation` | Simulation outputs consumed by render nodes                              | `simulation`            |
| `volume`     | Volume resources or volume data                                          | `volume`                |
| `transform`  | Object transform data                                                    | `transform`             |
| `render`     | Render-stage output consumed by composite or final output nodes          | `render`                |
| `effect`     | Complete effect output, reserved for future multi-effect composition     | `effect`                |
| `any`        | Escape hatch for intentionally generic nodes                             | Any type                |

## Visual Coding

Port knobs use type-colored borders and connected fills. Node surfaces, panels, menus, and graph chrome remain neutral. Selection uses the Byrsa-inspired dashed blue treatment for both nodes and edges.
