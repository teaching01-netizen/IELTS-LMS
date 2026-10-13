import Lake
open Lake DSL

package satSingleModuleImport where
  version := v!"0.1.0"

@[default_target]
lean_lib SatSingleModuleImport where
  roots := #[`SatSingleModuleImport, `Model, `Safety, `Counterexamples, `Refinement, `AxiomAudit]
