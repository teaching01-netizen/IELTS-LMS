/-
  Operational (shape) model of the IELTS question-pane frame for one question
  block, focused on the slot an inserted image occupies.

  What this models: the child sequence `StudentQuestionBlockSection` produces
  for a block, the row-selection and source-resolution behaviour of
  `StudentInsertedImages` / `getImageUrlCandidates`, and the DOM keys handed to
  React. What this does NOT model: React reconciliation, the DOM, CSS, layout,
  network fetching, browser caching, the backend, or `img` load failure. Those
  are recorded as correspondence and production obligations, not as proof.
-/

namespace InsertedImages

/-- Placement slots of the block frame, in DOM child order. -/
inductive Slot where
  | instruction
  | images
  | content
  deriving DecidableEq, Repr

/-- Where an authoring URL points, after `getImageUrlCandidates` parsing.
    `blank` and `unsafe` are exactly the rejected classes: a blank/whitespace
    URL and a `javascript:`/`vbscript:`/`data:text/html` scheme. -/
inductive UrlKind where
  | blank
  | unsafeScheme
  | drive (fileId : String)
  | plain (raw : String)
  deriving DecidableEq, Repr

/-- One row of a block's `insertedImages` array. -/
structure Row where
  id : String
  url : UrlKind
  caption : String
  deriving DecidableEq, Repr

/-- Block types relevant to inserted images: the two the editor excludes and a
    catch-all for every type that accepts them. -/
inductive BlockType where
  | shortAnswer
  | tfng
  | map
  | diagramLabeling
  | other (name : String)
  deriving DecidableEq, Repr

/-- A question block as far as this property is concerned. `contentCount` is
    how many question-content children the block contributes, whichever of the
    three rendering branches produced them. -/
structure Block where
  id : String
  blockType : BlockType
  instruction : String
  rows : List Row
  contentCount : Nat
  deriving Repr

/-- `getImageUrlCandidates`'s observable outcome: a rejected URL yields no
    candidate at all, a Drive share link yields the four Drive forms, and any
    other URL yields itself. The four Drive strings mirror the implementation
    literal-for-literal. -/
def candidatesOf : UrlKind → List String
  | .blank => []
  | .unsafeScheme => []
  | .drive id =>
      [ s!"https://drive.google.com/thumbnail?id={id}&sz=w2000",
        s!"https://lh3.googleusercontent.com/d/{id}=s2000",
        s!"https://drive.google.com/uc?export=view&id={id}",
        s!"https://drive.usercontent.google.com/download?id={id}&export=view" ]
  | .plain raw => [raw]

/-- The row-level predicate `resolveInsertedImageRows` filters on: a row
    survives iff its candidate list is non-empty. -/
def hasSources (r : Row) : Bool :=
  match candidatesOf r.url with
  | [] => false
  | _ :: _ => true

/-- `resolveInsertedImageRows`: rows with at least one candidate survive. -/
def loadableRows (b : Block) : List Row :=
  b.rows.filter hasSources

/-- `supportsInsertedImages`: map and diagram-labeling blocks are excluded. -/
def supportsInsertedImages (b : Block) : Bool :=
  match b.blockType with
  | .map => false
  | .diagramLabeling => false
  | _ => true

/-- `StudentInsertedImages` mounts exactly one container carrying every image,
    and only when at least one row is loadable. -/
def imagesSlots (b : Block) : List Slot :=
  if supportsInsertedImages b && loadableRows b ≠ [] then [Slot.images] else []

/-- One `Slot.content` per question-content child. -/
def contentSlots (b : Block) : List Slot := List.replicate b.contentCount Slot.content

/-- The delivered frame before the fix: instruction, then question content. -/
def legacySlots (b : Block) : List Slot := [Slot.instruction] ++ contentSlots b

/-- The delivered frame after the fix: instruction, inserted images, then
    question content. -/
def frameSlots (b : Block) : List Slot :=
  [Slot.instruction] ++ imagesSlots b ++ contentSlots b

/-- A resolved image source, tagged with the row it came from so provenance can
    be stated without reasoning about URL strings. -/
structure Source where
  origin : String
  text : String
  deriving DecidableEq, Repr

/-- The sources one loadable row contributes. -/
def renderedSourcesFor (r : Row) : List Source :=
  (candidatesOf r.url).map (fun s => ⟨r.id, s⟩)

/-- Every source the block renders, in authoring order. -/
def renderedSources (b : Block) : List Source :=
  (loadableRows b).flatMap renderedSourcesFor

/-- The key material handed to React for each rendered image: the authored id
    plus the row's position, so a payload that repeats an id still yields
    pairwise-distinct keys. -/
def imageKeys (b : Block) : List (Nat × String) :=
  (List.range (loadableRows b).length).map
    (fun i => (i, Option.getD (Option.map Row.id (loadableRows b)[i]?) ""))

end InsertedImages
