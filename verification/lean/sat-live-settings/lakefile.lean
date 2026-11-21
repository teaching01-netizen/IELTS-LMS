import Lake
open Lake DSL

package satLiveSettings where
  version := v!"0.1.0"

lean_lib SatLiveSettings where
  srcDir := "proof"
  roots := #[`Model, `Safety, `Counterexamples, `AxiomAudit]
