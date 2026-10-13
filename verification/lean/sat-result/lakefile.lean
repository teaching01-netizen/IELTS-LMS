import Lake
open Lake DSL

package satResult where
  version := v!"0.1.0"

@[default_target]
lean_lib SatResult where
  roots := #[`SatResult, `Model, `Safety, `Counterexamples, `AxiomAudit]
