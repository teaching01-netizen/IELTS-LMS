/-!
# Student SAT score-report display model

This is a pure presentation model. It starts at the released, normalized
`classroomRaw` report boundary and models what score values and raw details the
student report exposes. It does not model browser layout, server transactions,
or whether a converter table is psychometrically sound.
-/

namespace SATStudentScoreDisplay

inductive Subject
  | readingWriting
  | math
  deriving DecidableEq, Repr

inductive ConversionStatus
  | converted
  | unavailable
  deriving DecidableEq, Repr

inductive Route
  | lower
  | higher
  deriving DecidableEq, Repr

inductive RoutePolicy
  | adaptive (minimumCorrectForHigher : Nat)
  | forceLower
  | forceHigher
  deriving DecidableEq, Repr

/-- The route choice after a policy has been selected by the classroom plan/session. -/
def chooseRoute (policy : RoutePolicy) (rawCorrect operationalCount : Nat) : Option Route :=
  match policy with
  | .adaptive threshold =>
      if 0 < operationalCount ∧ 1 ≤ threshold ∧ threshold ≤ operationalCount ∧
          rawCorrect ≤ operationalCount then
        some (if threshold ≤ rawCorrect then .higher else .lower)
      else none
  | .forceLower =>
      if rawCorrect ≤ operationalCount then some .lower else none
  | .forceHigher =>
      if rawCorrect ≤ operationalCount then some .higher else none

structure Interval where
  low : Int
  high : Int
  deriving DecidableEq, Repr

def validInterval (minimum maximum : Int) (score : Interval) : Prop :=
  minimum ≤ score.low ∧ score.low ≤ score.high ∧ score.high ≤ maximum ∧
    score.low % 10 = 0 ∧ score.high % 10 = 0

def validSectionInterval (score : Interval) : Prop :=
  validInterval 200 800 score

def validTotalInterval (score : Interval) : Prop :=
  validInterval 400 1600 score

structure Count where
  correct : Nat
  total : Nat
  deriving DecidableEq, Repr

structure DetailRow where
  key : Nat
  counts : Count
  deriving DecidableEq, Repr

structure RawDetails where
  overall : Count
  modules : List DetailRow
  domains : List DetailRow
  deriving DecidableEq, Repr

structure InputSection where
  subject : Subject
  conversionStatus : ConversionStatus
  scaled : Option Interval
  details : RawDetails
  deriving DecidableEq, Repr

structure InputReport where
  converterPresent : Bool
  sections : List InputSection
  totalScaled : Option Interval
  deriving DecidableEq, Repr

inductive ScoreDisplay
  | estimated (low high : Int)
  | raw (correct total : Nat)
  | dash
  deriving DecidableEq, Repr

structure SectionView where
  subject : Subject
  score : ScoreDisplay
  details : RawDetails
  deriving DecidableEq, Repr

inductive ReportView
  | unavailable
  | available (subjects : List SectionView) (primary : Option ScoreDisplay) (showCombined : Bool)
  deriving DecidableEq, Repr

def validSectionInput (sec : InputSection) : Prop :=
  sec.details.overall.correct ≤ sec.details.overall.total

def validSectionList : List InputSection → Prop
  | [one] => validSectionInput one
  | [first, second] =>
      first.subject ≠ second.subject ∧ validSectionInput first ∧ validSectionInput second
  | _ => False

def orderSections : List InputSection → List InputSection
  | [one] => [one]
  | [first, second] =>
      if first.subject == Subject.readingWriting then [first, second] else [second, first]
  | _ => []

noncomputable def sectionScore (converterPresent : Bool) (sec : InputSection) : ScoreDisplay := by
  classical
  exact match sec.conversionStatus, sec.scaled with
    | .converted, some score =>
        if validSectionInterval score then .estimated score.low score.high
        else if converterPresent then .dash
        else .raw sec.details.overall.correct sec.details.overall.total
    | _, _ =>
        if converterPresent then .dash
        else .raw sec.details.overall.correct sec.details.overall.total

noncomputable def sectionView (converterPresent : Bool) (sec : InputSection) : SectionView :=
  { subject := sec.subject
    score := sectionScore converterPresent sec
    details := sec.details }

def estimated (score : ScoreDisplay) : Bool :=
  match score with
  | .estimated _ _ => true
  | _ => false

def sumCounts (sections : List SectionView) : Count :=
  sections.foldl
    (fun sum subject =>
      { correct := sum.correct + subject.details.overall.correct
        total := sum.total + subject.details.overall.total })
    { correct := 0, total := 0 }

noncomputable def combinedPrimary (report : InputReport) (subjects : List SectionView) : Option ScoreDisplay := by
  classical
  let allEstimated := subjects.all (fun subject => estimated subject.score)
  let anyEstimated := subjects.any (fun subject => estimated subject.score)
  exact if allEstimated then
      match report.totalScaled with
      | some score =>
          if validTotalInterval score then some (.estimated score.low score.high)
          else if report.converterPresent then some .dash else none
      | none => if report.converterPresent then some .dash else none
    else if report.converterPresent then some .dash
    else if anyEstimated then none
    else
      let counts := sumCounts subjects
      some (.raw counts.correct counts.total)

def primaryIsEstimate : Option ScoreDisplay → Bool
  | some (.estimated _ _) => true
  | _ => false

noncomputable def buildReport (report : InputReport) : ReportView := by
  classical
  exact if h : validSectionList report.sections then
    let sections := orderSections report.sections
    let subjects := sections.map (sectionView report.converterPresent)
    match subjects with
    | [one] => .available subjects (some one.score) false
    | _ =>
        let primary := combinedPrimary report subjects
        .available subjects primary (subjects.length == 2 && primaryIsEstimate primary)
    else
      .unavailable

def renderedUnavailableScore (score : ScoreDisplay) : String :=
  match score with
  | .dash => "-"
  | .estimated low high => if low == high then toString low else s!"{low}–{high}"
  | .raw correct total => s!"{correct} of {total} correct"

end SATStudentScoreDisplay
