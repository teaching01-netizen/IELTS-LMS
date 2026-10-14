import Lake
open Lake DSL

package satScoreConversion where
  version := v!"0.1.0"

@[default_target]
lean_lib SatScoreConversion where
  roots := #[`SatScoreConversion, `Model, `Safety, `Counterexamples, `AxiomAudit]
