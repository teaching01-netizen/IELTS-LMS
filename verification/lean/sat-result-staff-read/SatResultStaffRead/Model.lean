import Std

/-!
# SAT staff result read model

This model covers pure output decisions in `results.ListSATAttempts` and
`results.satSectionsFromModules`. It does not model mutations, pagination
snapshot isolation, or the Go/SQL runtime semantics.
-/

namespace SatResultStaffRead

def signedInt64Max : Int := 9223372036854775807

structure RawSummary where
  correct : Int
  total : Int
  deriving Repr, DecidableEq

def RawSummary.valid (raw : RawSummary) : Bool :=
  decide (0 ≤ raw.correct ∧ raw.correct ≤ signedInt64Max ∧
    0 < raw.total ∧ raw.total ≤ signedInt64Max ∧ raw.correct ≤ raw.total)

inductive JSONCount where
  | integerToken (value : Int)
  | integralDecimalToken (value : Int)
  | missing
  deriving Repr, DecidableEq

/-- The JSON boundary accepts integer tokens representable by the Go API's
    signed 64-bit fields, then checks score bounds. -/
def parseRawSummary (correct total : JSONCount) : Option RawSummary :=
  match correct, total with
  | .integerToken correctValue, .integerToken totalValue =>
      let raw : RawSummary := ⟨correctValue, totalValue⟩
      if raw.valid then some raw else none
  | _, _ => none

def rawSummaryValid : Option RawSummary → Bool
  | some raw => raw.valid
  | none => false

inductive Outcome where
  | scored
  | other
  deriving Repr, DecidableEq, BEq

structure AttemptRow where
  resultExists : Bool
  outcome : Outcome
  hasLegacyScore : Bool
  classroomRaw : Option RawSummary
  deriving Repr, DecidableEq

/-- Equivalent decision boundary for the staff score filter: legacy scores or
    an integral, positive raw count with correct ≤ total are available. -/
def scoreAvailable (row : AttemptRow) : Bool :=
  row.resultExists && row.outcome == .scored &&
    (row.hasLegacyScore || rawSummaryValid row.classroomRaw)

/-- SQL's unavailable branch, written independently so complement bugs surface. -/
def scoreUnavailable (row : AttemptRow) : Bool :=
  !row.resultExists || !(row.outcome == .scored) ||
    (!row.hasLegacyScore && !rawSummaryValid row.classroomRaw)

structure ScoreRange where
  low : Int
  high : Int
  deriving Repr, DecidableEq

/-- The Go list parser's accepted 400–1600 range and ordering checks. -/
def ScoreRange.valid (score : ScoreRange) : Bool :=
  decide (400 ≤ score.low ∧ score.low ≤ score.high ∧ score.high ≤ 1600)

def normalizeEstimate : Option ScoreRange → Option ScoreRange
  | none => none
  | some score => if score.valid then some score else none

inductive PolicyRead where
  | failed
  | noActiveRevision
  | activeRevision (estimate : Option ScoreRange)
  deriving Repr, DecidableEq

/-- Estimate returned for a row with a renderable classroom raw summary.
    An unreadable active policy clears persisted conversion fields, matching
    the detail overlay's raw-only degradation; no active policy preserves the
    sealed conversion; an active policy replaces it. -/
def estimateAfterRead (rawSummaryIsValid : Bool) (stored : Option ScoreRange)
    (policy : PolicyRead) : Option ScoreRange :=
  if !rawSummaryIsValid then none else
    match policy with
    | .failed => none
    | .noActiveRevision => normalizeEstimate stored
    | .activeRevision estimate => normalizeEstimate estimate

inductive BranchRoute where
  | higher
  | lower
  deriving Repr, DecidableEq, BEq

inductive AdaptiveRole where
  | base
  | higherBranch
  | lowerBranch
  | other
  deriving Repr, DecidableEq

structure ModuleRow where
  sectionKey : String
  moduleKey : String
  role : AdaptiveRole
  rawCorrect : Int
  operational : Int
  deriving Repr, DecidableEq

def routeOfRole : AdaptiveRole → Option BranchRoute
  | .higherBranch => some .higher
  | .lowerBranch => some .lower
  | _ => none

/-- Report a route only when every administered branch row agrees. -/
def consistentRoute : List BranchRoute → Option BranchRoute
  | [] => none
  | first :: rest =>
      if rest.all (· == first) then some first else none

def sectionRoute (rows : List ModuleRow) : Option BranchRoute :=
  consistentRoute (rows.filterMap fun row => routeOfRole row.role)

/-- Stable filtering preserves administered module order within a section. -/
def rowsForSection (rows : List ModuleRow) (key : String) : List ModuleRow :=
  rows.filter fun row => decide (row.sectionKey = key)

def ModuleRow.scoreValid (row : ModuleRow) : Bool :=
  decide (0 ≤ row.rawCorrect ∧ row.rawCorrect ≤ signedInt64Max ∧
    0 < row.operational ∧ row.operational ≤ signedInt64Max ∧
    row.rawCorrect ≤ row.operational)

def sumCorrect (rows : List ModuleRow) : Int :=
  rows.foldl (fun total row => total + row.rawCorrect) 0

def sumOperational (rows : List ModuleRow) : Int :=
  rows.foldl (fun total row => total + row.operational) 0

structure SectionSummary where
  sectionKey : String
  moduleKeys : List String
  rawCorrect : Int
  operational : Int
  route : Option BranchRoute
  deriving Repr, DecidableEq

def summarizeSection (key : String) (rows : List ModuleRow) : SectionSummary :=
  let included := rowsForSection rows key
  { sectionKey := key
    moduleKeys := included.map ModuleRow.moduleKey
    rawCorrect := sumCorrect included
    operational := sumOperational included
    route := sectionRoute included }

/-- Section order is the order of first appearance in the module query. -/
def firstSeenKeys : List ModuleRow → List String
  | [] => []
  | row :: rest =>
      row.sectionKey :: (firstSeenKeys rest).filter (fun key => !(key == row.sectionKey))

def sectionSumsFit (rows : List ModuleRow) : Bool :=
  (firstSeenKeys rows).all fun key =>
    let included := rowsForSection rows key
    let correct := sumCorrect included
    let operational := sumOperational included
    decide (0 ≤ correct ∧ correct ≤ signedInt64Max ∧
      0 ≤ operational ∧ operational ≤ signedInt64Max)

def synthesizeSections (rows : List ModuleRow) : List SectionSummary :=
  if rows.all ModuleRow.scoreValid && sectionSumsFit rows then
    (firstSeenKeys rows).map fun key => summarizeSection key rows
  else []

/-- Choice labels are generated from option position. SAT publish validation
    requires exactly four choices and unique option IDs. -/
def optionLetter (index : Nat) : String :=
  String.singleton (Char.ofNat (65 + index))

def labelOptions (index : Nat) : List String → List (String × String)
  | [] => []
  | id :: rest => (id, optionLetter index) :: labelOptions (index + 1) rest

end SatResultStaffRead
