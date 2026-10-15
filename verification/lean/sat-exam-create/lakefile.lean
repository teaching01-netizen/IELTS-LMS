import Lake
open Lake DSL

package satExamCreate where
  version := v!"0.1.0"

lean_lib SatExamCreate where
  srcDir := "proof"
  roots := #[`SatExamCreate, `Model, `Safety, `Counterexamples, `AxiomAudit]
