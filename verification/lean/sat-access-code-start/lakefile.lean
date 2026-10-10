import Lake
open Lake DSL

package satAccessCodeStart where
  version := v!"0.1.0"

lean_lib SatAccessCodeStart where
  roots := #[`SatAccessCodeStart, `OperationalModel, `OperationalSafety, `Counterexamples, `AxiomAudit]
