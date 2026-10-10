# Recommendations

1. Keep the explicit cell-type regression test. It found that Guide and AI Instructions column-B cells were serialized as numbers because the shared writer treated every column-B cell as a question order. The writer now marks only Questions column B as numeric; all simple-sheet cells remain inline text.
2. Keep the Go test that round-trips every generated taxonomy entry through the parser. The generator, importer, and Lean model hold duplicated taxonomy data and can drift.
3. Before release, perform the desktop viewer and endpoint-authorization checks listed in PRODUCTION_TEST_PLAN.md. Those are the main remaining external observations.
4. Treat the prompt as guidance to an external AI. Require staff to compare the completed workbook with its sources and answer key; do not use structural preview validity as evidence of transcription accuracy.
5. If the workbook contract changes often, consider a shared machine-readable source for the Lean fixture and Go assertions. The current proof has no mechanically checked refinement link.
