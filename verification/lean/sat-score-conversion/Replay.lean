import Lean
open Lean

/-! Independent re-check (R-9), in place of lean4checker (whose build was not
permitted): lean4checker's default mode, written against core `Lean.Replay`.
For each module, import only its direct imports from their `.olean`s, then
send every constant the module itself declares through the kernel again
(`Lean.Environment.replay`). `Init` is trusted from its `.olean`s, as in
lean4checker without `--fresh`. Replay admits `axiom` declarations, so any
safe ones declared in our modules are listed (the compiler's unsafe
auxiliaries cannot appear in a safe proof term); AxiomAudit.lean audits what theorems use.

Run: `lake env lean --run Replay.lean Model Safety Counterexamples` -/

def check (m : Name) : IO Unit := do
  let env ← importModules #[{ module := m }] {}
  let some idx := env.getModuleIdx? m | throw <| IO.userError s!"{m} not loaded"
  let deps ← importModules env.header.moduleData[idx.toNat]!.imports {}
  let own := env.constants.toList.filter fun (n, _) => env.getModuleIdxFor? n == some idx
  let checked ← deps.replay (Std.HashMap.ofList own)
  let axioms := own.filterMap fun (n, ci) => if ci matches .axiomInfo _ && !ci.isUnsafe then some n else none
  let missing := own.filter fun (n, _) => !(checked.contains n)
  let thms := own.filter fun (_, ci) => ci matches .thmInfo _
  let safe := missing.filter fun (_, ci) => !ci.isUnsafe && !ci.isPartial
  unless safe.isEmpty do throw <| IO.userError s!"{m}: not replayed: {safe.map (·.1)}"
  IO.println s!"{m}: kernel re-checked {own.length - missing.length}/{own.length} constants, including all {thms.length} theorems; skipped {missing.length} unsafe/partial compiler auxiliaries; safe axioms declared: {axioms}"

/-- The checker is not vacuous: a forged `theorem forged : False := True.intro`
    must be rejected by the same replay. -/
def selfTest : IO Unit := do
  let deps ← importModules #[{ module := `Init }] {}
  let forged := ConstantInfo.thmInfo
    { name := `forged, levelParams := [], type := mkConst ``False, value := mkConst ``True.intro }
  match ← (deps.replay (Std.HashMap.ofList [(`forged, forged)])).toBaseIO with
  | .ok _ => throw <| IO.userError "self-test: a forged proof of False was accepted"
  | .error e => IO.println s!"self-test: forged proof of False rejected ({e})"

def main (args : List String) : IO UInt32 := do
  initSearchPath (← findSysroot)
  selfTest
  for m in args do check m.toName
  return 0
