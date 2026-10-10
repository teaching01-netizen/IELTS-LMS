import Std

namespace SATImportTemplate

inductive Sheet where
  | questions
  | guide
  | assets
  | aiInstructions
  | metadata
  deriving DecidableEq, BEq, Repr

def sheetOrder : List Sheet :=
  [.questions, .guide, .assets, .aiInstructions, .metadata]

def hiddenSheets : List Sheet := [.metadata]
def activeSheetIndex : Nat := 3
def activeSheet : Option Sheet := sheetOrder[activeSheetIndex]?
def templateVersion : Nat := 2

def headers : List String :=
  [ "Module", "Order", "Prompt", "Stimulus", "Response Type", "A", "B", "C", "D"
  , "Correct", "Accepted Responses", "Domain", "Skill", "Difficulty", "Pretest"
  , "Rationale", "Tags"
  ]

inductive Section where
  | readingWriting
  | math
  deriving DecidableEq, BEq, Repr

structure ModuleSpec where
  key : String
  label : String
  subject : Section
  count : Nat
  deriving DecidableEq, Repr

def moduleSpecs : List ModuleSpec :=
  [ ⟨"rw-m1", "Reading & Writing · Module 1", .readingWriting, 27⟩
  , ⟨"rw-m2-lower", "Reading & Writing · Module 2 — Lower", .readingWriting, 27⟩
  , ⟨"rw-m2-higher", "Reading & Writing · Module 2 — Higher", .readingWriting, 27⟩
  , ⟨"math-m1", "Math · Module 1", .math, 22⟩
  , ⟨"math-m2-lower", "Math · Module 2 — Lower", .math, 22⟩
  , ⟨"math-m2-higher", "Math · Module 2 — Higher", .math, 22⟩
  ]

def moduleCounts : List Nat := moduleSpecs.map ModuleSpec.count
def questionSlotCount : Nat := moduleSpecs.foldl (fun n m => n + m.count) 0
def questionRowCountIncludingHeader : Nat := questionSlotCount + 1

structure TaxonomyEntry where
  subject : Section
  domain : String
  skill : String
  deriving DecidableEq, Repr

def taxonomy : List TaxonomyEntry :=
  [ ⟨.readingWriting, "Information and Ideas", "Central Ideas and Details"⟩
  , ⟨.readingWriting, "Information and Ideas", "Command of Evidence — Textual"⟩
  , ⟨.readingWriting, "Information and Ideas", "Command of Evidence — Quantitative"⟩
  , ⟨.readingWriting, "Information and Ideas", "Inferences"⟩
  , ⟨.readingWriting, "Craft and Structure", "Words in Context"⟩
  , ⟨.readingWriting, "Craft and Structure", "Text Structure and Purpose"⟩
  , ⟨.readingWriting, "Craft and Structure", "Cross-Text Connections"⟩
  , ⟨.readingWriting, "Expression of Ideas", "Rhetorical Synthesis"⟩
  , ⟨.readingWriting, "Expression of Ideas", "Transitions"⟩
  , ⟨.readingWriting, "Standard English Conventions", "Boundaries"⟩
  , ⟨.readingWriting, "Standard English Conventions", "Form, Structure, and Sense"⟩
  , ⟨.math, "Algebra", "Linear Equations in One Variable"⟩
  , ⟨.math, "Algebra", "Linear Functions"⟩
  , ⟨.math, "Algebra", "Linear Equations in Two Variables"⟩
  , ⟨.math, "Algebra", "Systems of Two Linear Equations"⟩
  , ⟨.math, "Algebra", "Linear Inequalities"⟩
  , ⟨.math, "Advanced Math", "Equivalent Expressions"⟩
  , ⟨.math, "Advanced Math", "Nonlinear Equations in One Variable"⟩
  , ⟨.math, "Advanced Math", "Systems of Equations in Two Variables"⟩
  , ⟨.math, "Advanced Math", "Nonlinear Functions"⟩
  , ⟨.math, "Problem-Solving and Data Analysis", "Ratios, Rates, Proportional Relationships, and Units"⟩
  , ⟨.math, "Problem-Solving and Data Analysis", "Percentages"⟩
  , ⟨.math, "Problem-Solving and Data Analysis", "One-Variable Data"⟩
  , ⟨.math, "Problem-Solving and Data Analysis", "Two-Variable Data"⟩
  , ⟨.math, "Problem-Solving and Data Analysis", "Probability and Conditional Probability"⟩
  , ⟨.math, "Problem-Solving and Data Analysis", "Inference from Sample Statistics and Margin of Error"⟩
  , ⟨.math, "Problem-Solving and Data Analysis", "Evaluating Statistical Claims"⟩
  , ⟨.math, "Geometry and Trigonometry", "Area and Volume"⟩
  , ⟨.math, "Geometry and Trigonometry", "Lines, Angles, and Triangles"⟩
  , ⟨.math, "Geometry and Trigonometry", "Right Triangles and Trigonometry"⟩
  , ⟨.math, "Geometry and Trigonometry", "Circles"⟩
  ]

def taxonomySkillCount : Nat := taxonomy.length
def taxonomyRangeFormula : String := "_SAT!$D$1:$D$31"

