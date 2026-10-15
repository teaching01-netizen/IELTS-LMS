import Lake
open Lake DSL
package satSessionContinuity where
  version := v!"0.1.0"
@[default_target]
lean_lib SatSessionContinuity where
  srcDir := "proof"
  roots := #[`Model, `Continuity, `Counterexamples, `Retention, `SatSessionContinuity]
