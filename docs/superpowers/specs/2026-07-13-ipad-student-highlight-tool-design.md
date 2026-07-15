# iPad-First Student Highlight Tool Design

Reading and Listening use a persistent header split control with `off`, `highlight`, and `erase` modes. The main button toggles the last chosen highlight color; the adjacent disclosure exposes the existing five named colors and Erase. Native 44px buttons, visible focus, pressed/expanded state, and a polite status announcement provide accessible state beyond color alone.

`StudentUIProvider` owns session-local mode and last color. Highlight surfaces continue to own persisted ranges and source-hash invalidation. A completed valid selection triggers the active command automatically, clears selection after success, and leaves the mode active. Tool-off selections are untouched. Existing surface containment, answer-control exclusions, range normalization, 200-range cap, and persistence schema remain unchanged.

The tool resets outside an active, unblocked Reading/Listening context and during submission. The cursor-following toolbar and its coordinates/sticky selection behavior are removed.
