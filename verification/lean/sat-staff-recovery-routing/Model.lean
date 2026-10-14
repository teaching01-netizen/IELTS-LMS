import Lean

/-!
# SAT staff recovery routing — operational model

Three behaviours shipped together on the SAT staff authoring surface:

1. `Routing` — `resolvePublishIssueDestination`: every publish finding maps to
   exactly one destination (question, module, score policy) or to an explicit
   `unresolved` with a reason. Formerly only `examQuestion:` paths had a
   destination, so a "Fix" press on a module or converter finding closed the
   review and went nowhere.
2. `DeepLink` — the `?module=<section>.<module>` deep link is an INPUT to the
   authoring selection, consumed exactly once (`useAuthoringSelection`).
3. `Pinning` — the room setup flow captures one published version when setup
   opens and keeps it for the whole form, while the overview query keeps
   polling and another author may publish (`SatNewSessionFlow`).

## Character layer

The paths, section keys and module keys are ASCII slugs. The model works on
`Chars = List Char` and re-implements the three string primitives the
TypeScript uses (`startsWith`, `splitOn`, `trim`). `toChars` is the boundary:
it is `String.toList`, so the model's input IS the real path's character
sequence — no assumption is needed there. The primitives below are
transcriptions of the primitive *behaviour*, reviewed against the source, and
are deliberately transparent so the kernel can reduce concrete witnesses.

`String` itself is not used for the decision logic because the pinned core's
`String` operations are `@[extern]`-backed and do not reduce in the kernel.
-/

namespace SatStaffRecoveryRouting

/-! ## 1. Shared character primitives -/

abbrev Chars := List Char

/-- Boundary: the model's input is the real path's character sequence. -/
def toChars (s : String) : Chars := s.toList

/-- `[a-z0-9]`, written as a code-point test so the kernel can evaluate it. -/
def lowerDigit (c : Char) : Bool :=
  (97 ≤ c.val && c.val ≤ 122) || (48 ≤ c.val && c.val ≤ 57)

def allChars (p : Char → Bool) : Chars → Bool
  | [] => true
  | c :: cs => p c && allChars p cs

/-- `[a-z0-9][a-z0-9<extra>]*` — the shared shape of both regex segments. -/
def slug (extra : Char → Bool) (s : Chars) : Bool :=
  match s with
  | [] => false
  | c :: cs => lowerDigit c && allChars (fun x => lowerDigit x || extra x) cs

/-- First regex segment: `[a-z0-9][a-z0-9-]*` (a SAT section key). -/
def sectionSlug (s : Chars) : Bool := slug (fun c => c = '-') s

/-- Second regex segment: `[a-z0-9][a-z0-9_-]*` (a module key or role). -/
def moduleSlug (s : Chars) : Bool := slug (fun c => c = '-' || c = '_') s

/-- TypeScript `s.startsWith prefix`. -/
def hasPrefix : Chars → Chars → Bool
  | [], _ => true
  | _ :: _, [] => false
  | p :: ps, x :: xs => (p = x) && hasPrefix ps xs

/-- TypeScript `s.splitOn sep`, as a left-to-right split. -/
def splitOnChar (sep : Char) : Chars → List Chars
  | [] => [[]]
  | x :: xs =>
    match splitOnChar sep xs with
    | [] => if x = sep then [[]] else [[x]]
    | seg :: rest => if x = sep then [] :: seg :: rest else (x :: seg) :: rest

def isSpaceCh (c : Char) : Bool :=
  c = ' ' || c = '\t' || c = '\n' || c = '\r'

def dropSpaceLeft : Chars → Chars
  | [] => []
  | c :: cs => if isSpaceCh c then dropSpaceLeft cs else c :: cs

/-- TypeScript `s.trim()`. The real trim also strips Unicode whitespace; every
path in scope is an ASCII slug or an `examQuestion:` link, so the ASCII set is
exhaustive for this surface (recorded as an assumption). -/
def trimChars (s : Chars) : Chars :=
  (dropSpaceLeft s.reverse).reverse

