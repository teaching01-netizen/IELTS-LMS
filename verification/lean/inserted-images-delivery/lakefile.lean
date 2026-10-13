import Lake
open Lake DSL

package insertedImagesDelivery where
  version := v!"0.1.0"

lean_lib InsertedImagesDelivery where
  roots := #[`InsertedImagesDelivery, `Model, `Safety, `Counterexamples, `AxiomAudit]
