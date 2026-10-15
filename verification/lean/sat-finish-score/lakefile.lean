import Lake
open Lake DSL
package satFinishScore where
  version := v!"0.1.0"
@[default_target]
lean_lib SatFinishScore where
  srcDir := "proof"
  roots := #[`Model, `Safety, `Counterexamples, `SatFinishScore]