/-- Rebuilds the segments after the id, so a field may itself contain `:`. -/
def intercalateChars (sep : Char) : List Chars → Chars
  | [] => []
  | [s] => s
  | s :: rest => s ++ sep :: intercalateChars sep rest

/-! ## 2. `Routing` — publish finding → destination -/

/-- The marker the module-path regex requires in the FIRST segment. A bare
question path (`answer.options`) reaches this branch unprefixed, which is why
the section check — not the regex — is what prevents a misroute. -/
def examQuestionWord : Chars :=
  ['e','x','a','m','Q','u','e','s','t','i','o','n']

def examQuestionPrefix : Chars := examQuestionWord ++ [':']

def scoringPolicyKey : Chars :=
  ['s','c','o','r','i','n','g','P','o','l','i','c','y']

/-- The SAT section keys, `ACCESS_LINK_SECTION_KEYS`. -/
def readingWriting : Chars :=
  ['r','e','a','d','i','n','g','-','w','r','i','t','i','n','g']

def mathSection : Chars := ['m','a','t','h']

def satSectionKeys : List Chars := [readingWriting, mathSection]

/-! ### Concrete keys, paths and shells evaluated by the kernel

Written as explicit character lists (not `toChars "..."`) so the kernel can
reduce witnesses: see ASSUMPTIONS.md A6 for the resulting review obligation. -/

def rwM1 : Chars := ['r','w','-','m','1']
def rwM2Higher : Chars := ['r','w','-','m','2','-','h','i','g','h','e','r']
def rwM2Lower : Chars := ['r','w','-','m','2','-','l','o','w','e','r']
def mathM1 : Chars := ['m','a','t','h','-','m','1']
def mathM2Higher : Chars := ['m','a','t','h','-','m','2','-','h','i','g','h','e','r']
def mathM2Lower : Chars := ['m','a','t','h','-','m','2','-','l','o','w','e','r']

def qId : Chars := ['q','-','1']
def fldPrompt : Chars := ['p','r','o','m','p','t']

/-- `reading-writing.rw-m1` — the finding a module count blocker carries. -/
def pathModuleRW : Chars := readingWriting ++ ['.'] ++ rwM1

/-- `math.math-m2-higher` — a module this draft does not contain. -/
def pathModuleMissing : Chars := mathSection ++ ['.'] ++ ['m','o','d','u','l','e']

/-- `answer.options` — a leaked field path that the module regex DOES match
(two slug-shaped segments), so only the section check can reject it. -/
def pathLeakedField : Chars := ['a','n','s','w','e','r','.'] ++ ['o','p','t','i','o','n','s']

def pathScoringPolicy : Chars := scoringPolicyKey
def pathScoringPolicySub : Chars := scoringPolicyKey ++ ['.'] ++ ['c','o','n','v','e','r','t']

/-- `examQuestion:q-1:prompt`. -/
def pathQuestionLink : Chars := examQuestionPrefix ++ qId ++ [':'] ++ fldPrompt

/-- `examQuestion:<id>:<field>` — absent/blank pieces become `none`, mirroring
`parseIssueLink`, which never yields an empty `?question=` target. -/
def parseQuestion (p : Chars) : Option (Chars × Option Chars) :=
  match splitOnChar ':' p with
  | head :: id :: rest =>
      if head = examQuestionWord then
        let id := trimChars id
        if id = [] then none
        else
          let f := trimChars (intercalateChars ':' rest)
          some (id, if f = [] then none else some f)
      else none
  | _ => none

/-- `<sectionKey>.<moduleKey>` or `<sectionKey>.<role>`: exactly two segments,
both slug-shaped. -/
def moduleParts (p : Chars) : Option (Chars × Chars) :=
  match splitOnChar '.' p with
  | [sec, mod] => if sectionSlug sec && moduleSlug mod then some (sec, mod) else none
  | _ => none

