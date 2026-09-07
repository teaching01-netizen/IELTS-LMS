# Performance Budgets

CI-enforced today: entry compressed JS must fit 500 KiB (see quality-gates > Analyze Bundle Size in .github/workflows/ci.yml). Measure the initial route, not total build output.

## Measurement conditions (required for every reported number)

- Production build only; named IELTS + SAT fixtures incl. long writing responses, rich passages, diagrams, math, large question sets.
- Defined devices, browsers, network conditions, cohort size; cold entry and warm entry reported separately.
- Browser traces alongside React profiling; input rendering, local persistence, network transit, and server acknowledgement timed separately.
- Another developer can reproduce the measurement under these documented conditions.

## Budgets (proposed project values except Web Vitals guidance; calibrate against the T0.2 baseline)

| Metric                           | Initial target           | Scope                          |
| -------------------------------- | ------------------------ | ------------------------------ |
| LCP                              | <=2.5s                   | field p75, segmented by device |
| INP                              | <=200ms                  | field p75, segmented by device |
| CLS                              | <=0.1                    | field p75                      |
| Writing input-to-next-paint      | p95 <=100ms              | defined device + fixture       |
| Cached question navigation       | p95 <=150ms              | assets already available       |
| Answer-to-server acknowledgement | p95 <=2s                 | healthy network at agreed load |
| Timer-triggered question renders | zero unnecessary renders | React profiling                |
| Incorrect saved indications      | zero                     | failure-injection scenarios    |
| Lost acknowledged answers        | zero                     | correctness scenarios          |
