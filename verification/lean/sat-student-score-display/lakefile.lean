import Lake
open Lake DSL

package satStudentScoreDisplay where
  version := v!"0.1.0"

@[default_target]
lean_lib SatStudentScoreDisplay where
  roots := #[`SatStudentScoreDisplay, `proof.Model, `proof.Safety, `proof.Counterexamples, `proof.AxiomAudit]