/-- The parts of the loaded shell the resolver reads. -/
structure Shell where
  sections : List (Chars × List Chars)
  deriving DecidableEq, Repr

def anyTrue : List Bool → Bool
  | [] => false
  | b :: bs => b || anyTrue bs

def containsKey (ks : List Chars) (k : Chars) : Bool :=
  match ks with
  | [] => false
  | x :: xs => if x = k then true else containsKey xs k

def findModules (sec : Chars) : List (Chars × List Chars) → Option (List Chars)
  | [] => none
  | (k, ms) :: rest => if k = sec then some ms else findModules sec rest

/-- A shell maps modules when at least one section carries a module. A shell
that carries none is an incomplete map, not evidence of a missing module. -/
def shellMapsModules (sh : Shell) : Bool :=
  anyTrue (sh.sections.map (fun s => match s.2 with | [] => false | _ => true))

/-- `shellContainsModule`: the named section first, then — only when that
section is absent — any section (this fallback is in the source). -/
def shellContainsModule (sh : Shell) (sec mod : Chars) : Bool :=
  match findModules sec sh.sections with
  | some mods => containsKey mods mod
  | none => anyTrue (sh.sections.map (fun s => containsKey s.2 mod))

/-- The first segment is a section when the loaded shell says so, and otherwise
only when the SAT section contract says so. -/
def knownSection (sh : Option Shell) (sec : Chars) : Bool :=
  match sh with
  | some s => containsKey (s.sections.map Prod.fst) sec
  | none => containsKey satSectionKeys sec

/-- A shell that maps modules and does not contain the named module. -/
def shellDeniesModule (sh : Option Shell) (sec mod : Chars) : Bool :=
  match sh with
  | none => false
  | some s => shellMapsModules s && !shellContainsModule s sec mod

/-- A loaded, fully mapped authoring shell: the shape every caller passes. -/
def fullShell : Shell :=
  ⟨[(readingWriting, [rwM1, rwM2Higher, rwM2Lower]),
    (mathSection, [mathM1, mathM2Higher, mathM2Lower])]⟩

/-- A shell that carries sections but no modules: the incomplete map whose
absence of evidence must not be read as evidence of absence. -/
def modulelessShell : Shell :=
  ⟨[(readingWriting, []), (mathSection, [])]⟩

/-- The authoritative publication state belongs to the backend; this operation
either reads a projection or is refused explicitly. -/
inductive Destination where
  | question (id : Chars) (field : Option Chars)
  | module (sectionKey moduleKey : Chars)
  | scorePolicy
  | unresolved (reason : String)
  deriving DecidableEq, Repr

def unresolvedUnlinked : String := "not-linked"
def unresolvedModuleMissing : String := "module-missing"

/-- `resolvePublishIssueDestination`. Branch order and guards mirror the source:
the `examQuestion:` prefix, then the scoring-policy keys, then the two-segment
module path gated on `knownSection` and `shellDeniesModule`. -/
def resolve (p : Chars) (sh : Option Shell) : Destination :=
  if hasPrefix examQuestionPrefix p = true then
    match parseQuestion p with
    | some (id, f) => .question id f
    | none => .unresolved unresolvedUnlinked
  else if p = scoringPolicyKey ∨ hasPrefix (scoringPolicyKey ++ ['.']) p = true then
    .scorePolicy
  else
    match moduleParts p with
    | some (sec, mod) =>
        if knownSection sh sec = true then
          if shellDeniesModule sh sec mod = true then
            .unresolved unresolvedModuleMissing
          else .module sec mod
        else .unresolved unresolvedUnlinked
    | none => .unresolved unresolvedUnlinked

/-- `publishIssueDestinationLabel`: null exactly when there is nothing to open. -/
def destinationLabel : Destination → Option String
  | .question _ _ => some "Open question"
  | .module _ _ => some "Open module"
  | .scorePolicy => some "Open score settings"
  | .unresolved _ => none

