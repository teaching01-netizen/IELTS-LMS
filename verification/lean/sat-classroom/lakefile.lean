import Lake
open Lake DSL

package satClassroom where
  version := v!"0.1.0"

lean_lib SatClassroom where
  srcDir := "proof"
  roots := #[`SatClassroom, `Model, `Safety, `Counterexamples, `AxiomAudit]
