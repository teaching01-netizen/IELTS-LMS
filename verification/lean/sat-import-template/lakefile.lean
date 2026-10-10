import Lake
open Lake DSL

package satImportTemplate where
  version := v!"0.1.0"

lean_lib SatImportTemplate where
  roots := #[`SatImportTemplate, `WorkbookModel, `ContractProofs, `Counterexamples, `AxiomAudit]
