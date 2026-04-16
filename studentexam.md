# **IELTS Exam Student Interface: Comprehensive UX/UI Specification Document**

## **Document Overview**

**Version:** 1.0  
**Type:** Product Design Specification (PDS) - Student Experience  
**Target Audience:** Product Managers, UI/UX Designers, Frontend Developers, QA Engineers  
**Scope:** Complete user experience design for the IELTS examination **test-taking** platform (student-facing)

---

## **Table of Contents**

1. [Executive Summary](#1-executive-summary)
2. [Design Philosophy: The "Exam Day" Paradigm](#2-design-philosophy-the-exam-day-paradigm)
3. [Pre-Exam Experience](#3-pre-exam-experience)
4. [Global Layout System](#4-global-layout-system)
5. [Module Navigation & Progress Tracking](#5-module-navigation--progress-tracking)
6. [Reading Module: Student Interface](#6-reading-module-student-interface)
7. [Listening Module: Student Interface](#7-listening-module-student-interface)
8. [Writing Module: Student Interface](#8-writing-module-student-interface)
9. [Speaking Module: Student Interface](#9-speaking-module-student-interface)
10. [Universal Question Display System](#10-universal-question-display-system)
11. [Answer Input Mechanisms](#11-answer-input-mechanisms)
12. [Timer & Time Management (Student View)](#12-timer--time-management-student-view)
13. [Review & Navigation Tools](#13-review--navigation-tools)
14. [Accessibility for Test-Takers](#14-accessibility-for-test-takers)
15. [Error Handling & Edge Cases](#15-error-handling--edge-cases)
16. [Post-Submission Flow](#16-post-submission-flow)
17. [Responsive Design: Student Devices](#17-responsive-design-student-devices)

---

## **1. Executive Summary**

### 1.1 Purpose

This document defines the **student-facing interface** for completing an IELTS examination digitally. While the companion document (Exam Builder Specification) addressed how educators **create** exams, this specification addresses how students **experience** and **complete** those exams.

### 1.2 Core Challenge

The student interface must balance three competing demands:

| Demand | Description | Tension Point |
|--------|-------------|---------------|
| **Fidelity to Paper IELTS** | Must feel familiar to students who've practiced on paper exams | Digital affordances shouldn't confuse paper-trained students |
| **Digital Advantages** | Leverage technology for better usability (zoom, highlight, easy navigation) | Don't add features that give unfair advantages or distract |
| **Security & Integrity** | Prevent cheating, ensure validity | Security measures shouldn't create anxiety or hinder legitimate test-taking |

### 1.3 Key Differentiators from Standard Online Quiz Interfaces

| Feature | Standard Quiz (Kahoot/Quizlet) | IELTS Student Interface |
|---------|-------------------------------|-------------------------|
| **Navigation** | Free navigation, skip freely | Structured progression with review phase |
| **Question Visibility** | One question at a time | Stimulus + multiple questions visible simultaneously |
| **Media Integration** | Optional | Central (reading passage always visible) |
| **Time Pressure** | Often relaxed or per-question | Strict module-level timers with auto-submit |
| **Answer Changes** | Usually allowed until end | Allowed within module; locked after submit |
| **Feedback** | Immediate ("Correct!/Wrong!") | No feedback until exam complete |
| **Interface Customization** | Minimal | High (font size, zoom, color themes for accessibility) |

---

## **2. Design Philosophy: The "Exam Day" Paradigm**

### 2.1 Principle 1: Calm Competence

**Goal:** The interface should fade into the background. Students should focus on **content**, not **interface**.

**Implementation:**
- Muted, professional color palette (no bright primary colors except for critical actions)
- Subtle animations (no bouncy or playful motion)
- Clear visual hierarchy that guides eye naturally
- Minimal chrome (UI elements that aren't content)

### 2.2 Principle 2: Paper Exam Familiarity

**Goal:** Students preparing for IELTS have practiced on paper. The digital version should map cognitively to that experience.

**Mapping Table:**

| Paper IELTS Element | Digital Equivalent |
|---------------------|-------------------|
| Physical question booklet | Split-screen stimulus + questions |
| Pencil for underlining | Highlighter tool (digital) |
| Eraser | Clear answer option |
| Answer sheet (bubbles) | Radio buttons / input fields |
| Raising hand for help | "Request Assistance" button |
| Wall clock | On-screen timer (prominent but not alarming) |
| Turning pages | Scroll / Next-Previous buttons |

### 2.3 Principle 3: Progressive Disclosure of Information

**During Exam:**
- Show only current module's content
- Hide other modules' existence (reduce cognitive load)
- No indication of how many questions remain in later modules

**Review Phase (if applicable):**
- Show overview of all answered/unanswered questions
- Allow navigation to flagged items

### 2.4 Principle 4: Error Forgiveness

**Students are under stress. Forgive mistakes:**

- **Accidental close?** Auto-save every 30 seconds + warning before exit
- **Wrong answer clicked?** Allow changing answers anytime before module submit
- **Timer panic?** Clear warnings at 10 min, 5 min, 1 min (no sudden auto-submit without warning)
- **Technical glitch?** Auto-recovery to last saved state

---

## **3. Pre-Exam Experience**

### 3.1 Login & Authentication

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                    🎓 IELTS EXAMINATION                     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │   Candidate ID:  [________________________]        │   │
│  │                                                     │   │
│  │   Password/DOB:  [________________________]        │   │
│  │                                                     │   │
│  │              [ Sign In to Exam ]                   │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  🔒 Secure Examination Portal                               │
│  Version 2.4.1  |  Last updated: March 2024                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Security Features:**
- Proctoring integration readiness (camera/mic permission check)
- Browser integrity check (no extensions, dev tools closed)
- Full-screen mode enforcement (if required by institution)
- Session token generation (prevents tab duplication)

### 3.2 Identity Verification (If Required)

For high-stakes administrations:

```
┌─────────────────────────────────────────────────────────────┐
│  📸 Identity Verification                                   │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Please confirm your identity before beginning.             │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │                 │  │  Expected Candidate:              │  │
│  │   📷 Camera     │  │  Name: Sarah J. Chen               │  │
│  │   Feed          │  │  ID: IELTS-2024-78432             │  │
│  │                 │  │  Date of Birth: 15/03/2001         │  │
│  │  [Capture       │  │                                   │  │
│  │   Photo]        │  │  ✅ Face matches photo on record  │  │
│  │                 │  │                                   │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
│                                                             │
│  [Retake Photo]              [Confirm & Continue]           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 System Check & Tutorial

**Mandatory first-time tutorial (can be skipped on retake):**

```
┌─────────────────────────────────────────────────────────────┐
│  🎯 Exam Interface Tutorial                                 │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Welcome! Let's familiarize you with the exam interface.    │
│  This will take approximately 3 minutes.                    │
│                                                             │
│  Step 1 of 6: Understanding the Layout                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  [Interactive demo area showing split-screen]        │   │
│  │                                                     │   │
│  │  This is where your reading passage will appear.    │   │
│  │  → Questions will be on the right side.            │   │
│  │                                                     │   │
│  │  [Click "Next" to continue...]                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Progress: [████████░░░░] Step 1/6                         │
│                                                             │
│  [Skip Tutorial]                    [Next Step →]           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Tutorial Modules:**

| Step | Content | Interactive Element |
|------|---------|-------------------|
| 1 | Layout overview | Clickable hotspots explaining zones |
| 2 | Timer location | Simulated timer countdown |
| 3 | How to select answers | Practice MCQ selection |
| 4 | How to type answers | Practice text input |
| 5 | Using highlighter tool | Highlight sample text |
| 6 | Navigation & review | Flag a question, use overview |

**System Diagnostics (Automatic):**
```
✅ Audio: Working (speakers detected)
✅ Microphone: Available (for Speaking section)
✅ Screen Resolution: 1920x1080 (Optimal)
✅ Internet Connection: Stable (45ms latency)
⚠️ Battery: 67% (Consider plugging in charger)
✅ Keyboard: Detected
```

### 3.4 Exam Rules Confirmation

Before starting:

```
┌─────────────────────────────────────────────────────────────┐
│  📋 Examination Rules & Instructions                        │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Please read and acknowledge the following:                 │
│                                                             │
│  ☑ I understand this exam is timed and will auto-submit     │
│     when time expires for each module.                       │
│  ☑ I am not permitted to use outside resources, notes,      │
│     or communicate with others during the exam.              │
│  ☑ I must complete modules in order: Listening → Reading    │
│     → Writing → Speaking.                                    │
│  ☑ Once a module is submitted, I cannot return to it.       │
│  ☑ My work is saved automatically throughout the exam.      │
│                                                             │
│  Exam Details:                                               │
│  Type: IELTS Academic                                       │
│  Estimated Duration: 2 hours 45 minutes                      │
│  Modules: Listening (30m), Reading (60m), Writing (60m),    │
│           Speaking (11-14m)                                  │
│                                                             │
│  [I Agree, Begin Exam →]                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## **4. Global Layout System**

### 4.1 Master Layout Grid

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER BAR (Fixed Top)                                     │
│  [Module Name]  [Timer]  [Q Counter]  [Tools]  [Submit]     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    MAIN CONTENT AREA                        │
│              (Varies by module - see below)                  │
│                                                             │
│  ┌──────────────────────────┬─────────────────────────────┐│
│  │                          │                             ││
│  │    STIMULUS ZONE         │      QUESTION ZONE          ││
│  │    (Reading Passage /    │      (Questions &           ││
│  │     Audio Player /       │       Answer Inputs)        ││
│  │     Writing Prompt)      │                             ││
│  │                          │                             ││
│  │    Independent Scroll     │      Independent Scroll     ││
│  │                          │                             ││
│  └──────────────────────────┴─────────────────────────────┘│
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  FOOTER BAR (Fixed Bottom)                                  │
│  [Prev Q] [Q Navigator] [Next Q] [Flag] [Zoom Controls]    │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Header Bar Specifications

```
╔═════════════════════════════════════════════════════════════╗
║  🎧 LISTENING MODULE    ⏱ 23:47 remaining    12/40 done  🔧 ║
╚═════════════════════════════════════════════════════════════╝
```

**Components (Left to Right):**

1. **Module Indicator**
   - Icon + name of current module
   - Color-coded per module (Listening=Blue, Reading=Green, etc.)
   - Font: Semibold, 14px

2. **Timer**
   - Large, prominent display
   - Format: `MM:SS` (or `HH:MM:SS` if >1 hour)
   - Color behavior:
     - >10 min: White text on transparent
     - 5-10 min: Amber (#F59E0B)
     - <5 min: Red (#EF4444) + subtle pulse animation
   - Clicking timer expands to show: module start time, elapsed time, remaining

3. **Progress Counter**
   - Format: `XX/YY completed` (questions answered)
   - Updates in real-time as student answers
   - Shows checkmark when all questions in module answered

4. **Tools Menu (🔧)**
   - Dropdown with available tools:
     ```
     🔍 Zoom In
     🔍 Zoom Out
     🔍 Reset Zoom
     ──────────
     🖍️ Highlighter (On/Off)
     📝 Notes/Sticky Note
     📎 Line Ruler (reading guide)
     ──────────
     ⚙️ Accessibility Options
     ❓ Help / Report Issue
     ```

5. **Submit Button** (only appears when all questions answered OR timer <5 min)
   - Primary action button
   - Requires confirmation modal
   - Text changes contextually:
     - "Submit Listening" (normal state)
     - "Submit Reading" 
     - "Auto-submitting in 47s..." (when timer near zero)

### 4.3 Footer Bar Specifications

```
╔═════════════════════════════════════════════════════════════╗
║  [◀ Prev]  [Q 14 ▾]  [▶ Next]  [🚩 Flag]  [🔍100%]  [Line]║
╚═════════════════════════════════════════════════════════════╝
```

**Components:**

1. **Previous Question Button (`◀ Prev`)**
   - Disabled on first question (grayed out, `cursor: not-allowed`)
   - Keyboard shortcut: Left Arrow (or Alt+Left)

2. **Question Navigator Dropdown (`[Q 14 ▾]`)**
   - Shows current question number
   - Click opens grid/modal:
     ```
     ┌─────────────────────────────┐
     │  Go to Question:            │
     │  ┌──┬──┬──┬──┬──┬──┬──┬──┐ │
     │  │✓│✓│✓│✓│✓│✓│14│  │ │ │
     │  ├──┼──┼──┼──┼──┼──┼──┼──┤ │
     │  │  │  │  │  │  │  │  │  │ │
     │  └──┴──┴──┴──┴──┴──┴──┴──┘ │
     │                             │
     │  ✓ = Answered  🚩 = Flagged │
     │  Current: Q14 (highlighted) │
     └─────────────────────────────┘
     ```
   - Grid shows status colors:
     - Gray: Unanswered
     - Green: Answered
     - Orange: Flagged for review
     - Blue: Current position

3. **Next Question Button (`▶ Next`)**
   - Disabled on last question
   - Keyboard shortcut: Right Arrow (or Alt+Right)
   - On last question, text changes to "Review Answers"

4. **Flag for Review Button (`🚩 Flag`)**
   - Toggles flag on current question
   - Visual feedback: Button turns orange when active
   - Flag icon appears next to question in navigator grid
   - Non-blocking: Can still submit even with flagged questions (with warning)

5. **Zoom Controls (`[🔍100%]`)**
   - Quick zoom buttons: `[−]` `[100%]` `[+]`
   - Presets: 75%, 100%, 125%, 150%, 200%
   - Applies to both panes equally (maintains readability)

6. **Line Ruler / Reading Guide (`[Line]`)**
   - Toggles horizontal highlight line that follows cursor/scroll
   - Helps track line reading (reduces skipping lines)
   - Adjustable height and opacity

### 4.4 Responsive Considerations

**Full HD (1920x1080) - Optimal:**
- Both panes fully visible
- No horizontal scrolling needed
- Comfortable font sizes (16px body text)

**Smaller Laptops (1366x768) - Acceptable:**
- Panes slightly compressed
- Font may reduce to 14px
- Toolbar icons only (text labels hidden)

**Tablet (1024x768) - Functional:**
- Panes stack vertically (stimulus top, questions bottom)
- Tab switcher between them
- Horizontal scroll possible but discouraged

**Mobile (<768px) - Not Recommended:**
- Banner: "Use larger screen for optimal experience"
- Single pane view with toggle
- Significant UI compromises (see Section 17)

---

## **5. Module Navigation & Progress Tracking**

### 5.1 Module Sequence Enforcement

IELTS requires strict ordering:

```
START EXAM
    │
    ▼
┌─────────────┐
│  LISTENING   │ ◄── Locked until started
│  (30 mins)   │
└──────┬──────┘
       │ Submit (or auto-submit)
       ▼
┌─────────────┐
│   READING    │ ◄── Locked until Listening complete
│  (60 mins)   │
└──────┬──────┘
       │ Submit (or auto-submit)
       ▼
┌─────────────┐
│   WRITING    │ ◄── Locked until Reading complete
│  (60 mins)   │
└──────┬──────┘
       │ Submit (or auto-submit)
       ▼
┌─────────────┐
│   SPEAKING   │ ◄── Locked until Writing complete
│ (11-14 mins) │
└──────┬──────┘
       │ Complete
       ▼
    END EXAM
```

**Visual Lock State (Future Modules):**
```
┌─────────────────────────────────────┐
│                                     │
│  ✅ Listening Module  COMPLETED     │
│  ✅ Reading Module    COMPLETED     │
│  ⏳ Writing Module    IN PROGRESS   │
│  🔒 Speaking Module  LOCKED        │
│       (Complete Writing to unlock)  │
│                                     │
└─────────────────────────────────────┘
```

### 5.2 Inter-Module Transition Screen

When moving from one module to next:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│           ✅ Reading Module Complete                        │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  You have successfully submitted the Reading module.        │
│                                                             │
│  Your answers have been saved.                              │
│                                                             │
│  Summary:                                                   │
│  • Questions Attempted: 38/40                               │
│  • Time Remaining: 02:14 (bonus time unused)               │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Preparing Writing Module...                                │
│                                                             │
│  ████████████████████░░░░░░░░ Loading  73%                 │
│                                                             │
│  ⏳ Please wait. Do not refresh or close this window.       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Transition Rules:**
- Minimum 5-second delay (allows system to finalize previous module)
- Progress bar reduces anxiety (shows something is happening)
- No back button once transition starts
- If technical error occurs, offer retry (not skip)

### 5.3 Overall Progress Dashboard (Optional - End of Exam)

After final module (Speaking):

```
┌─────────────────────────────────────────────────────────────┐
│  🎉 Examination Complete!                                   │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Congratulations! You have completed all modules.           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Module          Status     Questions    Time Used   │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  Listening       ✅ Done     40/40      28:34 /30:00│   │
│  │  Reading         ✅ Done     39/40      58:12 /60:00│   │
│  │  Writing Task 1  ✅ Done     —          18:45 /20:00│   │
│  │  Writing Task 2  ✅ Done     —          41:20 /40:00│   │
│  │  Speaking Part 1 ✅ Done     —          04:12       │   │
│  │  Speaking Part 2 ✅ Done     —          03:08       │   │
│  │  Speaking Part 3 ✅ Done     —          04:55       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Total Exam Duration: 2 hours 39 minutes                    │
│                                                             │
│  Your responses have been securely submitted.               │
│  Results will be available from your examination center.    │
│                                                             │
│  [Exit Exam Platform]                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## **6. Reading Module: Student Interface**

### 6.1 Layout Overview

The Reading module uses the signature **split-screen layout**:

```
╔═════════════════════════════════════════════════════════════════╗
║  📚 READING MODULE              ⏱ 47:23    23/40    🔧 [Submit]║
╠═════════════════════════════════════════════════════════════════╣
║                                                               ║
║  ┌──────────────────────────────┬─────────────────────────────┐║
║  │ READING PASSAGE 1            │  QUESTIONS 1-13             ║
║  │                              │                             ║
║  │  The Industrial Revolution   │  ┌─────────────────────┐    ║
║  │                              │  │ Questions 1-6       │    ║
║  │  Paragraph A                 │  │                     │    ║
║  │  The term 'Industrial        │  │ Do the following    │    ║
║  │  Revolution' describes the   │  │ statements agree... │    ║
║  │  transition to new           │  │                     │    ║
║  │  manufacturing processes     │  │ 1. [T] [F] [NG]     │    ║
║  │  in Europe and America...    │  │    The revolution   │    ║
║  │                              │  │    began in France. │    ║
║  │  Paragraph B                 │  │    [Selected: F] ✓  │    ║
║  │  Several factors contributed │  │                     │    ║
║  │  to Britain's early          │  │ 2. [T] [F] [NG]     │    ║
║  │  dominance in industrial     │  │    Coal was the...  │    ║
║  │  production...               │  │    [Not selected]   │    ║
║  │                              │  │                     │    ║
║  │  [Highlighted text here]     │  ├─────────────────────┤    ║
║  │  "abundant natural resources"│  │ Questions 7-13      │    ║
║  │  ← student used highlighter  │  │ Matching Headings   │    ║
║  │                              │  │                     │    ║
║  │  Paragraph C                 │  │ [i] Heading A  [▾] │    ║
║  │  The availability of coal    │  │ [ii] Heading B [▾] │    ║
║  │  and iron ore was crucial... │  │ ...                │    ║
║  │                              │  │                     │    ║
║  │  ┌──────────────────────┐   │  └─────────────────────┘    ║
║  │  │ [Diagram/Image if     │   │                             ║
║  │  │  included in passage] │   │                             ║
║  │  └──────────────────────┘   │                             ║
║  │                              │                             ║
║  │                              │                             ║
║  └──────────────────────────────┴─────────────────────────────┘║
║                                                               ║
╠═════════════════════════════════════════════════════════════════╣
║  [◀ Prev]  [Q 7 ▾]  [▶ Next]  [🚩 Flag]  [🔍110%]  [Line]  ║
╚═════════════════════════════════════════════════════════════════╝
```

### 6.2 Stimulus Pane (Reading Passage) Features

**Text Rendering:**
- Font: Serif for passages (mimics printed exam: Georgia or Times New Roman fallback)
- Size: Default 18px (adjustable via zoom: 14px-24px range)
- Line height: 1.6 (generous for readability)
- Max width: 650px (optimal reading column ~70 characters)
- Justified left (not full justify—avoids rivers of white space)

**Paragraph Labels:**
- Automatically displayed as bold, small caps: **PARAGRAPH A**, **PARAGRAPH B**, etc.
- Slightly larger font (19px) with bottom margin
- Sticky behavior: When scrolling, paragraph label stays visible briefly (optional setting)

**Images/Diagrams Within Passages:**
- Render inline where placed by creator
- Click to expand to lightbox (full screen with dimmed background)
- Lightbox controls: `[Zoom In] [Zoom Out] [Close (Esc)]`
- Image caption shown below (if provided)

**Student Annotation Tools:**

**Highlighter Tool:**
```
Toolbar (appears when text selected):
┌─────────────────────────────────────┐
│ 🟡 Yellow  🟠 Orange  💙 Blue  [✕] │
└─────────────────────────────────────┘
```

- Select text → mini-toolbar appears above selection
- Choose highlight color
- Highlight persists during entire module
- Multiple highlights can overlap
- **Remove:** Click highlighted text → "Remove highlight" option

**Sticky Notes:**
- Right-click text or click margin area → "Add note"
- Small sticky note icon appears in margin
- Click to open/edit:
  ```
  ┌──────────────────────┐
  │ 📝 My Note           │
  │ ──────────────────── │
  │ Check this against   │
  │ Q7 - seems related   │
  │                     │
  │ [Edit] [Delete]     │
  └──────────────────────┘
  ```
- Notes do NOT submit with exam (private to student)

**Line Ruler / Reading Guide:**
- Horizontal bar that follows mouse cursor or touch
- Reduces eye strain and prevents line-skipping
- Customizable:
  - Height: 1px to 4px
  - Color: Default semi-transparent black, can change to amber
  - Opacity: 30% to 80%

**Search in Passage (Ctrl+F):**
- Find text within current passage
- Highlights all instances (cycling through them)
- Case-insensitive by default
- Counter: "3 of 8 matches"

### 6.3 Question Pane Features

**Scroll Behavior:**
- Scrolls independently from passage
- Current question group auto-highlighted (subtle background tint)
- Smooth scroll animation when clicking navigator

**Question Block Headers:**
```
┌─────────────────────────────────────────────┐
│  Questions 1-6                              │
│  Do the following statements agree with the │
│  information in Reading Passage 1?          │
│                                             │
│  In boxes 1-6 on your answer sheet, write   │
│  TRUE if the statement agrees with the     │
│  information                               │
│  FALSE if the statement contradicts the    │
│  information                               │
│  NOT GIVEN if there is no information on   │
│  this                                     │
└─────────────────────────────────────────────┘
```
- Instruction text is static (not editable by student)
- Slightly smaller font (14px) and lighter color (#6B7280)
- Collapsible? No—always visible (student needs instructions)

**Multi-Passage Navigation:**

When exam has 3 passages:

```
Passage Selector (top of question pane):
[Passage 1 (Q1-13)] [Passage 2 (Q14-26)] [Passage 3 (Q27-40)]
```

- Clicking switches stimulus pane to show selected passage
- Questions update to show relevant block
- Visual indicator of which passage is active
- Breadcrumb: `Reading > Passage 2 > Questions 14-20`

---

## **7. Listening Module: Student Interface**

### 7.1 Unique Challenges

The Listening module differs fundamentally:
- **Audio is transient** (students can't "re-read" like passages)
- **Timing is synchronized** (audio plays, questions appear in sequence)
- **No independent scrolling** (questions must be visible during audio playback)
- **Potential for replay restrictions** (per exam settings)

### 7.2 Layout Variation

```
╔═════════════════════════════════════════════════════════════════╗
║  🎧 LISTENING MODULE            ⏱ 12:34    8/40     🔧        ║
╠═════════════════════════════════════════════════════════════════╣
║                                                               ║
║  ┌───────────────────────────────────────────────────────────┐ ║
║  │                    AUDIO PLAYER                          │ ║
║  │                                                           │ ║
║  │  ┌─────────────────────────────────────────────────────┐ │ ║
║  │  │  Part 1: Social Context Conversation                 │ │ ║
║  │  │                                                     │ │ ║
║  │  │  ▶ ████████████████████████████████░░░░░░░  02:15  │ │ ║
║  │  │  / 05:43                                           │ │ ║
║  │  │                                                     │ │ ║
║  │  │  [▶ Play]  [⏸ Pause]  [⏪ -10s]  [⏩ +10s]        │ │ ║
║  │  └─────────────────────────────────────────────────────┘ │ ║
║  │                                                           │ ║
║  │  Volume: 🔊 ━━━━━●━━━━━ 70%  |  Speed: 1.0x             │ ║
║  └───────────────────────────────────────────────────────────┘ ║
║                                                               ║
║  ┌───────────────────────────────────────────────────────────┐ ║
║  │                    QUESTIONS 1-10                         │ ║
║  │  (Part 1 - Questions 1-10)                                │ ║
║  │                                                           │ ║
║  │  ┌─────────────────────────────────────────────────────┐ │ ║
║  │  │ Q1: The woman's surname is:                         │ │ ║
║  │  │                                                     │ │ ║
║  │  │  ○ A. Henderson                                     │ │ ║
║  │  │  ○ B. Harvington                                   │ │ ║
║  │  │  ● C. Humphries  ← Selected                         │ │ ║
║  │  │  ○ D. Harrison                                      │ │ ║
║  │  │                                                     │ │ ║
║  │  │ Q2: Her accommodation is located:                   │ │ ║
║  │  │                                                     │ │ ║
║  │  │  ○ A. near the university                           │ │ ║
║  │  │  ○ B. in the city center                            │ │ ║
║  │  │  ○ C. by the train station                          │ │ ║
║  │  │  ○ D. in the suburbs                                │ │ ║
║  │  └─────────────────────────────────────────────────────┘ │ ║
║  │                                                           │ ║
║  │  [Scroll down for Q11-20 (Part 2) ↓]                     │ ║
║  └───────────────────────────────────────────────────────────┘ ║
║                                                               ║
╠═════════════════════════════════════════════════════════════════╣
║  [◀ Prev]  [Q 2 ▾]  [▶ Next]  [🚩 Flag]  [Transcript]       ║
╚═════════════════════════════════════════════════════════════════╝
```

### 7.3 Audio Player Specifications

**Core Controls:**

| Control | Function | Shortcut |
|---------|----------|----------|
| Play/Pause | Toggle audio playback | Spacebar (when player focused) |
| Stop | Reset to beginning | S |
| Rewind 10s | Jump back 10 seconds | Left Arrow |
| Forward 10s | Jump forward 10 seconds | Right Arrow |
| Volume Slider | Adjust volume | V then ↑/↓ |
| Playback Speed | 0.75x, 1.0x, 1.25x (if allowed) | Not assigned (setting only) |

**Waveform Visualization:**
- Renders full audio timeline as waveform
- Current position marked with vertical playhead line
- Timestamp pins (set by creator) shown as markers on waveform
- Click anywhere on waveform to jump to that position
- Zoom controls for waveform: `[Zoom In] [Zoom Out] [Fit All]`

**Audio States:**

| State | Visual | Behavior |
|-------|--------|----------|
| Not Started | Gray play button | Click to begin |
| Playing | Animated waveform, pause button visible | Audio outputs through speakers |
| Paused | Static waveform, play button visible | Position maintained |
| Completed | Green checkmark, "Completed" label | Can replay (if settings allow) |
| Error | Red banner: "Audio failed to load" | Retry button, report issue link |

**Auto-Advance Behavior:**
- Configurable by exam creator (see Builder spec)
- Common pattern:
  - Part 1 audio plays → auto-stops at designated point
  - Brief silence (30 sec) for students to review answers
  - Part 2 begins automatically OR student clicks "Continue to Part 2"
- **Always warn before auto-advance:** Countdown "Part 2 begins in 10 seconds..." with cancel option

### 7.4 Question Synchronization with Audio

**Dynamic Question Highlighting:**
As audio plays, the relevant questions can be visually emphasized (optional feature):

```
Timeline:
00:00 ──► Part 1 Introduction (no questions yet)
00:45 ──► Q1-Q5 area (questions 1-5 get subtle blue background)
02:15 ──► Q6-Q10 area (questions 6-10 highlighted)
03:30 ──► Part 2 begins...
```

**Implementation:**
- Creator sets timestamps during exam building (see Builder spec: Timestamp Pins)
- At runtime, as audio currentTime approaches pin timestamp, associated questions get highlighted
- Highlight fades after 15 seconds
- **Student can disable:** Settings → "Disable audio-synced highlighting"

### 7.5 Transcript Access (Controlled)

**Default:** No transcript available (standard IELTS condition)

**Optional (if creator enables):**
- Button in footer: `[Transcript]`
- Opens in modal overlay (doesn't navigate away)
- Timestamped (click line to jump audio to that point)
- Warning message: "Using transcript may affect score interpretation"
- Log access (examiner can see if transcript was viewed)

```
┌─────────────────────────────────────────────────────────────┐
│  📄 Audio Transcript (Part 1)                               │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  ⚠️ This transcript is provided for accessibility.         │
│     Usage may be noted in your examination record.          │
│                                                             │
│  [00:00]  Woman: Good morning, Northfield Housing Services. │
│           How can I help you today?                         │
│                                                             │
│  [00:05]  Man: Hi. I'm calling about the accommodation      │
│           list you sent me. I'd like to ask about a few     │
│           properties...                                     │
│                                                             │
│  [00:15]  Woman: Of course. Which property reference        │
│           are you interested in?                            │
│                                                             │
│  ...                                                        │
│                                                             │
│  [Close Transcript]                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.6 Special Listening Question Types

**Diagram/Map Labeling (Audio-Based):**
- Image displays with blank labels
- Audio references locations/features
- Student types or selects answers that appear on image
- Same interaction as Reading map labeling (Section 10.4) but triggered by audio cues

**Form/Note Completion:**
- Visual form/note template displayed
- Blanks filled based on audio information
- Example:
  ```
  LIBRARY REGISTRATION FORM
  
  Name: _________________ (Q1)
  Address: _______________ (Q2)
  Postcode: ______________ (Q3)
  Telephone: _____________ (Q4)
  Student ID: ____________ (Q5)
  Course: ________________ (Q6)
  ```

---

## **8. Writing Module: Student Interface**

### 8.1 Fundamental Difference from Other Modules

Writing has **no discrete questions**—it's an **open-ended composition task**. The interface transforms into a **document editor**.

### 8.2 Layout: Full-Width Editor

```
╔═════════════════════════════════════════════════════════════════╗
║  ✍️ WRITING TASK 1              ⏱ 14:22/20:00    🔧          ║
╠═════════════════════════════════════════════════════════════════╣
║                                                               ║
║  ┌───────────────────────────────────────────────────────────┐ ║
║  │  PROMPT (Always Visible - Collapsible)                    │ ║
║  │  ─────────────────────────────────────────────────────── │ ║
║  │                                                           │ ║
║  │  You should spend about 20 minutes on this task.          │ ║
║  │                                                           │ ║
║  │  The charts below show the number of visitors to three    │ ║
║  │  museums in London between 2000 and 2020.                 │ ║
║  │                                                          ║ ║
║  │  Summarise the information by selecting and reporting     │ ║
║  │  the main features, and make comparisons where relevant.  │ ║
║  │                                                           │ ║
║  │  Write at least 150 words.                                │ ║
║  │                                                          ║ ║
║  │  [▲ Collapse Prompt to save space]                        │ ║
║  └───────────────────────────────────────────────────────────┘ ║
║                                                               ║
║  ┌───────────────────────────────────────────────────────────┐ ║
║  │  VISUAL STIMULUS (Task 1 Only)                            │ ║
║  │  ─────────────────────────────────────────────────────── │ ║
║  │                                                           │ ║
║  │       ┌───────────────────────────────────┐               │ ║
║  │       │         [Chart/Diagram]           │               │ ║
║  │       │                                   │               │ ║
║  │       │     (Uploaded by exam creator)     │               │ ║
║  │       │                                   │               │ ║
║  │       └───────────────────────────────────┘               │ ║
║  │                                                           │ ║
║  │  [Open image in new window (🔗)]                          │ ║
║  └───────────────────────────────────────────────────────────┘ ║
║                                                               ║
║  ┌───────────────────────────────────────────────────────────┐ ║
║  │  YOUR RESPONSE                                           │ ║
║  │  ─────────────────────────────────────────────────────── │ ║
║  │                                                           │ ║
║  │  [Bold] [Italic] [Undo] [Redo] | [Cut] [Copy] [Paste]   │ ║
║  │  ─────────────────────────────────────────────────────── │ ║
║  │                                                           │ ║
║  │  The two line graphs illustrate the visitor statistics    │ ║
║  │  for three major museums in London over a twenty-year      │ ║
║  │  period from 2000 to 2020...                              │ ║
║  │                                                           │ ║
║  │  Overall, it is evident that all three museums            │ ║
║  │  experienced significant growth...                        │ ║
║  │                                                           │ ║
║  │  [cursor blinking |]                                      │ ║
║  │                                                           │ ║
║  │  ─────────────────────────────────────────────────────── │ ║
║  │                                                           │ ║
║  │  Words: 187  |  Characters: 1,245  |  Paragraphs: 2      │ ║
║  │  Minimum: 150 words  ✅ Requirement met                  │ ║
║  │                                                           │ ║
║  └───────────────────────────────────────────────────────────┘ ║
║                                                               ║
╠═════════════════════════════════════════════════════════════════╣
║  [Task 1] [Task 2 →]  [🚩 Flag]  [🔍100%]  [Spell Check]    ║
╚═════════════════════════════════════════════════════════════════╝
```

### 8.3 Rich Text Editor Specifications

**Formatting Toolbar:**
- **Minimal formatting** (to prevent distraction/focus on style over content):
  - Bold, Italic, Underline
  - Paragraph alignment (left, center—right rarely needed for essays)
  - Bulleted lists (for Task 1 sometimes useful)
  - Undo/Redo
- **Intentionally excluded:**
  - Fonts (locked to serif/sans-serif per institution preference)
  - Font sizes (locked to readable default)
  - Colors (no colored text)
  - Images (cannot upload images in response)
  - Tables (rarely appropriate)

**Word Count Display:**
- Always visible (bottom-left of editor)
- Real-time updates as student types
- Color coding:
  - ✅ Green: At or above minimum (≥150 for Task 1, ≥250 for Task 2)
  - ⚠️ Amber: Within 10% of minimum (135-149 for Task 1)
  - 🔴 Red: Below threshold (<135 for Task 1)
  - **Warning message** if attempting to submit below minimum:
    ```
    ⚠️ Your response is 127 words. The minimum requirement is 150 words.
    
    You may still submit, but your score may be penalized for length.
    
    [Submit Anyway] [Continue Editing]
    ```

**Auto-Save Behavior:**
- Saves every 10 seconds (more frequent than other modules due to risk of data loss)
- Save indicator: Small checkmark "Saved" in corner of editor
- Version history (if enabled): Can undo up to last 50 actions

**Spell Check:**
- Basic spell-check underline (red squiggle) — standard browser behavior
- Right-click for suggestions
- **Grammar check disabled** (not part of IELTS assessment; grammar errors are evaluated by human grader)
- Toggle: `[Spell Check: ON/OFF]` in footer

### 8.4 Task Switching (Task 1 ↔ Task 2)

**Tab Navigation:**
```
Footer Tabs:
[✍️ Task 1 (18:45 used)]  [✍️ Task 2 (00:00 used)]
```

**Time Allocation:**
- Shared 60-minute pool (default)
- OR separate allocations (20min Task 1, 40min Task 2) per exam settings
- Visual indicator of time spent per task
- **Warning if imbalanced:**
  ```
  ⏰ Notice: You have spent 35 minutes on Task 1.
     Recommended allocation: 20 minutes for Task 1.
     
     Consider moving to Task 2 soon.
  ```

**Switch Confirmation (if Task 1 incomplete):**
```
┌─────────────────────────────────────────────┐
│  Switch to Task 2?                          │
│  ─────────────────────────────────────────  │
│                                             │
│  Your Task 1 response is 147 words.         │
│  (Minimum: 150 words)                       │
│                                             │
│  You can return to Task 1 later if time     │
│  remains.                                   │
│                                             │
│  [Stay on Task 1]      [Switch to Task 2]  │
└─────────────────────────────────────────────┘
```

### 8.5 Essay Composition Best Practices (UI Guidance)

**Optional writing aids (can be toggled):**

**Outline Mode:**
- Sidebar panel for rough notes/outline
- Not submitted with essay (private scratchpad)
- Toggle: `[📝 Outline Notes]`
- Content:
  ```
  Outline Panel (not graded):
  
  Introduction:
  - Hook: tourism stats dramatic increase
  - Thesis: overall growth with variations
  
  Body Para 1: British Museum
  - Steady rise
  - 2005 dip (renovation?)
  
  Body Para 2: Science Museum
  - Most dramatic growth
  - Tech exhibits popular
  
  ...
  ```

**Paragraph Structure Guide:**
- Faint guide showing recommended structure (optional overlay):
  ```
  ┌─────────────────────────────────────┐
  │ [Introduction - restate topic,      │
  │  give overview]                     │
  │                                     │
  │ [Body Paragraph 1 - main point 1,   │
  │  evidence, example]                 │
  │                                     │
  │ [Body Paragraph 2 - main point 2,   │
  │  evidence, example]                 │
  │                                     │
  │ [Conclusion - summarize, final      │
  │  thought]                           │
  └─────────────────────────────────────┘
  ```
- Toggle: `[📋 Structure Guide]`
- Helps students organize thoughts (especially for non-native speakers)

---

## **9. Speaking Module: Student Interface**

### 9.1 Unique Characteristics

The Speaking module is fundamentally different:
- **Human interaction required** (examiner present, either in-person or video call)
- **Real-time response** (no editing, no going back)
- **Audio recording** (responses captured for later grading/rating)
- **Timed segments** (Part 2 has strict 1-min prep + 2-min speak)

### 9.2 Interface Modes

#### **Mode A: In-Person Speaking (Examiner's Device)**

The examiner operates the device; student sees only what's necessary:

```
┌─────────────────────────────────────────────────────────────┐
║  🗣️ SPEAKING TEST - PART 2: LONG TURN                      ║
╠═════════════════════════════════════════════════════════════╣
║                                                               ║
║            ┌─────────────────────────────────────┐           ║
║            │                                     │           ║
║            │         🎤 SPEAKING NOW             │           ║
║            │                                     │           ║
║            │      ⏱ 01:23 / 02:00               │           ║
║            │                                     │           ║
║            │    ━━━━━━━━━━━━━━━━━●━━━━━━━━━━━    │           ║
║            │         62% used                      │           ║
║            │                                     │           ║
║            └─────────────────────────────────────┘           ║
║                                                               ║
║  ┌─────────────────────────────────────────────────────────┐ ║
║  │  CUE CARD (Visible to both examiner & candidate)        │ ║
║  │  ────────────────────────────────────────────────────  │ ║
║  │                                                         │ ║
║  │  Describe something you own which is very important     │ ║
║  │  to you.                                                │ ║
║  │                                                         │ ║
║  │  You should say:                                        │ ║
║  │  • what it is                                           │ ║
║  │  • when you got it                                       │ ║
║  │  • how often you use it                                  │ ║
║  │  • and explain why it is important to you.               │ ║
║  │                                                         │ ║
║  │  You will have one minute to prepare, and you should    │ ║
║  │  speak for one to two minutes.                          │ ║
║  └─────────────────────────────────────────────────────────┘ ║
║                                                               ║
║  Status: 🎤 Recording in progress...                          ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

**Examiner Controls (separate panel, not shown to student):**
```
┌─────────────────────────────────────────────┐
│  👁️ EXAMINER CONTROLS (Hidden from student)│
│  ─────────────────────────────────────────  │
│                                             │
│  Current Part: Part 2 (Long Turn)          │
│                                             │
│  Phase Control:                             │
│  [Start Prep Timer] (1 minute)             │
│  [End Prep Early]                           │
│  [Start Speaking Timer] (2 minutes)        │
│  [End Speaking Early]                       │
│  [Move to Follow-up Questions]             │
│                                             │
│  Audio Levels:                              │
│  Candidate Mic: 🟢 Good (-12dB)            │
│  System Output: 🟢 Good                    │
│                                             │
│  Evaluator Notes:                           │
│  [Quick notes field for examiner use]       │
│                                             │
│  [Technical Issue] [Pause Test]             │
└─────────────────────────────────────────────┘
```

#### **Mode B: Video Call Speaking (Remote/Online IELTS)**

Both student and examiner see shared interface:

```
╔═════════════════════════════════════════════════════════════════╗
║  🗣️ SPEAKING TEST (Video Session)    ⏱ Elapsed: 06:23          ║
╠═════════════════════════════════════════════════════════════════╣
║                                                               ║
║  ┌─────────────────────┐  ┌───────────────────────────────────┐ ║
║  │   👤 EXAMINER       │  │  📹 YOU (Candidate)             │ ║
║  │                     │  │                                   │ ║
║  │  [Video feed of     │  │  [Video feed of candidate        │ ║
║  │   examiner]         │  │   with mirror effect]            │ ║
║  │                     │  │                                   │ ║
║  │  🟢 Connected       │  │  🟢 Mic Active                   │ ║
║  └─────────────────────┘  └───────────────────────────────────┘ ║
║                                                               ║
║  ┌───────────────────────────────────────────────────────────┐ ║
║  │  SHARED CONTENT AREA                                     │ ║
║  │  ─────────────────────────────────────────────────────── │ ║
║  │                                                           │ ║
║  │  Part 2: Cue Card                                         │ ║
║  │  [Cue card content displayed - same as above]             │ ║
║  │                                                           │ ║
║  │  Preparation Timer: 00:45 / 01:00 remaining              │ ║
║  │  [████████████████████░░░░] 75% used                      │ ║
║  │                                                           │ ║
║  └───────────────────────────────────────────────────────────┘ ║
║                                                               ║
║  ┌───────────────────────────────────────────────────────────┐ ║
║  │  CHAT / NOTES (Private to candidate)                      │ ║
║  │  [For personal notes - not visible to examiner]           │ ║
║  └───────────────────────────────────────────────────────────┘ ║
║                                                               ║
╠═════════════════════════════════════════════════════════════════╣
║  [🔊 Volume] [📹 Camera] [💬 Chat]  [❌ End Call / Report Issue]║
╚═════════════════════════════════════════════════════════════════╝
```

### 9.3 Part-by-Part Breakdown

#### **Part 1: Introduction & Interview (4-5 minutes)**

**Student View:**
```
┌─────────────────────────────────────────────────────────────┐
║  🗣️ Part 1: Introduction and Interview                    ║
╠═════════════════════════════════════════════════════════════╣
║                                                               ║
║  The examiner will ask you general questions about           ║
║  yourself and familiar topics.                               ║
║                                                               ║
║  Possible topics:                                            ║
║  • Work or studies                                           ║
║  • Home town                                                 ║
║  • Family                                                    ║
║  • Hobbies / Free time                                       ║
║                                                               ║
║  ┌─────────────────────────────────────────────────────────┐ ║
║  │  🎤 LIVE CONVERSATION                                   │ ║
║  │                                                         │ ║
║  │  Listen carefully to the examiner's questions.          │ ║
║  │  Respond clearly and at natural length.                 │ ║
║  │                                                         │ ║
║  │  Recording status: 🔴 REC ●●●●●●●●●● 00:00:00         │ ║
║  │                                                         │ ║
║  └─────────────────────────────────────────────────────────┘ ║
║                                                               ║
║  Tips:                                                       ║
║  • Give full sentences, not just one-word answers            ║
║  • It's okay to ask for repetition if needed                 ║
║  • Be honest—examiners value authentic responses              ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

**Features:**
- No timer displayed to student (examiner manages pace)
- Recording indicator always visible (red dot + elapsed time)
- Private notes panel optional (student can jot reminders)
- No questions displayed (examiner asks verbally)

#### **Part 2: Cue Card / Long Turn (3-4 minutes)**

**Phase 1: Preparation (1 minute)**

```
┌─────────────────────────────────────────────────────────────┐
║  🗣️ Part 2: Long Turn - PREPARATION TIME                   ║
╠═════════════════════════════════════════════════════════════╣
║                                                               ║
║  ┌─────────────────────────────────────────────────────────┐ ║
║  │  YOUR CUE CARD                                          │ ║
║  │                                                         │ ║
║  │  Describe a book you have read that you found           │ ║
║  │  interesting.                                            │ ║
║  │                                                         │ ║
║  │  You should say:                                        │ ║
║  │  • what the book was called                             │ ║
║  │  • who wrote it                                         │ ║
║  │  • what it was about                                    │ ║
║  │  • and explain why you found it interesting.             │ ║
║  │                                                         │ ║
║  │  You have ONE MINUTE to prepare.                        │ ║
║  └─────────────────────────────────────────────────────────┘ ║
║                                                               ║
║            ┌───────────────────────────────┐                 ║
║            │  ⏱ PREPARATION TIMER         │                 ║
║            │                               │                 ║
║            │       00:37 / 01:00           │                 ║
║            │  ━━━━━━━━━━━━━━━━●━━━━━━━━━━  │                 ║
║            │        63% used               │                 ║
║            │                               │                 ║
║            └───────────────────────────────┘                 ║
║                                                               ║
║  📝 Use this space for notes (you can refer to these         ║
║     while speaking, but the examiner cannot see them):       ║
║  ┌─────────────────────────────────────────────────────────┐ ║
║  │ Book: "The Alchemist" - Paulo Coelho                    │ ║
║  │ - Story of shepherd Santiago                             │ ║
║  │ - Journey to find treasure                              │ ║
║  │ - Theme: follow dreams/personal legend                  │ ║
║  │ Why interesting: simple but deep life lessons           │ ║
║  │ - Read twice, different meaning each time               │ ║
║  │ ...                                                     │ ║
║  └─────────────────────────────────────────────────────────┘ ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

**Preparation Phase Features:**
- **Large, prominent timer** (center stage)
- **Color transitions:**
  - >30 sec: Green
  - 10-30 sec: Amber
  - <10 sec: Red + pulse
- **Audio chime** at 30 sec, 10 sec, and 00 (time to speak)
- **Notes area:** Free-text, auto-saved, student can refer to while speaking
- **Cue card always visible** (doesn't disappear)

**Phase 2: Speaking (1-2 minutes)**

```
┌─────────────────────────────────────────────────────────────┐
║  🗣️ Part 2: Long Turn - SPEAKING NOW                        ║
╠═════════════════════════════════════════════════════════════╣
║                                                               ║
║  ┌─────────────────────────────────────────────────────────┐ ║
║  │  YOUR CUE CARD (for reference)                         │ ║
║  │  [Collapsed version - click to expand]                 │ ║
║  └─────────────────────────────────────────────────────────┘ ║
║                                                               ║
║            ┌───────────────────────────────┐                 ║
║            │  🎤 SPEAKING TIMER           │                 ║
║            │                               │                 ║
║            │       01:14 / 02:00           │                 ║
║            │  ━━━━━━━━━━━━━━━━━━━━━●━━━━━━  │                 ║
║            │        57% used (keep going!)  │                 ║
║            │                               │                 ║
║            └───────────────────────────────┘                 ║
║                                                               ║
║  🎤 Speak now. The examiner is listening. Recordings active.  ║
║                                                               ║
║  Your notes (from preparation):                               ║
║  ┌─────────────────────────────────────────────────────────┐ ║
║  │ [Notes visible but grayed out slightly - refer if needed]│ ║
║  └─────────────────────────────────────────────────────────┘ ║
║                                                               ║
║  ⏱ At 2 minutes, examiner will stop you. Try to speak        ║
║     for the full duration.                                    ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

**Speaking Phase Features:**
- Timer counts up (not down)—shows elapsed, encourages continued speech
- **Green zone** (0-1:30): Normal
- **Amber zone** (1:30-1:50): "Keep going, doing well"
- **Approaching 2 min**: Gentle visual cue (timer turns blue, no alarm)
- **At 2 min**: Soft chime, timer stops, examiner takes over
- **Notes remain visible** (reduced opacity so focus stays on speaking)
- **Recording indicator** prominent (red dot pulsing gently)

#### **Part 3: Discussion (4-5 minutes)**

**Student View:**
```
┌─────────────────────────────────────────────────────────────┐
║  🗣️ Part 3: Two-Way Discussion                             ║
╠═════════════════════════════════════════════════════════════╣
║                                                               ║
║  The examiner will ask you more abstract questions           ║
║  related to the topic from Part 2.                           ║
║                                                               ║
║  These questions may explore:                                 ║
║  • Societal trends                                           ║
║  • Future predictions                                        ║
║  • Causes and consequences                                   ║
║  • Personal opinions vs. general facts                       ║
║                                                               ║
║  Tips for Part 3:                                            ║
║  • Give developed answers (3-4 sentences minimum)            ║
║  • Express opinions clearly with reasons                     ║
║  • It's okay to disagree or say "it depends"                ║
║  • Use examples from your country/experience                 ║
║                                                               ║
║  ┌─────────────────────────────────────────────────────────┐ ║
║  │  🎤 DISCUSSION IN PROGRESS                              │ ║
║  │                                                         │ ║
║  │  Recording: 🔴 REC ●●●●●●●●●●●●●● 00:03:45            │ ║
║  │                                                         │ ║
║  └─────────────────────────────────────────────────────────┘ ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

**Features:**
- Similar to Part 1 (conversation format)
- No timer displayed to student
- Topic reminder visible: "Topic: Books and Reading"
- Longer expected responses (UI could show gentle prompt if silent >10 sec):
  ```
  💬 The examiner is waiting for your response...
  ```

### 9.4 Technical Requirements for Speaking Module

**Audio/Video Quality Indicators:**
```
Connection Quality: 🟢 Excellent (45ms latency)
Microphone Level: 🟢 Good (-18dB peak)
Camera: 🟢 Active (720p)
Background Noise: 🟢 Low
```

**Warning States:**
| Issue | Indicator | Action |
|-------|-----------|--------|
| Poor connection | Amber icon, "Unstable connection" banner | Auto-pause recording, suggest reconnect |
| Mic too quiet | Red "Speak louder" flash | Adjust gain or move closer |
| Mic too loud/distorted | Red "Too loud" flash | Reduce volume or move back |
| Background noise | Amber "Noisy environment" note | Close windows, move to quieter space |

**Recovery from Technical Issues:**
- If connection lost mid-test:
  - Auto-pause with countdown (30 sec to reconnect)
  - If reconnected: Resume from pause point (note in log)
  - If timeout: Offer reschedule (exam not submitted, not counted as attempt)

---

## **10. Universal Question Display System**

Regardless of module, all question types share common display principles.

### 10.1 Question Card Anatomy

Every question follows this structure:

```
╭──────────────────────────────────────────────────────╮
│  Q14.  [Question Number - Bold]                      │
│  ─────────────────────────────────────────────────  │
│                                                      │
│  [Question Stem / Statement / Prompt Text]           │
│  [Full formatting preserved from creator input]      │
│                                                      │
│  ─────────────────────────────────────────────────  │
│                                                      │
│  [Answer Input Area - varies by type]                 │
│                                                      │
│  [Status Indicator: Answered / Unanswered / Flagged] │
╰──────────────────────────────────────────────────────╯
```

**Typography:**
- Question number: Bold, 18px, dark gray (#111827)
- Question stem: Regular weight, 16px, #1F2929
- Line height: 1.5
- Maximum width: 600px (prevents overly long lines)

**Spacing:**
- Margin between questions: 24px
- Padding inside card: 20px
- Gap between stem and answer area: 16px

### 10.2 Question Type: Multiple Choice (Single Answer)

**Display:**
```
Q14. According to Paragraph B, why was Britain ideal for 
     industrialization?

A. It had a large population willing to work in factories
B. Its climate was suitable for cotton production
C. It possessed abundant natural resources
D. Its government provided financial subsidies

( ) Option A  ← Radio button (unselected)
(•) Option C  ← Radio button (selected)
```

**Interaction:**
- Click option to select (radio behavior—only one)
- Selected option gets blue fill (#EFF6FF) with blue border (#3B82F6)
- Click same option again to deselect (returns to unanswered)
- Keyboard: Arrow keys navigate options, Space/Enter selects

**Focus States:**
- Tab into question: Outer border becomes blue (2px solid)
- Focus on option: Option background lightens, focus ring visible
- Screen reader: Announces "Question 14, option C selected, 3 of 4"

### 10.3 Question Type: Multiple Choice (Multiple Answers)

**Display:**
```
Q15-16. Choose TWO letters A-E.

Which TWO challenges did factory workers face?

A. Long working hours (12-16 hours/day)
B. Low wages with no job security
C. Dangerous machinery without safety measures
D. Lack of access to education
E. Poor quality housing near factories

[✓] Option A  ← Checkbox (checked)
[ ] Option B
[✓] Option C  ← Checkbox (checked)
[ ] Option D
[ ] Option E

Selections: 2/2 required
```

**Special Behaviors:**
- Checkboxes instead of radio buttons
- Counter shows: "Selections: X/Y required"
- **Under-selection warning** (if attempt to proceed with fewer than required):
  ```
  ⚠ You have selected 1 answer, but 2 are required.
     This question counts as Q15 AND Q16 (2 points).
  ```
- **Over-selection prevention:** Cannot select more than Y options (checkbox disables)
- Partial credit possible (if configured)

### 10.4 Question Type: True / False / Not Given

**Display:**
```
Q17. The Industrial Revolution began in France in the late 
     1700s.

TRUE (T)      FALSE (F)      NOT GIVEN (NG)

○ TRUE        ○ FALSE        ● NOT GIVEN  ← Selected
```

**Layout Options:**
- **Horizontal** (as above): Good for short statements
- **Vertical** (better for long statements):
  ```
  ○ TRUE
  ○ FALSE
  ○ NOT GIVEN
  ```
- Selection determined by exam creator (based on statement length)

**Visual Distinction:**
- Each option has distinct icon/color association:
  - TRUE: Green circle with checkmark (when selected)
  - FALSE: Red circle with X (when selected)
  - NOT GIVEN: Gray circle with dash (when selected)
- **Unselected state:** Empty circles, equal appearance

### 10.5 Question Type: Fill-in-the-Blank (Cloze / Summary Completion)

**Display:**
```
Questions 18-22
Complete the summary below.
Choose NO MORE THAN TWO WORDS from the passage for each answer.

The Industrial Revolution began in 18._____________ in the 
late 1700s. Several factors contributed to its success, including 
the availability of 19._____________ such as coal and iron ore. 
The development of 20._____________ systems enabled large-scale 
investment in new technologies. Workers often faced 21._____________
conditions, with shifts lasting 12-16 hours. Despite these 
challenges, the revolution led to significant 22._____________ 
and urbanization.

[____ (18) ____]  ← Text input field
[____ (19) ____]
[____ (20) ____]
[____ (21) ____]
[____ (22) ____]
```

**Input Field Specifications:**
- Width: Dynamic (expands slightly if long answer expected, but capped)
- Placeholder: Blank number in parentheses "(18)"
- Max length: Enforced by instruction (e.g., "NO MORE THAN TWO WORDS" = max 2 words + 1 for potential hyphen/number)
- Character counter: Appears on focus: "0/15 characters (max 2 words)"
- **Auto-capitalization:** Off (student must match case exactly if required, though usually case-insensitive)
- **Spell check:** Disabled (distracting for this question type)

**Validation (Real-time):**
- Word count warning: "3 words entered (maximum: 2)"
- Does NOT reveal if answer is correct/incorrect (no feedback during exam)

**Alternative: Word Bank (Letter Selection)**

If word bank version:
```
Questions 18-22
Complete the summary using words from the box below.

Word Bank:
A. Britain      D. dangerous
B. banking      E. economic
C. resources    F. growth

18. [▾ Choose...]  ← Dropdown with A-F options
19. [▾ Choose...]
20. [▾ Choose...]
21. [▾ Choose...]
22. [▾ Choose...]

Options used: None selected yet
```

### 10.6 Question Type: Matching Headings

**Display:**
```
Questions 23-27
Reading Passage 3 has seven paragraphs, A-G.
Choose the correct heading for each paragraph from the list 
of headings below.

List of Headings
i. The role of government intervention
ii. Innovations in textile manufacturing
iii. Social impact on rural populations
iv. The importance of canal networks
v. Urban planning challenges
vi. Changes in agricultural practices
vii. International trade expansion

Paragraph A  [▾ Choose heading...]
Paragraph B  [▾ iii]  ← Selected
Paragraph C  [▾ Choose heading...]
Paragraph D  [▾ Choose heading...]
Paragraph E  [▾ Choose heading...]
```

**Interaction:**
- Dropdown populated with Roman numerals (i-vii)
- Once selected, numeral shows in dropdown
- **Used numerals remain selectable** (unlike builder—student can change mind)
- **No visual "used" indicator** (that would give away distractor info)
- Validation: Cannot select same heading for two paragraphs (error: "Heading 'iii' already used for Paragraph B")

### 10.7 Question Type: Map / Diagram Labeling

**Display:**
```
Questions 28-30
Label the diagram below.
Write NO MORE THAN TWO WORDS for each answer.

┌─────────────────────────────────────────────┐
│                                             │
│          LIBRARY FLOOR PLAN                 │
│                                             │
│     ┌─────────┐                             │
│     │Reception│                             │
│     └────┬────┘                             │
│          │                                  │
│     ┌────┴────┐    ┌──────────┐             │
│     │Computer │    │   28.    │ ← Input box │
│     │  Lab    │    │ [_____]  │   positioned│
│     └─────────┘    └──────────┘             │
│          ▲                                  │
│          │                                  │
│     ┌────┴────┐    ┌──────────┐             │
│     │  29.    │    │   Café   │             │
│     │ [_____]  │    │          │             │
│     └─────────┘    └──────────┘             │
│                                             │
│                    30.                       │
│                   [_____]                    │
│              (Study Room)                    │
│                                             │
└─────────────────────────────────────────────┘
```

**Input Box Interaction:**
- Click box to focus and type
- Box highlights blue when active
- Text appears centered in box
- **Font sizing:** Auto-scales to fit (prevents overflow)
- **Character limit:** Based on instruction (e.g., 2 words max)

**Alternative: Letter Selection (if options provided):**
```
28. [▾ A B C D E F G]  ← Dropdown instead of text field
29. [▾ A B C D E F G]
30. [▾ A B C D E F G]
```

**Image Controls:**
- Click image to zoom (opens lightbox)
- In lightbox mode, input boxes still accessible (positioned overlay)
- Pinch-to-zoom on touch devices

### 10.8 Question Type: Sentence Completion / Short Answer

**Display:**
```
Q31. Complete the sentence below.
Write NO MORE THAN THREE WORDS AND/OR A NUMBER.

According to the passage, the first railway line in Britain 
was opened in the year _______________.

[_____________________________________]  ← Text input
Max: 3 words/numbers
```

**Input Field:**
- Full-width (within card padding)
- Height: 40px (comfortable clicking/tapping)
- Monospace font option? No—use sans-serif (matches rest of interface)

---

## **11. Answer Input Mechanisms**

### 11.1 Text Input Fields (General Specifications)

**Common to all text-based answer types:**

```css
.answer-input {
  border: 2px solid #D1D5DB;  /* Gray-300 */
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 16px;  /* Prevents zoom on iOS */
  line-height: 1.4;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.answer-input:focus {
  border-color: #3B82F6;  /* Blue-500 */
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  outline: none;
}

.answer-input.answered {
  border-color: #10B981;  /* Green-500 */
  background-color: #F0FDF4;  /* Green-50 */
}
```

**Behavioral Specifications:**

| Aspect | Specification |
|--------|--------------|
| **Trimming** | Auto-trim leading/trailing whitespace on blur |
| **Multiple spaces** | Collapse multiple internal spaces to single |
| **Paste** | Allow paste (Ctrl+V) but strip formatting |
| **Undo** | Ctrl+Z works within field |
| **Auto-save** | Answer saved on blur (exit field) + every 30s |
| **Clear button** | "X" icon appears on right when field has content (click to clear) |

### 11.2 Selection Inputs (Radio / Checkbox)

**Radio Buttons (Single Select):**
```
Unselected:  ○ Option text
Selected:    ● Option text
Focused:     ⟡ Option text  (keyboard focus ring)
Disabled:    ⊘ Option text  (grayed out)
```

**Checkboxes (Multi-Select):**
```
Unchecked:  ☐ Option text
Checked:     ☑ Option text
Focused:     ☒ Option text  (focus ring)
Indeterminate: ☐ (partial—rarely used)
```

**Sizing:**
- Touch target: Minimum 44x44px (mobile/tablet)
- Desktop: 24x24px icon with 8px spacing from text
- Text size: 16px (matches body text)

**Label Clickability:**
- Clicking label also toggles control (associated via `<label for="">`)
- Hover state on label: Slight background tint (#F9FAFB)

### 11.3 Dropdown Selectors

**Standard Dropdown (Matching Headings, etc.):**
```
Closed State:
[▾ Choose heading...]  ← Placeholder text, arrow icon

Open State (Expanded):
┌─────────────────────────┐
│ Choose heading...       │  ← Search/filter box (optional)
│ ─────────────────────── │
│ i. The role of...       │  ← Hover: highlight
│ ii. Innovations in...   │  ← Selected: blue bg + check
│ iii. Social impact...   │
│ iv. The importance...   │
│ v. Urban planning...    │
│ vi. Changes in agri...  │
│ vii. International...   │
└─────────────────────────┘
```

**Keyboard Navigation:**
- Enter/Space: Open dropdown
- Up/Down arrows: Navigate options
- Enter: Select highlighted option
- Escape: Close without selection

### 11.4 Special Input: Drag and Drop (Matching)

*Note: Drag-and-drop for matching questions is OPTIONAL—fallback to dropdowns for accessibility.*

**If Implemented:**
```
Headings (Drag Source):        Paragraphs (Drop Target):

[i. The role of gov...]   ──→  Paragraph A: [Drop here]
[ii. Innovations in...]        Paragraph B: [iii ✓]
[iii. Social impact...]   ──→  Paragraph C: [Drop here]
[iv. The importance...]        Paragraph D: [Drop here]

Drag i. to a paragraph to assign.
```

**Touch Support:**
- Long press (500ms) to pick up item
- Drag to target (page scrolls if near edge)
- Release to drop
- Visual ghost follows finger/cursor

---

## **12. Timer & Time Management (Student View)]

### 12.1 Timer Display Specifications

**Primary Timer (Header Bar):**

```
Normal State (>10 min):
⏱ 47:23

Warning State (5-10 min):
⏱ 07:45  ← Amber color (#F59E0B)

Critical State (<5 min):
⏱ 02:33  ← Red color (#EF4444) + subtle pulse animation
```

**Expanded Timer (Click to Expand):**
```
┌─────────────────────────────────────┐
│  🕐 Time Details                   │
│  ─────────────────────────────────  │
│                                    │
│  Module: Reading                    │
│  Allocated Time: 60:00             │
│  Time Remaining: 12:34             │
│  Time Elapsed: 47:26               │
│                                    │
│  Progress: ████████████████░░░░ 79% │
│                                    │
│  Estimated pace:                   │
│  • On track if ~1.5 min/question  │
│  • You're averaging 1.2 min/q ✅   │
│                                    │
│  [Collapse]                        │
└─────────────────────────────────────┘
```

### 12.2 Warning System

**Timeline of Warnings (for 60-minute module):**

| Time Remaining | Visual Alert | Audio | Message |
|---------------|-------------|-------|---------|
| 10:00 | Timer turns amber | Gentle chime | "10 minutes remaining" toast |
| 5:00 | Timer turns red | Two chimes | "5 minutes remaining" modal (auto-dismiss 5s) |
| 1:00 | Timer pulses red | Repeating beep (3x) | "1 minute remaining" banner |
| 0:30 | Large countdown overlay | Countdown tones | "30 seconds..." |
| 0:00 | Auto-submit triggers | Final tone | "Time's up. Submitting..." |

**Auto-Submit Modal (at 0:00):**
```
┌─────────────────────────────────────────────┐
║  ⏰ Time's Up!                              ║
║  ─────────────────────────────────────────  ║
║                                             ║
║  Your time for the Reading module has       ║
║  expired.                                   ║
║                                             ║
║  Submitting your answers now...             ║
║                                             ║
║  ████████████████████░░░░  73%              ║
║                                             ║
║  Please wait. Do not close this window.     ║
║                                             ║
└─────────────────────────────────────────────┘
```

**Grace Period (Optional, configurable):**
- Some institutions allow 30-second grace period after 0:00
- During grace: Timer shows negative "-00:15" in red
- Banner: "Time expired. Submitting in 15 seconds..."
- Allows saving last-second answers

### 12.3 Writing Module Timer (Dual-Task)

**Shared Pool Mode:**
```
Total Time: 54:23 / 60:00

Task 1: 18:45 used (recommended: 20:00)
Task 2: 35:38 used (recommended: 40:00)

⚠ Consider transitioning to Task 2 soon.
```

**Split Allocation Mode:**
```
Task 1 Timer: 01:23 / 20:00 remaining  [Active]
Task 2 Timer: 40:00 / 40:00 remaining  [Locked - starts after Task 1]
```

### 12.4 Speaking Module Timers

**Only visible during Part 2 (other parts examiner-controlled):**

**Preparation Timer (Countdown):**
```
┌─────────────────────────────┐
│  PREPARATION TIME           │
│                             │
│       00:42                 │
│  ━━━━━━━━━━━━━━━●━━━━━━━━━  │
│      70% used               │
│                             │
│  Keep preparing, or         │
│  press 'I'm Ready' if       │
│  finished early.            │
│                             │
│  [I'm Ready to Speak →]     │
└─────────────────────────────┘
```

**Speaking Timer (Count-Up):**
```
┌─────────────────────────────┐
│  SPEAKING TIME              │
│                             │
│       01:34                 │
│  ━━━━━━━━━━━━━━━━━━━●━━━━━━  │
│  77% of 2 min (good!)       │
│                             │
│  Keep speaking until        │
│  asked to stop.             │
│                             │
└─────────────────────────────┘
```

**"I'm Ready" Button (Early Start):**
- Allows student to begin speaking before prep timer hits 0
- Confirmation: "You have 18 seconds of prep time remaining. Start speaking now?"
- Useful for confident students

---

## **13. Review & Navigation Tools**

### 13.1 Question Overview Grid (Navigator Modal)

**Trigger:** Click question counter in footer `[Q 14 ▾]` or press `Esc`

**Display:**
```
┌─────────────────────────────────────────────────────────────┐
│  Question Navigator - Reading Module                        │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Filter: [All ▾] [Answered] [Unanswered] [Flagged]         │
│                                                             │
│  Passage 1 (Questions 1-13)                                 │
│  ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐  │
│  │ ✓ │ ✓ │ ✓ │ ✓ │ 🚩│ ✓ │ ✓ │ ○ │ ○ │ ○ │ ✓ │ ✓ │ ✓ │  │
│  │ 1 │ 2 │ 3 │ 4 │ 5 │ 6 │ 7 │ 8 │ 9 │10 │11 │12 │13 │  │
│  └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘  │
│                                                             │
│  Passage 2 (Questions 14-26)                                 │
│  ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐  │
│  │ ✓ │ ✓ │ 🚩│ ✓ │ ○ │ ○ │ ○ │ ○ │ ○ │ ○ │ ○ │ ○ │ ○ │  │
│  │14 │15 │16 │17 │18 │19 │20 │21 │22 │23 │24 │25 │26 │  │
│  └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘  │
│                                                             │
│  Passage 3 (Questions 27-40)                                 │
│  ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐│
│  │ ○ │ ○ │ ○ │ ○ │ ○ │ ○ │ ○ │ ○ │ ○ │ ○ │ ○ │ ○ │ ○ │ ○ ││
│  │27 │28 │29 │30 │31 │32 │33 │34 │35 │36 │37 │38 │39 │40 ││
│  └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘│
│                                                             │
│  Legend:                                                    │
│  ✓ Answered (28)  ○ Unanswered (12)  🚩 Flagged (2)        │
│  Current: Q8                                               │
│                                                             │
│  [Close Navigator] (or press Esc)                           │
└─────────────────────────────────────────────────────────────┘
```

**Grid Cell Specifications:**
- Size: 48x48px (touch-friendly)
- **Answered:** Green background (#10B981), white checkmark
- **Unanswered:** Gray background (#F3F4F6), black number
- **Flagged:** Amber background (#F59E0B), flag icon + number
- **Current:** Blue border (2px solid #3B82F6) around cell
- **Hover:** Darken slightly, tooltip shows question preview

**Keyboard Navigation in Grid:**
- Arrow keys move between cells
- Enter jumps to selected question
- `A` key filters to answered only
- `U` key filters to unanswered only
- `F` key filters to flagged only

### 13.2 Flag for Review Feature

**Purpose:** Mark questions student wants to revisit (non-blocking).

**Toggle Mechanism:**
- Click `[🚩 Flag]` button in footer (toggles on/off)
- Or right-click question → "Flag for review"
- Or keyboard shortcut: `F` key

**Visual Indicators:**
1. **Footer button:** Turns orange when current question flagged
2. **Navigator grid:** Cell shows flag icon
3. **Question card:** Small orange flag icon in corner:
   ```
   ╭──────────────────────────────╮
   │ Q14. [Question text...]  🚩  │  ← Flag badge
   ╰──────────────────────────────╯
   ```

**Behavior:**
- Flag does **not** prevent submission
- If submitting with flagged questions:
  ```
  ┌─────────────────────────────────────┐
  │  You have 2 flagged questions.      │
  │                                     │
  │  Flagged questions are ones you     │
  │  wanted to review. You can still    │
  │  submit, or go back to check them.  │
  │                                     │
  │  [Review Flagged]  [Submit Anyway]  │
  └─────────────────────────────────────┘
  ```
- Maximum flags: Unlimited (but grid shows count)

### 13.3 Search in Questions (Ctrl+Shift+F)

**Scope:** Search within question stems (not answers, not passage).

**Display:**
```
┌─────────────────────────────────────────────┐
│  🔍 Search Questions                       │
│  [____________________________] 3 results  │
│                                             │
│  Results for "coal":                        │
│                                             │
│  Q3: "...availability of coal and iron..."  │
│     Passage 1, T/F/NG block  [Go to Q3 →]  │
│                                             │
│  Q18: "...including coal and iron ore."      │
│     Passage 1, Cloze completion  [Go→]      │
│                                             │
│  Q24: "...coal-powered machinery..."         │
│     Passage 2, Sentence completion  [Go→]    │
│                                             │
│  [Close]                                    │
└─────────────────────────────────────────────┘
```

**Use Case:** Student remembers keyword wants to find related question quickly.

### 13.4 Previous / Next Navigation

**Button States:**

| Situation | Previous Button | Next Button |
|-----------|----------------|-------------|
| On Q1 (first) | Disabled (gray) | Enabled → Q2 |
| On Q40 (last) | Enabled → Q39 | Text: "Review" |
| All answered | Normal | Text: "Submit" |

**Smooth Scroll:**
When clicking Next/Previous:
- Question pane scrolls smoothly to next question (300ms ease-out)
- New question gets brief highlight (yellow background fade, 500ms)
- Stimulus pane maintains position (does NOT auto-scroll—student controls)

**Keyboard Shortcuts:**
- `Alt + →` or `Right Arrow`: Next question
- `Alt + ←` or `Left Arrow`: Previous question
- (Arrow keys alone navigate within input fields/dropdowns when focused)

---

## **14. Accessibility for Test-Takers]

### 14.1 WCAG 2.1 AA Compliance (Strict Requirement)

**Rationale:** Examinations must be accessible to students with disabilities under most jurisdictions' anti-discrimination laws.

### 14.2 Visual Accessibility

**Font Size Adjustment:**
- Persistent setting: `[🔍 Text Size]` in header
- Range: 14px (Small) → 18px (Default) → 22px (Large) → 26px (Extra Large)
- Applies to ALL text (passage, questions, UI)
- **Persists across modules** (set once, applies everywhere)
- **Reflow capability:** When text enlarged, layout adjusts (no horizontal scroll)

**Color Contrast Modes:**
```
Settings → Appearance → Color Mode:

○ Standard (Black on white, high contrast)
○ Dark Mode (White on dark gray, reduced glare)
○ High Contrast (Black on white, increased contrast ratios)
○ Custom (Upload institution-approved theme)
```

**Dark Mode Example:**
```
Background: #1F2937 (Gray-800)
Text: #F9FAFB (Gray-50)
Stimulus pane: #111827 (Gray-900)
Question pane: #1F2937 (Gray-800)
Borders: #374151 (Gray-700)
Accent: #60A5FA (Blue-400)
```

**Color Blindness Support:**
- Never rely solely on color to convey information
- Always pair color with icon/text:
  - ✅ "✓ Answered" (green + checkmark)
  - ✅ "🚩 Flagged" (amber + flag icon)
  - ❌ Just green/red circles (avoid)

**Highlight Colors (Adjustable):**
- Default: Yellow highlight
- Alternatives for different vision needs:
  - Orange (higher visibility)
  - Blue (for deuteranopia-friendly)
  - Pink (for protanopia-friendly)
  - Underline-only (no color, just decoration)

### 14.3 Motor Accessibility

**Keyboard Navigation (Full Coverage):**

| Element | Focus Method | Activate Method |
|---------|-------------|-----------------|
| Question fields | Tab / Shift+Tab | Enter/Space |
| Radio buttons | Arrow keys | Space/Enter |
| Checkboxes | Arrow keys | Space |
| Dropdowns | Enter (open), arrows (navigate), Enter (select) | - |
| Text inputs | Tab into | Type |
| Buttons | Tab to | Enter/Space |
| Navigator grid | Tab into, arrows move, Enter selects | - |
| Highlight tool | (Requires text selection first—mouse/touch) | - |

**Touch Target Sizes:**
- Minimum 44x44px for all interactive elements
- Generous padding on buttons (12px vertical, 16px horizontal)
- Spacing between clickable items (minimum 8px gap)

**Motor Impairment Assist Mode:**
```
Settings → Accessibility → Motor Assist:

[✓] Increase touch targets (buttons 56x56px minimum)
[✓] Disable hover-triggered menus (all click-to-open)
[✓] Extend click timing (ignore accidental double-clicks)
[✓] Sticky keys (allow modifier key press, then separate key press)
```

### 14.4 Cognitive Accessibility

**Plain Language UI:**
- All instructions written at Grade 8 reading level (simple vocabulary, short sentences)
- Technical terms defined on first use
- Consistent terminology (never call it "block" in one place, "section" in another)

**Distraction-Free Mode:**
```
Settings → Focus Mode:

[✓] Enable Focus Mode
   - Hides footer bar (use keyboard shortcuts instead)
   - Removes decorative elements
   - Increases whitespace
   - Dimmes non-active areas (slight opacity reduction)
   - Shows only current question (hides others until navigated)
```

**Time Accommodations (Admin-Configurable):**
- Extended time (+25%, +50%, +100%) for eligible students
- Configured before exam (not changeable by student)
- Timer reflects adjusted time (e.g., 90 minutes instead of 60 for Reading)
- **Subtle indicator** (not visible to other students if in shared room):
  ```
  ⏱ 72:00 (Extended Time)
  ```

**Break/Pause Functionality (If Allowed):**
- Pause button freezes timer (configurable by admin)
- Counter shows: "Paused. Break time: 05:00 used (max 15:00)"
- Screen dims (shows "Exam Paused" overlay)
- Resume requires confirmation

### 14.5 Screen Reader Optimization

**ARIA Implementation:**

**Page Structure:**
```html
<div role="main" aria-label="Reading examination">
  <div role="region" aria-label="Reading passage stimulus">
    <!-- Passage content -->
  </div>
  
  <div role="region" aria-label="Questions and answers" 
       aria-live="polite">
    <!-- Questions -->
  </div>
</div>

<header role="banner" aria-label="Exam header">
  Timer, progress, tools
</header>

<nav role="navigation" aria-label="Question navigation">
  Footer controls
</nav>
```

**Question Announcement:**
When navigating to Q14:
```
Screen reader output:
"Question 14 of 40. True, False, or Not Given.
Statement: The Industrial Revolution began in France.
Currently unanswered. Select True, False, or Not Given."
```

**Status Updates (Live Regions):**
- Timer updates every minute (not every second—too verbose):
  `"47 minutes remaining"`
- Answer saved: `"Answer saved for Question 14"`
- Flag toggled: `"Question 14 flagged for review"`

**Image Descriptions:**
All images (diagrams, maps, charts) require alt text:
- Created provides alt text during building (enforced)
- Screen reader reads: `"Diagram: Library floor plan. See description below for details."`
- Long description available: `[Read detailed description]` button (expands full text)

**Audio Alternative for Visual Content:**
- For map/diagram questions: Written description of positions
- Example: `"Question 28 refers to the input box located in the center of the diagram, between the Computer Lab and Café."`

### 14.6 Hearing Accessibility

**Visual Alternatives to Audio Cues:**

| Audio Cue | Visual Alternative |
|-----------|-------------------|
| Timer warning chime | Timer flashes/bounces + banner |
| Auto-submit countdown | Large overlay countdown + progress bar |
| Speaking test start chime | "Begin now" banner + timer starts |
| Error sound | Red border shake + error message |

**Transcript Availability:**
- For Listening module: Transcript available (if enabled by admin)
- For Speaking module: Real-time captioning of examiner (if remote test)

---

## **15. Error Handling & Edge Cases]

### 15.1 Connectivity Issues

**Detection:**
- WebSocket heartbeat every 10 seconds
- If 3 consecutive heartbeats fail: "Connection unstable" warning

**Warning States:**

**Level 1 (Minor - Latency spike):**
```
┌─────────────────────────────────────────────┐
│  🔄 Slow Connection Detected                │
│                                             │
│  Your internet connection is slower than    │
│  usual. Your answers are being saved        │
│  locally and will sync when connection      │
│  improves.                                  │
│                                             │
│  Last synced: 2 minutes ago                 │
│  [Dismiss]                                  │
└─────────────────────────────────────────────┘
```
- **Behavior:** Continue exam normally, queue saves locally
- **Banner:** Non-intrusive, amber, auto-dismisses when resolved

**Level 2 (Moderate - Intermittent drops):**
```
┌─────────────────────────────────────────────┐
│  ⚠️ Connection Interrupted                  │
│                                             │
│  Your internet connection has been lost.    │
│                                             │
│  • You can continue working on the exam     │
│  • Your answers are being saved locally     │
│  • The timer continues running              │
│                                             │
│  Attempting to reconnect... (Attempt 2 of 5)│
│                                             │
│  ⏱ Time remaining: 34:12                    │
│                                             │
│  [Troubleshoot Connection]                  │
└─────────────────────────────────────────────┘
```
- **Behavior:** Exam fully functional offline (local storage)
- **Timer:** Continues (JavaScript-based, not server-dependent)
- **Retry logic:** Every 15 seconds, up to 5 attempts (75 sec total)
- **If all fail:** Escalate to Level 3

**Level 3 (Severe - Extended outage):**
```
┌─────────────────────────────────────────────┐
│  🔴 Unable to Reconnect                     │
│                                             │
│  We cannot restore your connection.         │
│                                             │
│  OPTIONS:                                   │
│                                             │
│  1. Continue Offline (Recommended)          │
│     - Keep working until connection returns │
│     - All data saved locally                │
│     - Timer still running                  │
│                                             │
│  2. Pause Exam (If permitted by rules)      │
│     - Freeze timer                         │
│     - Contact technical support            │
│                                             │
│  3. Save & Exit (Last Resort)              │
│     - Export your answers as file          │
│     - Contact exam center to resume        │
│                                             │
│  [Continue Offline] [Pause] [Save & Exit]  │
└─────────────────────────────────────────────┘
```

**Reconnection Recovery:**
```
✅ Connection Restored!

Syncing your answers to server...
████████████████████████ 100%

All answers saved successfully. 12 answers uploaded.
Please continue your exam.

[Continue]  (auto-dismisses in 5 seconds)
```

### 15.2 Browser/Tab Management

**Prevent Accidental Closure:**
```javascript
window.addEventListener('beforeunload', (e) => {
  e.preventDefault();
  e.returnValue = ''; // Required for Chrome
  return 'You have an exam in progress. Are you sure you want to leave?';
});
```

**Message:**
```
┌─────────────────────────────────────────────┐
│  Are you sure you want to leave?            │
│                                             │
│  You have an active examination in progress:│
│  • Module: Reading                          │
│  • Time remaining: 23:45                    │
│  • Questions answered: 28/40                │
│                                             │
│  If you leave, your timer will continue     │
│  running and you may lose time.             │
│                                             │
│  [Leave Page]  [Stay on Exam]               │
└─────────────────────────────────────────────┘
```

**Tab Duplication Prevention:**
- Detect second tab opening (via sessionStorage lock)
- Show warning: "Exam already open in another tab. This tab will be disabled."
- Disable interaction in duplicate tab

**Browser Refresh:**
- Same as closure prevention
- On confirmed refresh: Restore state from localStorage (last save)

### 15.3 Device/Hardware Issues

**Camera/Microphone Failure (Speaking Module):**
```
┌─────────────────────────────────────────────┐
│  🎤 Microphone Not Working                  │
│                                             │
│  We cannot detect your microphone. The      │
│  Speaking module requires audio capture.    │
│                                             │
│  Troubleshooting:                           │
│  • Check microphone is plugged in           │
│  • Grant browser microphone permission      │
│  • Try a different microphone               │
│                                             │
│  [Test Again] [Use Phone as Mic] [Help]     │
└─────────────────────────────────────────────┘
```

**Screen Size Too Small:**
```
┌─────────────────────────────────────────────┐
│  📱 Screen Size Recommendation              │
│                                             │
│  Your screen resolution (1024x768) is       │
│  smaller than recommended (1366x768).       │
│                                             │
│  You can continue, but some elements may    │
│  require scrolling.                         │
│                                             │
│  Recommendations:                            │
│  • Rotate device to landscape (tablet)      │
│  • Connect external monitor                 │
│  • Zoom out (browser Ctrl/Cmd + -)          │
│                                             │
│  [Continue Anyway] [Don't Show Again]       │
└─────────────────────────────────────────────┘
```

**Battery Low:**
```
⚠️ Battery Critical (12%)

Consider connecting power adapter. If your device
shuts down, contact your exam center immediately.
[Dismiss]
```

### 15.4 Input Validation Errors

**Invalid Answer Submission Attempts:**

**Too Many Words (Cloze Question):**
```
Q18: "the united kingdom of great britain"
⚠ Maximum 2 words allowed. You entered 7 words.
   Please shorten your answer.
   [Edit Answer]
```

**Invalid Characters:**
```
Q19: "banking$$$"
⚠ Invalid characters detected ($).
   Only letters, numbers, hyphens, and spaces are allowed.
   [Edit Answer]
```

**Duplicate Selection (Matching Headings):**
```
Paragraph B: Heading "iii" already assigned to Paragraph A.
Each heading can only be used once.
[Choose Different Heading]
```

### 15.5 System Crashes

**Crash Recovery Protocol:**

On reload after crash:

```
┌─────────────────────────────────────────────┐
│  🔄 Recovering Your Exam Session            │
│                                             │
│  We detected that your previous session      │
│  ended unexpectedly.                        │
│                                             │
│  Recovering data...                          │
│  ████████████████████░░░░  82%              │
│                                             │
│  Last saved state:                           │
│  • Module: Reading                           │
│  • Time when saved: 14:32:05                │
│  • Questions answered: 27/40                │
│  • Time remaining: 26:45                    │
│                                             │
│  Please wait while we restore your progress.│
│                                             │
└─────────────────────────────────────────────┘
```

**Recovery Success:**
- Restore to exact question being viewed
- Restore all answers
- **Timer adjustment:** Deduct elapsed crash time (fairness)
- Log incident for administrator review

**Recovery Failure (Data Corruption):**
```
┌─────────────────────────────────────────────┐
│  ⚠️ Partial Recovery                        │
│                                             │
│  We restored part of your exam data.        │
│                                             │
│  Recovered:                                  │
│  • Module: Reading (correct)                │
│  • Answers for Q1-22 restored               │
│  • Answers for Q23-40: NOT FOUND            │
│                                             │
│  Your timer has been extended by 10 minutes  │
│  to compensate for lost time.               │
│                                             │
│  Please verify your answers and complete    │
│  missing questions.                          │
│                                             │
│  [Contact Support] [Continue Exam]          │
└─────────────────────────────────────────────┘
```

---

## **16. Post-Submission Flow]

### 16.1 Submission Confirmation (Per Module)

**Initial Trigger:**
- Student clicks "Submit" button OR
- Timer reaches 0:00 (auto-submit)

**Confirmation Modal:**
```
┌─────────────────────────────────────────────────────────────┐
│  Submit Reading Module?                                     │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Please review before submitting:                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Questions Answered:    38 / 40                      │   │
│  │  Questions Unanswered:  2                             │   │
│  │  Questions Flagged:     3                             │   │
│  │                                                     │   │
│  │  Unanswered Questions:                               │   │
│  │  • Q29 (Sentence Completion)                        │   │
│  │  • Q35 (Matching Headings)                           │   │
│  │                                                     │   │
│  │  Time Remaining: 07:23 (will be forfeited)          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ⚠ You cannot return to this module after submission.     │
│                                                             │
│  [Return to Exam]                    [Confirm Submission]  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Modal Behavior:**
- **No timeout** (student can take time to decide)
- **Return to Exam:** Closes modal, resumes where left off
- **Confirm Submission:** Locks answers, initiates upload

### 16.2 Upload Progress

**After Confirmation:**
```
┌─────────────────────────────────────────────────────────────┐
│  Submitting Reading Module...                                │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Encrypting answers...        ✅ Complete                   │
│  Validating completeness...   ✅ Complete                   │
│  Uploading to server...       ████████████████░░ 78%        │
│                                                             │
│  ⏱ Please wait. Do not close this window.                  │
│                                                             │
│  Estimated time remaining: 4 seconds                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**On Successful Upload:**
```
✅ Reading Module Submitted Successfully!

Your answers have been received and secured.
Preparing next module...
```

**On Failed Upload:**
```
⚠ Upload Failed

Your answers could not be uploaded due to a connection issue.
They have been saved securely on your device.

Options:
[Retry Upload] [Save Locally & Contact Support]
```

### 16.3 Final Exam Completion (After Speaking)

**Completion Screen:**
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│           🎉 Examination Complete!                          │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Congratulations! You have completed all modules of the     │
│  IELTS examination.                                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Submission Summary:                                │   │
│  │                                                     │   │
│  │  🎧 Listening    ✅ Submitted at 10:34 AM          │   │
│  │     Questions: 40/40 answered                      │   │
│  │                                                     │   │
│  │  📚 Reading      ✅ Submitted at 11:42 AM          │   │
│  │     Questions: 39/40 answered (1 skipped)          │   │
│  │                                                     │   │
│  │  ✍️ Writing      ✅ Submitted at 12:48 PM          │   │
│  │     Task 1: 167 words  |  Task 2: 289 words        │   │
│  │                                                     │   │
│  │  🗣️ Speaking      ✅ Completed at 01:15 PM         │   │
│  │     Parts 1-3 all completed                       │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  What happens next:                                         │
│  • Your responses will be graded by certified examiners    │
│  • Results typically available within 13 days               │
│  │  You will be notified by your test center               │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Feedback (Optional):                                       │
│  How was your online exam experience?                       │
│  😞 😐 😊 😃                                              │
│  [Leave comments...]                                       │
│                                                             │
│  [Exit Exam Platform]                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Post-Exam Survey (Optional):**
- Collect UX feedback for platform improvement
- Anonymous unless student chooses to identify
- Questions:
  - Ease of navigation (1-5)
  - Clarity of instructions (1-5)
  - Technical issues encountered (Yes/No + description)
  - Likelihood to recommend digital IELTS (NPS)
  - Open comments

### 16.4 Data Retention & Privacy Notice

```
┌─────────────────────────────────────────────┐
│  📋 Data & Privacy Information              │
│  ─────────────────────────────────────────  │
│                                             │
│  Your exam data:                             │
│  • Encrypted during transmission & storage   │
│  • Retained for 2 years (standard)          │
│  • Accessible only to authorized graders    │
│  • Used solely for assessment purposes      │
│                                             │
│  Your rights:                                │
│  • Request copy of your responses           │
│  • Request data deletion (after retention)  │
│  • Lodge complaint with data protection      │
│   officer                                   │
│                                             │
│  [Full Privacy Policy] [Close]              │
└─────────────────────────────────────────────┘
```

---

## **17. Responsive Design: Student Devices]

### 17.1 Device Strategy Matrix

| Device | Suitability | Layout Adaptation | Feature Limitations |
|--------|------------|------------------|-------------------|
| **Desktop (1440px+)** | ✅ Optimal | Full dual-pane, all features | None |
| **Laptop (1366px+)** | ✅ Good | Dual-pane, compact toolbar | Minor compression |
| **Tablet Landscape (1024px+)** | ⚠️ Acceptable | Stacked panes or narrow dual-pane | Smaller text, touch-only |
| **Tablet Portrait (768px)** | ⚠️ Functional | Single-pane with tabs | No simultaneous view |
| **Phone ( < 768px)** | ❌ Not Recommended | Heavy compromises | Strong discouragement banner |

### 17.2 Tablet Adaptation (1024x768)

**Layout: Stacked Vertical**

```
╔═════════════════════════════════════════════════════╗
║  📚 READING           ⏱ 34:21    18/40    🔧      ║
╠═════════════════════════════════════════════════════╣
║                                                   ║
║  [Passage] [Questions]  ← Tab Switcher             ║
║  ─────────────────────────────────────────────    ║
║                                                   ║
║  ┌─────────────────────────────────────────────┐  ║
║  │                                             │  ║
║  │  ACTIVE TAB CONTENT                        │  ║
║  │  (Either passage OR questions,             │  ║
║  │   not both simultaneously)                 │  ║
║  │                                             │  ║
║  │  Full width available                      │  ║
║  │                                             │  ║
║  └─────────────────────────────────────────────┘  ║
║                                                   ║
║  Swipe left/right to switch tabs (gesture)        ║
║                                                   ║
╠═════════════════════════════════════════════════════╣
║  [◀ Prev] [Q 18 ▾] [▶ Next] [🚩] [🔍]          ║
╚═════════════════════════════════════════════════════╝
```

**Touch Optimizations:**
- Larger tap targets (48x48px minimum)
- Gesture support:
  - Swipe between questions (left/right)
  - Pinch to zoom (passage/image)
  - Long press to flag
- Touch keyboard doesn't obscure input (scroll into view)
- No hover-dependent interactions (all click/tap activated)

### 17.3 Mobile Phone Adaptation (< 768px)

**Strong Discouragement Banner:**
```
┌─────────────────────────────────────────────┐
│  📱 Device Recommendation                   │
│  ─────────────────────────────────────────  │
│                                             │
│  For the best experience, please take this  │
│  exam on a tablet, laptop, or desktop       │
│  computer.                                  │
│                                             │
│  Mobile phones have limited screen space     │
│  which makes it difficult to view both the  │
│  reading passage and questions together.    │
│                                             │
│  [Continue to Mobile View Anyway]           │
│  [Switch Device / Exit]                     │
└─────────────────────────────────────────────┘
```

**If Student Proceeds (Mobile View):**

```
╔═════════════════════════════════════════╗
║  📚 Reading    ⏱ 34:21    18/40   [≡]  ║
╠═════════════════════════════════════════╣
║                                         ║
║  ┌───────────────────────────────────┐  ║
║  │  Q18. Complete the text below:   │  ║
║  │                                   │  ║
║  │  The revolution began in         │  ║
║  │  _______________ (18).           │  ║
║  │                                   │  ║
║  │  [___________________]           │  ║
║  │  Max: 2 words                    │  ║
║  └───────────────────────────────────┘  ║
║                                         ║
║  ─────────────────────────────────────  ║
║                                         ║
║  [View Passage ↓]                       │  ║
║  (Collapsible, shows when tapped)       │  ║
║  ┌───────────────────────────────────┐  ║
║  │  Paragraph A: The term           │  ║
║  │  'Industrial Revolution'...      │  ║
║  │  [Tap to collapse]               │  ║
║  └───────────────────────────────────┘  ║
║                                         ║
╠═════════════════════════════════════════╣
║  [← Q17]  [Q18]  [Q19 →]  [🚩 Flag]   ║
╚═════════════════════════════════════════╝
```

**Mobile Limitations:**
- **No split-screen** (passage and questions never visible simultaneously)
- **Accordion pattern:** Tap to expand/collapse passage or questions
- **Reduced toolbar:** Hamburger menu for tools
- **Simplified navigator:** List view instead of grid
- **No drag-and-drop** (button-based alternatives)
- **No highlighter tool** (or simplified version: tap word → toggle highlight)
- **No print/export** (not applicable)

**Mobile-Specific Aids:**
- **Floating Action Button (FAB):** Quick access to common actions
  ```
  [+] FAB expands to:
      - Flag question
      - Go to navigator
      - Zoom controls
      - Settings
  ```
- **Bottom sheet modals** (instead of dialogs)
- **Thumb-friendly zones** (interactive elements in lower 60% of screen)

### 17.4 Cross-Device Consistency Principles

Despite layout differences, maintain consistency:

| Aspect | Rule |
|--------|------|
| **Question numbering** | Identical across devices |
| **Answer validation** | Same rules, same error messages |
| **Timer behavior** | Same warnings, same auto-submit |
| **Color coding** | Same semantic colors (green=answered, etc.) |
| **Keyboard shortcuts** | Where physical keyboard exists |
| **Progress tracking** | Same counters and calculations |
| **Submission flow** | Same confirmation steps |

---

## **Appendix A: Student Interface Component Inventory**

### Atomic Components (Student-Facing)

**Display Components:**
- **Timer Badge** (countdown/count-up, color-changing)
- **Progress Counter** (X/Y format)
- **Status Pill** (Answered/Unanswered/Flagged badges)
- **Module Tab** (icon + name, locked/unlocked states)
- **Question Number** (bold, sequential)
- **Instruction Block** (lighter text, smaller size)

**Input Components:**
- **Text Answer Field** (single-line, character-limited)
- **Radio Group** (single-select MCQ)
- **Checkbox Group** (multi-select MCQ)
- **Select Dropdown** (matching, letter selection)
- **Image Hotspot Input** (click-to-type on diagram)

**Feedback Components:**
- **Toast Notification** (brief messages, auto-dismiss)
- **Modal Dialog** (confirmations, warnings)
- **Error Inline** (below input field, red)
- **Success Checkmark** (animation on save)
- **Warning Banner** (amber, dismissible)

**Navigation Components:**
- **Breadcrumb Trail** (location hierarchy)
- **Pager Buttons** (Previous/Next)
- **Grid Navigator** (question overview matrix)
- **Tab Switcher** (Passage/Questions on mobile)
- **Sticky Header/Footer** (fixed position)

**Media Components:**
- **Audio Player** (waveform, controls, timer)
- **Image Viewer** (zoom, pan, lightbox)
- **Video Feed** (Speaking module, webcam)
- **Waveform Visualizer** (audio timeline)

### Composite Components

**Reading Workspace:**
- Contains: Stimulus pane + Question pane + Toolbar + Footer
- Layout: Side-by-side (desktop) or stacked (tablet/mobile)

**Listening Workspace:**
- Contains: Audio player + Scrolling questions + Transcript toggle
- Layout: Audio fixed top, questions below

**Writing Workspace:**
- Contains: Prompt display + Rich text editor + Word count + Task switcher
- Layout: Full-width editor, collapsible prompt

**Speaking Workspace:**
- Contains: Video feeds + Cue card display + Timer + Recording indicator
- Layout: Video-centric, overlaid controls

---

## **Appendix B: Student User Flows**

### Flow 1: Completing Reading Module (Happy Path)

```
START (Reading Module Begins)
    │
    ▼
[Timer Starts: 60:00]
    │
    ▼
[Passage 1 Displays in Left Pane]
[Questions 1-13 Display in Right Pane]
    │
    ▼
[Student Reads Passage 1]
    │
    ├── Uses highlighter on key phrases
    ├── Adds sticky note: "Check Q7 against para B"
    └── Scrolls through all paragraphs
    │
    ▼
[Answers Q1-6 (T/F/NG)]
    │
    ├── Clicks TRUE for Q1
    ├── Clicks FALSE for Q2
    ├── Flags Q5 (unsure) → 🚩 appears
    └── Clicks NG for Q6
    │
    ▼
[Answers Q7-13 (Matching Headings)]
    │
    ├── Selects "iii" for Paragraph A
    ├── Selects "i" for Paragraph B
    └── Struggles on Paragraph E → flags Q11
    │
    ▼
[Clicks "Passage 2" or scrolls down]
    │
    ▼
[Passage 2 Displays; Questions 14-26 Appear]
    │
    ├── [Repeats process for Passage 2]
    └── [Repeats process for Passage 3]
    │
    ▼
[Timer Shows: 08:45 remaining]
    │
    ▼
[Opens Navigator Grid (Esc or click counter)]
    │
    ├── Sees: 38/40 answered, 2 blank (Q29, Q35), 3 flagged
    ├── Clicks Q29 → jumps to question
    ├── Reviews passage, enters answer
    └── Clicks Q35 → reviews, enters answer
    │
    ▼
[40/40 Answered]
    │
    ▼
[Clicks "Submit Reading" button]
    │
    ▼
[Confirmation Modal Appears]
    │
    ├── Reviews summary: 40/40 answered, 3 flagged
    ├── Decides to check flagged Q5 and Q11 again
    └── Clicks "Return to Exam"
    │
    ▼
[Reviews Q5 and Q11, confirms original answers]
    │
    ▼
[Clicks "Submit Reading" again]
    │
    ▼
[Confirms Submission]
    │
    ▼
[Upload Progress: Encrypting → Validating → Uploading]
    │
    ▼
[✅ Success! Transition to Writing Module...]
    │
    END OF READING MODULE
```

### Flow 2: Handling Technical Difficulty (Listening Module)

```
START Listening Module
    │
    ▼
[Audio Plays Part 1 Normally]
[Student Answers Q1-10]
    │
    ▼
[⚠ Connection Lost Banner Appears]
    │
    ▼
[Audio Continues Playing (buffered)]
[Student Continues Answering Q11-15]
    │
    ▼
[Audio Reaches Buffer End → Pauses]
    │
    ▼
["Connection Interrupted" Modal - Level 2]
    │
    ├── Shows: "Attempting to reconnect... (Attempt 1 of 5)"
    ├── Timer continues: 18:34 remaining
    └── Student continues reviewing Q1-15 answers
    │
    ▼
[After 30 Seconds...]
    │
    ▼
[✅ Connection Restored Banner]
    │
    ├── "Syncing answers... 100%"
    ├── Audio resumes at correct position
    └── Student continues exam normally
    │
    ▼
[Completes Listening Normally]
    │
    END (with logged incident for admin review)
```

### Flow 3: Time Panic Scenario (Writing Module)

```
START Writing Module (60 minutes)
    │
    ▼
[Works on Task 1 for 25 minutes]
    │
    ▼
[Switches to Task 2]
    │
    ▼
[Writes essay... loses track of time]
    │
    ▼
[Timer: 05:00 Remaining]
    │
    ├── Timer turns RED + pulses
    ├── Chime sounds (2 times)
    └── Banner: "5 minutes remaining"
    │
    ▼
[Student rushes to finish conclusion]
    │
    ▼
[Timer: 01:00 Remaining]
    │
    ├── Timer pulses faster
    ├── Repeating beep (3 beeps)
    └── Banner: "1 minute remaining"
    │
    ▼
[Types final sentence]
    │
    ▼
[Timer: 00:15 Remaining]
    │
    ├── Large countdown overlay: "15..."
    ├── Countdown tones each second
    └── Student reviews quickly, sees word count: 247/250 min
    │
    ▼
[Timer Hits 00:00]
    │
    ▼
[Auto-Submit Triggers]
    │
    ├── "Time's Up! Submitting..." modal
    ├── Progress bar: uploading
    └── Success: Writing submitted
    │
    ▼
[Transition to Speaking Module]
    │
    END (stressful but successful)
```

---

## **Appendix C: Design Token Reference (Student Interface)**

### Colors

```css
/* Semantic Colors (Student-Facing) */
--color-success: #10B981;      /* Answered correctly indicators */
--color-warning: #F59E0B;      /* Timer warnings, flags */
--color-error: #EF4444;        /* Errors, critical timer */
--color-info: #3B82F6;         /* Interactive elements, links */

/* Neutral Palette */
--color-bg-primary: #FFFFFF;    /* Main background */
--color-bg-secondary: #F9FAFB;  /* Pane backgrounds */
--color-bg-tertiary: #F3F4F6;   /* Card backgrounds */
--color-text-primary: #111827;  /* Main text */
--color-text-secondary: #6B7280;/* Secondary text, instructions */
--color-text-muted: #9CA3AF;    /* Placeholders, metadata */

/* Module Accents (Subtle, Professional) */
--color-listening: #3B82F6;     /* Blue - used sparingly */
--color-reading: #10B981;       /* Green */
--color-writing: #F59E0B;       /* Amber */
--color-speaking: #EF4444;      /* Red */

/* State Colors */
--color-answer-unanswered: #E5E7EB;  /* Gray-300 */
--color-answer-selected: #3B82F6;    /* Blue-500 */
--color-answer-flagged: #F59E0B;     /* Amber-500 */
--color-answer-current: #EFF6FF;     /* Blue-50 (bg) */

/* Dark Mode Overrides */
--dm-bg-primary: #1F2937;
--dm-bg-secondary: #111827;
--dm-text-primary: #F9FAFB;
--dm-text-secondary: #D1D5DB;
```

### Typography

```css
/* Font Families */
--font-serif: 'Georgia', 'Times New Roman', serif;  /* Passages */
--font-sans: 'Inter', -apple-system, sans-serif;    /* UI, Questions */
--font-mono: 'JetBrains Mono', monospace;            /* Code, word counts */

/* Scale */
--text-xs: 0.75rem;   /* 12px - Metadata, labels */
--text-sm: 0.875rem;  /* 14px - Instructions, options */
--text-base: 1rem;    /* 16px - Body text, questions */
--text-lg: 1.125rem;  /* 18px - Emphasis, passage text */
--text-xl: 1.25rem;   /* 20px - Headings */
--text-2xl: 1.5rem;   /* 24px - Module titles */

/* Weights */
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
```

### Spacing

```css
--space-xs: 4px;
--space-sm: 8px;
--space-md: 16px;
--space-lg: 24px;
--space-xl: 32px;
--space-xxl: 48px;

/* Layout-specific */
--pane-gap: 0px;           /* No gap between split panes (divider handles it) */
--card-padding: 20px;
--question-gap: 24px;      /* Between question cards */
```

### Shadows & Elevation

```css
--shadow-card: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
--shadow-modal: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
--shadow-dropdown: 0 4px 6px -1px rgba(0,0,0,0.1);

/* Focus Rings */
--focus-ring: 0 0 0 3px rgba(59, 130, 246, 0.15);  /* Blue glow */
--focus-ring-error: 0 0 0 3px rgba(239, 68, 68, 0.15);  /* Red */
```

### Transitions & Animation

```css
/* Durations */
--duration-fast: 150ms;
--duration-base: 250ms;
--duration-slow: 350ms;

/* Easing */
--ease-default: cubic-bezier(0.4, 0, 0.2, 1);
--ease-in: cubic-bezier(0.4, 0, 1, 1);
--ease-out: cubic-bezier(0, 0, 0.2, 1);
--ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);

/* Animations */
@keyframes pulse-subtle {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

/* Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## **Document Version History**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024 | UX Team | Initial comprehensive specification - Student Interface |

---

## **End of Document**

**Status:** Ready for Development Handoff  
**Related Documents:**
- IELTS Exam Builder UX/UI Specification (Creator Interface) - Companion Document
- IELTS Technical Architecture Documentation
- IELTS Accessibility Compliance Checklist
- IELTS Data Security & Encryption Standards

**Next Steps:**
1. Design review with stakeholders (focus on student anxiety reduction)
2. Prototype development (high-fidelity interactive prototype)
3. Usability testing with actual IELTS candidates (critical demographic)
4. Accessibility audit (WCAG 2.1 AA certification)
5. Developer implementation sprints
6. Pilot testing with partner institutions
7. QA against acceptance criteria in this document

---

*This document represents the complete UX/UI specification for the IELTS Examination student-facing platform. All interactions, layouts, components, and behaviors described herein should be treated as requirements for development unless explicitly marked as optional or aspirational.*

*Special attention must be paid to the psychological state of test-takers: anxiety management, clarity of interface, forgiveness of errors, and accessibility are not "nice-to-haves"—they are fundamental to valid assessment outcomes.*