/-- The builder deep link a module destination navigates to. -/
def moduleDeepLink (d : Destination) : Option Chars :=
  match d with
  | .module sec mod => some (sec ++ ['.'] ++ mod)
  | _ => none

/-! ## 3. `DeepLink` — one consumption of `?module=` -/

structure ShellModule where
  id : Nat
  sectionKey : Chars
  moduleKey : Chars
  questions : List Nat
  deriving DecidableEq, Repr

abbrev ModuleShell := List ShellModule

structure Editor where
  /-- The pending `?module=` parameter, as the URL carries it. -/
  pendingModuleLink : Option Chars
  selModule : Option Nat
  selQuestion : Option Nat
  /-- Ghost history: `?module=` parameters injected by navigation. -/
  linkInjected : Nat
  /-- Ghost history: links actually adopted into the selection. -/
  linkAdopted : Nat
  deriving DecidableEq, Repr

def firstModule (sh : ModuleShell) : Option ShellModule := sh.head?

def moduleById (sh : ModuleShell) (id : Nat) : Option ShellModule :=
  match sh with
  | [] => none
  | m :: ms => if m.id = id then some m else moduleById ms id

def moduleInSection (sh : ModuleShell) (sec mod : Chars) : Option ShellModule :=
  match sh with
  | [] => none
  | m :: ms =>
    if m.sectionKey = sec && m.moduleKey = mod then some m else moduleInSection ms sec mod

def moduleByKey (sh : ModuleShell) (mod : Chars) : Option ShellModule :=
  match sh with
  | [] => none
  | m :: ms => if m.moduleKey = mod then some m else moduleByKey ms mod

/-- The hook's lookup: the `<section>.<module>` pair first, then any module with
that key, and nothing at all for a malformed link. -/
def moduleForKey (sh : ModuleShell) (raw : Chars) : Option ShellModule :=
  match splitOnChar '.' raw with
  | [sec, mod] =>
      (match moduleInSection sh sec mod with
       | some m => some m
       | none => moduleByKey sh mod)
  | _ => none

def selectionExists (sh : ModuleShell) (sel : Option Nat) : Bool :=
  match sel with
  | none => false
  | some id => (moduleById sh id).isSome

/-- The selection rule that keeps a deleted (or replaced) module from leaving
the editor pointing at a row that no longer exists. -/
def fallback (sh : ModuleShell) (e : Editor) : Editor :=
  if selectionExists sh e.selModule then e
  else
    let f := firstModule sh
    { e with selModule := f.map ShellModule.id,
             selQuestion := f.bind (fun m => m.questions.head?) }

/-- One execution of the deep-link effect: a pending link is ALWAYS stripped,
found or not, so a stale link cannot re-fire on every render; a link that names
a module this shell does not contain is consumed without adopting. -/
def consume (sh : ModuleShell) (e : Editor) : Editor :=
  match e.pendingModuleLink with
  | none => fallback sh e
  | some raw =>
      let e1 := { e with pendingModuleLink := none }
      match moduleForKey sh raw with
      | none => fallback sh e1
      | some m =>
          { e1 with selModule := some m.id,
                    selQuestion := m.questions.head?,
                    linkAdopted := e1.linkAdopted + 1 }

/-- A "Fix" press on a module finding navigates, which injects the parameter. -/
def inject (raw : Chars) (e : Editor) : Editor :=
  { e with pendingModuleLink := some raw, linkInjected := e.linkInjected + 1 }

/-- A pending link weighs one. An injected link is either still pending or has
already been adopted, and it can never be both. -/
def pendingWeight (e : Editor) : Nat :=
  match e.pendingModuleLink with
  | none => 0
  | some _ => 1

/-- The accounting invariant behind at-most-once adoption: every navigation is
either still pending or already adopted. Weaker invariants over the raw counts
are not inductive, because injecting over a pending link discards it. -/
def AdoptionAccount (e : Editor) : Prop := e.linkAdopted + pendingWeight e ≤ e.linkInjected

