import Lake
open Lake DSL

package satPostPublish where
  version := v!"0.1.0"

lean_lib SatPostPublish where
  roots := #[`SatPostPublish, `Model, `Safety, `Liveness, `Traces, `Counterexamples, `Provenance, `AxiomAudit]
