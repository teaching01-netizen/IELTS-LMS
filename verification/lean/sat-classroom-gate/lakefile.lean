import Lake
open Lake DSL

package satClassroomGate where
  version := v!"0.1.0"

lean_lib SatClassroomGate where
  srcDir := "proof"
  roots := #[`SatClassroomGate, `Model, `Safety, `Counterexamples, `AxiomAudit]