inductive ValidationSource where
  | inlineList
  | taxonomyRange
  deriving DecidableEq, Repr

structure ValidationSpec where
  sqref : String
  source : ValidationSource
  deriving DecidableEq, Repr

def validations : List ValidationSpec :=
  [ ⟨"A2:A148", .inlineList⟩
  , ⟨"E2:E148", .inlineList⟩
  , ⟨"J2:J148", .inlineList⟩
  , ⟨"L2:L148", .inlineList⟩
  , ⟨"M2:M148", .taxonomyRange⟩
  , ⟨"N2:N148", .inlineList⟩
  , ⟨"O2:O148", .inlineList⟩
  ]

inductive CellKind where
  | inlineText
  | number
  | formula
  | picture
  deriving DecidableEq, BEq, Repr

structure Cell where
  value : String
  kind : CellKind
  deriving DecidableEq, Repr

def encodeTextCell (value : String) : Cell :=
  ⟨value, .inlineText⟩

def encodeRowCell (column row numericColumn : Nat) : CellKind :=
  if numericColumn != 0 && column == numericColumn && decide (1 < row) then
    .number
  else
    .inlineText

inductive ResponseType where
  | multipleChoice
  | studentResponse
  deriving DecidableEq, BEq, Repr

structure Question where
  moduleKey : String
  order : Nat
  prompt : String
  responseType : ResponseType
  choiceA : String
  choiceB : String
  choiceC : String
  choiceD : String
  correct : String
  acceptedResponses : String
  domain : String
  skill : String
  difficulty : String
  isPretest : Bool
  deriving DecidableEq, Repr

def taxonomyContains (subject : Section) (domain skill : String) : Bool :=
  taxonomy.any fun item =>
    item.subject == subject && item.domain == domain && item.skill == skill

def hasMultipleChoiceAnswer (q : Question) : Bool :=
  q.choiceA != "" && q.choiceB != "" && q.choiceC != "" && q.choiceD != "" &&
  (q.correct == "A" || q.correct == "B" || q.correct == "C" || q.correct == "D") &&
  q.acceptedResponses == ""

def hasStudentResponseAnswer (spec : ModuleSpec) (q : Question) : Bool :=
  spec.subject == .math && q.choiceA == "" && q.choiceB == "" &&
  q.choiceC == "" && q.choiceD == "" && q.correct == "" &&
  q.acceptedResponses != ""

def questionValid (spec : ModuleSpec) (q : Question) : Bool :=
  q.moduleKey == spec.key &&
  decide (0 < q.order) && decide (q.order <= spec.count) &&
  q.prompt != "" &&
  taxonomyContains spec.subject q.domain q.skill &&
  (q.difficulty == "Easy" || q.difficulty == "Medium" || q.difficulty == "Hard") &&
  match q.responseType with
  | .multipleChoice => hasMultipleChoiceAnswer q
  | .studentResponse => hasStudentResponseAnswer spec q

def moduleAccepted (spec : ModuleSpec) (rows : List Question) : Bool :=
  rows.length == spec.count &&
  (rows.map Question.order).Nodup &&
  rows.all (questionValid spec) &&
  (rows.filter Question.isPretest).length == 2

def completedQuestion (spec : ModuleSpec) (order : Nat) : Question :=
  let isStudentResponse := spec.subject == .math && order == 1
  { moduleKey := spec.key
    order := order
    prompt := "Which answer is correct?"
    responseType := if isStudentResponse then .studentResponse else .multipleChoice
    choiceA := if isStudentResponse then "" else "Choice A"
    choiceB := if isStudentResponse then "" else "Choice B"
    choiceC := if isStudentResponse then "" else "Choice C"
    choiceD := if isStudentResponse then "" else "Choice D"
    correct := if isStudentResponse then "" else "A"
    acceptedResponses := if isStudentResponse then "1; 1.0" else ""
    domain := if spec.subject == .math then "Algebra" else "Information and Ideas"
    skill := if spec.subject == .math then "Linear Equations in One Variable" else "Central Ideas and Details"
    difficulty := "Medium"
    isPretest := decide (order <= 2) }

def completedRows (spec : ModuleSpec) : List Question :=
  (List.range spec.count).map fun n => completedQuestion spec (n + 1)

def blankQuestion (spec : ModuleSpec) (order : Nat) : Question :=
  { moduleKey := spec.key
    order := order
    prompt := ""
    responseType := .multipleChoice
    choiceA := ""
    choiceB := ""
    choiceC := ""
    choiceD := ""
    correct := ""
    acceptedResponses := ""
    domain := ""
    skill := ""
    difficulty := "Medium"
    isPretest := false }

def blankRows (spec : ModuleSpec) : List Question :=
  (List.range spec.count).map fun n => blankQuestion spec (n + 1)

def completedFixtureAccepted : Bool :=
  moduleSpecs.all fun spec => moduleAccepted spec (completedRows spec)

def completedQuestionCount : Nat :=
  moduleSpecs.foldl (fun n spec => n + (completedRows spec).length) 0

def blankFixtureAccepted : Bool :=
  moduleSpecs.all fun spec => moduleAccepted spec (blankRows spec)

end SATImportTemplate
