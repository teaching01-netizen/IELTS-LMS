import Lake
open Lake DSL

package satModule1Gate where
  version := v!"0.1.0"

@[default_target]
lean_lib SatModule1Gate where
  srcDir := "proof"
  roots := #[`SatModule1Gate, `Model, `Safety, `Counterexamples, `AxiomAudit]
