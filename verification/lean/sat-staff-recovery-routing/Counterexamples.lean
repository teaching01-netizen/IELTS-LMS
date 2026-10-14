import Safety

/-!
# Refutations of the legacy and tempting-wrong alternatives

Each definition below is a small, executable transcription of a policy the
shipped code replaced (or deliberately avoided). The theorems are finite traces
and kernel-evaluated contrasts: they show the alternative produces the specific
bad outcome the shipped policy prevents, on the real paths.

These are not claims about the old application; they are the shapes this change
was written against.
-/

namespace SatStaffRecoveryRouting

namespace Counterexamples

/-! ## 1. Routing alternatives -/

/-- The legacy handler: only `examQuestion:<id>:<field>` had a destination, and
everything else fell off the end. -/
def resolveLegacy (p : Chars) : Option Destination :=
  if hasPrefix examQuestionPrefix p = true then
    match parseQuestion p with
    | some (id, f) => some (.question id f)
    | none => none
  else none

/-- Routing by the module regex alone, without the section check. The regex
accepts any two slug-shaped segments, so a leaked field path qualifies. -/
def resolveRegexOnly (p : Chars) : Destination :=
  match moduleParts p with
  | some (sec, mod) => .module sec mod
  | none => .unresolved unresolvedUnlinked

/-- Treating a module finding as "open the draft's first module", which is what
a click that cannot fix the finding looks like. -/
def firstModuleDestination (sh : Shell) : Destination :=
  match sh.sections with
  | (k, m :: _) :: _ => .module k m
  | _ => .unresolved unresolvedModuleMissing

def resolveFirstModule (p : Chars) (sh : Shell) : Destination :=
  match moduleParts p with
  | some _ => firstModuleDestination sh
  | none => .unresolved unresolvedUnlinked

/-- Refusing any module the loaded shell does not contain, without the
"a shell that maps no modules is an incomplete map" escape. -/
def resolveRefusingUnmapped (p : Chars) (sh : Shell) : Destination :=
  match moduleParts p with
  | some (sec, mod) =>
      if shellContainsModule sh sec mod then .module sec mod
      else .unresolved unresolvedModuleMissing
  | none => .unresolved unresolvedUnlinked

/-- The three-segment field path the module regex matches: `answer.options`. -/
def answerWord : Chars := ['a','n','s','w','e','r']
def optionsWord : Chars := ['o','p','t','i','o','n','s']

theorem legacy_handler_dead_ends_on_a_module_finding :
    resolveLegacy pathModuleRW = none ∧
    resolve pathModuleRW (some fullShell) = .module readingWriting rwM1 := by decide

theorem routing_by_regex_alone_misroutes_a_field_path :
    resolveRegexOnly pathLeakedField = .module answerWord optionsWord ∧
    resolve pathLeakedField (some fullShell) = .unresolved unresolvedUnlinked := by decide

theorem guessing_the_first_module_misroutes :
    resolveFirstModule pathModuleMissing fullShell = .module readingWriting rwM1 ∧
    resolve pathModuleMissing (some fullShell) = .unresolved unresolvedModuleMissing := by
  decide

theorem refusing_unmapped_modules_dead_ends :
    resolveRefusingUnmapped pathModuleRW modulelessShell =
      .unresolved unresolvedModuleMissing ∧
    resolve pathModuleRW (some modulelessShell) = .module readingWriting rwM1 := by decide

/-! ## 2. Deep-link alternative -/

/-- Consuming the parameter but ignoring what it names: the author lands on the
draft's first module instead of the finding's module. -/
def consumeIgnoringTheLink (sh : ModuleShell) (e : Editor) : Editor :=
  match e.pendingModuleLink with
  | none => fallback sh e
  | some _ => fallback sh { e with pendingModuleLink := none }

theorem ignoring_the_link_opens_the_first_module_instead :
    (consumeIgnoringTheLink studentShell (inject linkRW2Higher emptyEditor)).selModule = some 1 ∧
    (consume studentShell (inject linkRW2Higher emptyEditor)).selModule = some 2 := by decide

/-! ## 3. Pinning alternative -/

def v1 : Version := ⟨1, 3⟩
def v2 : Version := ⟨2, 4⟩

def emptyRoom : Room := ⟨none, none, none, none⟩

/-- Reading the target straight off every overview snapshot: the pre-change
behaviour, where the form re-derived its version from the polling query. -/
def freezeEverySnapshot (r : Room) : Room :=
  match r.observed with
  | some v => { r with target := some v }
  | none => r

inductive LegacyRoomAction where
  | snapshot (v : Version)
  | capture
  | create
  deriving DecidableEq, Repr

def legacyRoomStep : Room → LegacyRoomAction → Room
  | r, .snapshot v => freezeEverySnapshot (observe v r)
  | r, .capture => freezeEverySnapshot r
  | r, .create => createRoom r

/-- One flow: the first published version is seen, a room is configured, another
author publishes, and only then is the room created. -/
def republishTrace : List RoomAction :=
  [.observeSnapshot v1, .captureTarget, .observeSnapshot v2, .create]

def legacyRepublishTrace : List LegacyRoomAction :=
  [.snapshot v1, .capture, .snapshot v2, .create]

def runRoom (initial : Room) (trace : List RoomAction) : Room := trace.foldl roomStep initial

def runLegacyRoom (initial : Room) (trace : List LegacyRoomAction) : Room :=
  trace.foldl legacyRoomStep initial

theorem the_shipped_pin_survives_a_republish :
    (runRoom emptyRoom republishTrace).target = some v1 ∧
    (runRoom emptyRoom republishTrace).sent = some v1 := by decide

theorem recomputing_the_target_from_every_poll_moves_the_pin :
    (runLegacyRoom emptyRoom legacyRepublishTrace).target = some v2 ∧
    (runLegacyRoom emptyRoom legacyRepublishTrace).sent = some v2 := by decide

/-! ## 4. The model admits the hazardous interleavings

Non-vacuity: the reachability relations are not empty, and they contain the
exact interleavings the policies above are about. -/

theorem editor_link_trace_is_reachable :
    EditorReach studentShell (consume studentShell (inject linkRW2Higher emptyEditor)) :=
  EditorReach.step EditorAction.consumeLink
    (EditorReach.step (EditorAction.injectLink linkRW2Higher)
      (EditorReach.init ⟨rfl, rfl, rfl⟩))

theorem room_republish_trace_is_reachable :
    RoomReach (runRoom emptyRoom republishTrace) :=
  RoomReach.step RoomAction.create
    (RoomReach.step (RoomAction.observeSnapshot v2)
      (RoomReach.step RoomAction.captureTarget
        (RoomReach.step (RoomAction.observeSnapshot v1)
          (RoomReach.init ⟨rfl, rfl, rfl, rfl⟩))))

/-- A reachable state can still be mid-edit: seeing the second publication did
not move the pin. -/
theorem reachable_republish_state_keeps_the_first_version :
    (observe v2 (freeze (observe v1 emptyRoom))).target = some v1 := by decide

/-- The executable trace, so the build log carries the states rather than only
the theorem statements. -/
#eval (runRoom emptyRoom republishTrace, runLegacyRoom emptyRoom legacyRepublishTrace)

end Counterexamples

end SatStaffRecoveryRouting
