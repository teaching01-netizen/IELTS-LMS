import Lake
open Lake DSL

package satStaffRecoveryRouting where
  version := v!"0.1.0"

lean_lib SatStaffRecoveryRouting where
  roots := #[`SatStaffRecoveryRouting, `Model, `Safety, `Counterexamples, `AxiomAudit]
