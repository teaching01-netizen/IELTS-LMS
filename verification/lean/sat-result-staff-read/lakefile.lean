import Lake
open Lake DSL

package satResultStaffRead where
  version := v!"0.1.0"

@[default_target]
lean_lib SatResultStaffRead where
  roots := #[`SatResultStaffRead]