/-- The selection is usable AND stable: it names a module of this shell, or
this shell has no module to select and none is selected. Deliberately silent
about the pending link, so a settle is not disturbed by a URL change. -/
def Settled (sh : ModuleShell) (e : Editor) : Prop :=
  selectionExists sh e.selModule = true ∨
    (firstModule sh = none ∧ e.selModule = none ∧ e.selQuestion = none)

/-- A shell the flow can actually select in, and an example authoring shell for
the deep-link traces. Module 2 is deliberately NOT the first module, so
"opened the first module" is distinguishable from "opened the named module". -/
def studentShell : ModuleShell :=
  [⟨1, readingWriting, rwM1, [11, 12]⟩,
   ⟨2, readingWriting, rwM2Higher, [21]⟩,
   ⟨3, mathSection, mathM1, [31]⟩]

def emptyEditor : Editor :=
  ⟨none, none, none, 0, 0⟩

/-- The link the resolver's `module` destination produces for
`reading-writing.rw-m2-higher`. -/
def linkRW2Higher : Chars := readingWriting ++ ['.'] ++ rwM2Higher

inductive EditorAction where
  | injectLink (raw : Chars)
  | consumeLink
  deriving DecidableEq, Repr

def editorStep (sh : ModuleShell) : Editor → EditorAction → Editor
  | e, .injectLink raw => inject raw e
  | e, .consumeLink => consume sh e

def editorInit (e : Editor) : Prop :=
  e.linkInjected = 0 ∧ e.linkAdopted = 0 ∧ e.pendingModuleLink = none

inductive EditorReach (sh : ModuleShell) : Editor → Prop
  | init {e : Editor} (h : editorInit e) : EditorReach sh e
  | step {e : Editor} (a : EditorAction) : EditorReach sh e → EditorReach sh (editorStep sh e a)

/-! ## 4. `Pinning` — one published target per setup flow -/

structure Version where
  id : Nat
  number : Nat
  deriving DecidableEq, Repr

structure Room where
  /-- The latest overview snapshot; it moves forward when anyone publishes. -/
  observed : Option Version
  /-- The version this setup flow will send. -/
  target : Option Version
  /-- The `publishedVersionId` actually sent. -/
  sent : Option Version
  /-- Ghost history: the first version ever observed in this flow. -/
  firstObserved : Option Version
  deriving DecidableEq, Repr

/-- A poll answer, or another author publishing and a later poll seeing it. -/
def observe (v : Version) (r : Room) : Room :=
  { r with observed := some v,
           firstObserved := match r.firstObserved with | some w => some w | none => some v }

/-- The mount effect: capture the current published version, once. The guard is
the whole point — a later snapshot can never re-point the target. -/
def freeze (r : Room) : Room :=
  match r.target with
  | some _ => r
  | none => match r.observed with
            | some v => { r with target := some v }
            | none => r

/-- `create` sends the pinned target, whatever the overview now reports. -/
def createRoom (r : Room) : Room := { r with sent := r.target }

/-- A new flow is a fresh component instance: no pin, and the then-current
publication is captured again by the next `freeze`. -/
def reopen (r : Room) : Room := { r with target := none, sent := none }

inductive RoomAction where
  | observeSnapshot (v : Version)
  | captureTarget
  | create
  | reopenFlow
  deriving DecidableEq, Repr

def roomStep : Room → RoomAction → Room
  | r, .observeSnapshot v => observe v r
  | r, .captureTarget => freeze r
  | r, .create => createRoom r
  | r, .reopenFlow => reopen r

def roomInit (r : Room) : Prop :=
  r.observed = none ∧ r.target = none ∧ r.sent = none ∧ r.firstObserved = none

inductive RoomReach : Room → Prop
  | init {r : Room} (h : roomInit r) : RoomReach r
  | step {r : Room} (a : RoomAction) : RoomReach r → RoomReach (roomStep r a)

end SatStaffRecoveryRouting
