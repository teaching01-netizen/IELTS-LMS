# SAT answer choices: serif font + box hugs text

## Context
In the SAT exam, the passage and question prompt render in the serif reading font (`.sat-exam-prose`, Charter/Georgia), but answer choices render in the app's sans font. Choice boxes are also taller than their text, and the text sits below the A/B/C/D marker's center.

Root causes:
1. **Font:** `SatQuestionBody` applies `sat-exam-prose` only to the stimulus/prompt wrapper (`src/features/exam-rendering/api/SatQuestionBody.tsx:26`). The choices are rendered as `children` outside that wrapper, so they inherit sans.
2. **Box height:** the shared rich-content renderer gives every paragraph `[&_p]:my-2` (`src/features/exam-rendering/RichStructuredContentRenderer.tsx:27`). Inside the flex choice row those 8px margins don't collapse. That adds 16px to each box and pushes the text 8px below the marker (≈74px box instead of ≈58px).

## Changes
1. `src/features/student-delivery/ui/question/SatSingleChoiceAnswer.tsx:112`: add `sat-exam-prose` to the option content div's className. The letter marker stays sans and bold, as in the reference screenshot.
2. `src/index.css`, next to the `.sat-answer-choice` rules (~line 2710): add an unlayered rule that trims the outer paragraph margins inside a choice:
   ```css
   /* Choice text hugs its box: the renderer's paragraph margins are passage
    * spacing; inside a flex row they don't collapse and push text off the marker. */
   .sat-answer-choice p:first-child { margin-top: 0; }
   .sat-answer-choice p:last-child { margin-bottom: 0; }
   ```
   Unlayered CSS beats Tailwind v4's `@layer utilities`. A choice with several paragraphs keeps its inner spacing. The existing padding (`py-3.5`), `min-h` of 52px and 28px marker are unchanged, so a one-line choice becomes about 58px tall with the text centered on the marker.

Passages, prompts and the shared renderer are not touched.

## Verification
- `bunx vitest run src/features/student-delivery/ui/question`
- `bun run dev`, then open a Reading & Writing question in Staff Preview. Confirm that:
  - choices use the same serif font as the prompt
  - one-line choice boxes are tight, and the text is vertically centered on the letter circle
  - multi-line choices, a selected choice and an eliminated choice (strike line) still look right
  - the larger text-size and relaxed line-spacing reading preferences don't clip anything
- Take a screenshot as proof.
