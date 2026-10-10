# SAT Import Workbook Verification

This project verifies a finite abstract contract for the generated SAT authoring workbook and records tests that bind that model to the current Go generator and parser.

Toolchain: Lean 4.19.0, pinned in lean-toolchain. No external Lake packages are used.

From this directory, run:

    lake build SatImportTemplate
    lake env lean AxiomAudit.lean

WorkbookModel.lean defines the contract and concrete accepted/rejected fixtures. ContractProofs.lean proves the structural and fixture claims. Counterexamples.lean proves several minimal invalid cases. AxiomAudit.lean prints exact theorem types and transitive axiom dependencies.

The proof is about those Lean definitions. The generated XLSX and Go parser are connected by Excelize integration tests, not a mechanized refinement proof. See SPEC.md, TRACEABILITY.md, ASSUMPTIONS.md, and PROOF_REPORT.md.
