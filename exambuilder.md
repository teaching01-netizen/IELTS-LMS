# **IELTS Exam Builder: Comprehensive UX/UI Specification Document**

## **Document Overview**

**Version:** 1.0  
**Type:** Product Design Specification (PDS)  
**Target Audience:** Product Managers, UI/UX Designers, Frontend Developers, QA Engineers  
**Scope:** Complete user experience design for an IELTS-specific examination creation platform

---

## **Table of Contents**

1. [Executive Summary](#1-executive-summary)
2. [Design Philosophy & Core Principles](#2-design-philosophy--core-principles)
3. [Information Architecture](#3-information-architecture)
4. [Global Layout System](#4-global-layout-system)
5. [Macro-Navigation: The Test Outline Sidebar](#5-macro-navigation-the-test-outline-sidebar)
6. [Split-Screen Authoring Workspace](#6-split-screen-authoring-workspace)
7. [Stimulus-Based Question Architecture](#7-stimulus-based-question-architecture)
8. [IELTS-Specific Question Templates](#8-ielts-specific-question-templates)
9. [Specialized Module UIs (Writing & Speaking)](#9-specialized-module-uis-writing--speaking)
10. [Scoring & Grading System UI](#10-scoring--grading-system-ui)
11. [Time Management Interface](#11-time-management-interface)
12. [Core Global Mechanics](#12-core-global-mechanics)
13. [Interaction Patterns & Micro-interactions](#13-interaction-patterns--micro-interactions)
14. [Accessibility Requirements](#14-accessibility-requirements)
15. [Responsive Design Considerations](#15-responsive-design-considerations)

---

## **1. Executive Summary**

### 1.1 Problem Statement

Standard quiz builders treat questions as independent entities, which is fundamentally incompatible with the IELTS examination structure. IELTS exams are:
- **Stimulus-driven**: Questions are inextricably linked to reading passages or audio tracks
- **Modular**: Comprised of four distinct sections (Listening, Reading, Writing, Speaking) with unique formats
- **Highly structured**: Follow strict numbering conventions (1-40 per module) and time constraints
- **Format-diverse**: Require specialized question types not found in generic quiz platforms

### 1.2 Solution Vision

A purpose-built IELTS exam builder that mirrors the cognitive workflow of test creators, providing:
- **Contextual authoring environments** that match how questions appear on actual exams
- **Intelligent automation** of tedious tasks (numbering, scoring conversion, time tracking)
- **Format-specific templates** that enforce IELTS standards while allowing creative flexibility
- **Visual hierarchy** that reflects the exam's macro-structure at every level

### 1.3 Key Differentiators from Standard Quiz Builders

| Feature | Standard Quiz Builder | IELTS Exam Builder |
|---------|----------------------|-------------------|
| Question Independence | ✅ Questions are standalone | ❌ Questions grouped by stimulus |
| Navigation | Flat list or categories | Hierarchical module → passage → question tree |
| Scoring | Points per question | Band score conversion matrix |
| Timer | Global or per-question | Per-module with auto-lock |
| Question Types | MCQ, Short Answer, Essay | T/F/NG, Cloze, Matching Headings, Map Labeling, etc. |
| Media Handling | Optional attachment | Required stimulus (audio/text/image) |

---

## **2. Design Philosophy & Core Principles**

### 2.1 The "Mirror Principle"™

**Definition:** The authoring interface should mirror the test-taking experience.

**Rationale:** When a creator builds a Reading section, they should see the passage on the left and questions on the right—exactly as the student will. This reduces cognitive load and contextual errors.

**Implementation:**
```
Student View:     [Passage Text]  |  [Questions]
Creator View:     [Passage Editor] |  [Question Builder]
```

### 2.2 Progressive Disclosure

**Principle:** Show only what's necessary at each stage of the workflow. Advanced options (alternative answers, word banks, scoring weights) should be hidden behind expandable panels until needed.

### 2.3 Constraint-Guided Freedom

**Balance:** Provide templates that enforce IELTS structural rules (e.g., "Choose TWO letters A-E") while allowing creative freedom within those constraints (the actual content of options A-E).

### 2.4 Error Prevention Over Error Correction

**Strategy:** Use smart defaults, validation guards, and visual cues to prevent common mistakes:
- Auto-numbering prevents duplicate/missing numbers
- Template locks prevent mixing T/F/NG with Y/N/NG
- Character count warnings prevent exceeding word limits

### 2.5 Spatial Consistency

**Rule:** Elements that are spatially related in the final exam should be spatially related in the builder. If Question 14 follows Question 13 in the exam, they must appear sequentially in the builder.

---

## **3. Information Architecture**

### 3.1 High-Level Sitemap

```
┌─────────────────────────────────────────────────────────────┐
│                    IELTS EXAM BUILDER                       │
├─────────────────────────────────────────────────────────────┤
│  Dashboard                                                   │
│  ├── My Exams (List View)                                   │
│  ├── Templates Library                                      │
│  └── Settings                                               │
│                                                              │
│  Exam Creation Workspace                                    │
│  ├── Header Bar (Exam Title, Type Toggle, Save Status)      │
│  ├── Sidebar (Module Navigator)                             │
│  │   ├── Listening Module                                   │
│  │   │   ├── Part 1 (Q1-10)                                 │
│  │   │   ├── Part 2 (Q11-20)                                │
│  │   │   ├── Part 3 (Q21-30)                                │
│  │   │   └── Part 4 (Q31-40)                                │
│  │   ├── Reading Module                                     │
│  │   │   ├── Passage 1 (Q1-13)                              │
│  │   │   ├── Passage 2 (Q14-26)                             │
│  │   │   └── Passage 3 (Q27-40)                             │
│  │   ├── Writing Module                                     │
│  │   │   ├── Task 1                                         │
│  │   │   └── Task 2                                         │
│  │   └── Speaking Module                                    │
│  │       ├── Part 1                                         │
│  │       ├── Part 2 (Cue Card)                              │
│  │       └── Part 3                                         │
│  └── Main Content Area (Split-Pane Editor)                  │
│      ├── Stimulus Pane (Left)                               │
│      └── Question Builder Pane (Right)                      │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Component Taxonomy

```
GLOBAL COMPONENTS
├── Navigation
│   ├── Sidebar (Collapsible Tree)
│   ├── Breadcrumbs
│   └── Quick-Jump Modal (Cmd+K)
├── Headers
│   ├── Exam Title Bar
│   ├── Module Tabs
│   └── Block Headers (Question range display)
└── Action Bars
    ├── Toolbar (Formatting, Insert)
    └── Context Menu (Right-click actions)

MODULE-SPECIFIC COMPONENTS
├── Listening
│   ├── Audio Player + Waveform Visualizer
│   ├── Timestamp Pin Dropper
│   └── Section Divider (Part 1/2/3/4)
├── Reading
│   ├── Rich Text Editor (Passage)
│   ├── Image Uploader (Diagrams/Maps)
│   └── Paragraph Numbering Tool
├── Writing
│   ├── Prompt Editor
│   ├── Image Upload (Task 1 Charts)
│   └── Word Count Constraint Setter
└── Speaking
    ├── Cue Card Builder
    ├── Evaluator Notes Field
    └── Rubric Attacher

QUESTION TEMPLATE COMPONENTS
├── Cloze/Fill-in-the-Blank
│   ├── Highlight-to-Blank Converter
│   ├── Answer Validation Panel
│   └── Word Bank Toggle
├── T/F/NG & Y/N/NG
│   ├── Statement Spreadsheet
│   ├── Rapid Entry Mode
│   └── Answer Radio Cluster
├── Matching Headings
│   ├── Roman Numeral Auto-Generator
│   ├── Paragraph Dropdown Matrix
│   └── Visual Connection Lines
├── Map/Diagram Labeling
│   ├── Image Canvas
│   ├── Hotspot Dropper
│   └── Draggable Input Boxes
└── Multi-Select MCQ
    ├── Dynamic Option Generator
    ├── Correct Answer Checker (Multi)
    └── Smart Numbering Allocator
```

---

## **4. Global Layout System**

### 4.1 Grid Structure

The workspace uses a **CSS Grid** layout with three primary zones:

```
┌──────────┬──────────────────────────────────────────┐
│          │              HEADER BAR                  │
│          │  [Logo] [Exam Name] [Acad/GT] [Save]    │
│  SIDEBAR ├──────────────────────────────────────────┤
│  (280px) │                                          │
│          │         MAIN CONTENT AREA                │
│  Sticky  │    ┌─────────────┬──────────────────┐    │
│  Collaps. │    │  STIMULUS   │  QUESTION        │    │
│          │    │  PANE       │  BUILDER PANE    │    │
│  📖 Read │    │  (50%)      │  (50%)           │    │
│  🎧 List │    │             │                  │    │
│  ✍️ Writ │    │             │                  │    │
│  🗣️ Speak│    │             │                  │    │
│          │    └─────────────┴──────────────────┘    │
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

### 4.2 Responsive Breakpoints

| Breakpoint | Behavior |
|------------|----------|
| **≥1440px** (Desktop Full) | Full sidebar + dual-pane editor visible |
| **1024-1439px** (Desktop Compact) | Sidebar collapses to icons; dual-pane maintained |
| **768-1023px** (Tablet) | Sidebar hidden (hamburger menu); panes stack vertically |
| **<768px** (Mobile) | Single-pane view with tab switching between stimulus/questions |

### 4.3 Spacing System (8px Base Unit)

```
--space-xs: 4px    (Icon padding, inline elements)
--space-sm: 8px    (Button padding, tight groupings)
--space-md: 16px   (Card padding, section spacing)
--space-lg: 24px   (Component margins, pane gutters)
--space-xl: 32px   (Page margins, major section breaks)
--space-xxl: 48px  (Hero sections, modal padding)
```

### 4.4 Typography Scale

```
--font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif

--text-xs:   0.75rem  (12px) - Labels, metadata
--text-sm:   0.875rem (14px) - Body text, options
--text-base: 1rem     (16px) - Default body
--text-lg:   1.125rem (18px) - Subheadings, question text
--text-xl:   1.25rem  (20px) - Card titles, block headers
--text-2xl:  1.5rem   (24px) - Page headings
--text-3xl:  1.875rem (30px) - Hero text (exam title)

--font-normal: 400
--font-medium: 500
--font-semibold: 600
--font-bold: 700
```

---

## **5. Macro-Navigation: The Test Outline Sidebar**

### 5.1 The "Binder" Metaphor

**Concept:** Treat the sidebar like a physical binder with color-coded tabs for each IELTS module.

**Visual Design:**
- **Width:** 280px (expandable to 320px on hover)
- **Position:** Fixed left, full height
- **Background:** Neutral surface (#F9FAFB)
- **Border-right:** 1px solid (#E5E7EB)
- **Shadow:** Subtle inner shadow on scroll

### 5.2 Module Tab Visualization

Each module gets a distinct icon and accent color:

```
📖 LISTENING  (#3B82F6 - Blue)
├── ⏱ Duration: 30 mins
├── 📊 Questions: 40 (auto-calculated)
└── ▸ Part 1 (Questions 1-10)
    ▸ Part 2 (Questions 11-20)
    ▸ Part 3 (Questions 21-30)
    ▸ Part 4 (Questions 31-40)

📚 READING     (#10B981 - Green)
├── ⏱ Duration: 60 mins
├── 📊 Questions: 40 (auto-calculated)
└── ▸ Passage 1 (Questions 1-13)
    ▸ Passage 2 (Questions 14-26)
    ▸ Passage 3 (Questions 27-40)

✍️ WRITING     (#F59E0B - Amber)
├── ⏱ Duration: 60 mins
└── ▸ Task 1 (150 words min)
    ▸ Task 2 (250 words min)

🗣️ SPEAKING    (#EF4444 - Red)
├── ⏱ Duration: 11-14 mins
└── ▸ Part 1 (Introduction)
    ▸ Part 2 (Cue Card)
    ▸ Part 3 (Discussion)
```

### 5.3 Interaction States

**Collapsed State (Default):**
```
📖 Listening  ▾
📚 Reading    ▾
✍️ Writing    ▸
🗣️ Speaking   ▸
```

**Expanded State (Active Module):**
```
📖 Listening  ▴
   ├─ Part 1 (Q1-10)    ← Active (highlighted)
   ├─ Part 2 (Q11-20)
   ├─ Part 3 (Q21-30)
   └─ Part 4 (Q31-40)
   
   [+ Add New Part]
```

**Hover State:**
- Background changes to light gray (#F3F4F6)
- Subtle left border accent (4px solid in module color)
- Tooltip shows: "Part 1: Social Context Conversation"

**Drag-and-Drop Visual Feedback:**
When dragging a block (e.g., Passage 2):
- Original position shows ghost outline (dashed border, reduced opacity)
- Drop targets highlight with blue background
- Insertion line appears between valid drop zones
- Cursor changes to `grabbing`

### 5.4 Drag-and-Drop Rules

**Allowed Operations:**
- ✅ Reorder passages within Reading module
- ✅ Reorder parts within Listening module
- ✅ Move question blocks between passages/parts
- ✅ Reorder question blocks within same stimulus

**Forbidden Operations (Visual Block):**
- ❌ Move questions between modules (Listening ↔ Reading)
- ❌ Move Writing/Speaking tasks (fixed order)
- ❌ Drag individual questions out of their block (must move entire block)

**Validation Feedback:**
```
[✓] Valid Drop: Green checkmark, smooth animation
[✗] Invalid Drop: Red X shake animation, tooltip: 
    "Cannot move questions between modules"
```

### 5.5 Context Menu (Right-Click)

```
┌─────────────────────┐
│ 📝 Edit Title       │
│ 📋 Duplicate        │
│ 🗑️ Delete           │
│ ─────────────────── │
│ ➕ Add Question Block│
│ 📎 Add Stimulus      │
│ ─────────────────── │
│ 🔢 Renumber From Here│
│ 👁 Preview Student View│
└─────────────────────┘
```

---

## **6. Split-Screen Authoring Workspace**

### 6.1 Dual-Pane Architecture

This is the **core innovation** of the IELTS builder. It mimics the physical layout of IELTS exam papers.

#### **Layout Specifications**

```
┌────────────────────────────────────────────────────────────┐
│                    CONTENT AREA                            │
├────────────────────────┬───────────────────────────────────┤
│                        │                                   │
│   STIMULUS PANE        │   QUESTION BUILDER PANE           │
│   (Left - 50%)         │   (Right - 50%)                   │
│                        │                                   │
│   ┌──────────────────┐ │   ┌───────────────────────────┐  │
│   │ [Toolbar]        │ │   │ [+ Add Question Block]    │  │
│   │ B I U H1 H2 Img  │ │   │                           │  │
│   ├──────────────────┤ │   ├───────────────────────────┤  │
│   │                  │ │   │ 📦 Block: Q1-6            │  │
│   │  Reading Passage │ │   │ "Summary Completion"      │  │
│   │  Text Here...    │ │   │                           │  │
│   │                  │ │   │ Q1: ____ (14) ____        │  │
│   │  Paragraph 1...  │ │   │ Q2: ____ (15) ____        │  │
│   │  Paragraph 2...  │ │   │ ...                       │  │
│   │  Paragraph 3...  │ │   │                           │  │
│   │                  │ │   │ 📦 Block: Q7-13           │  │
│   │  [Diagram Image] │ │   │ "True/False/Not Given"    │  │
│   │                  │ │   │                           │  │
│   └──────────────────┘ │   └───────────────────────────┘  │
│                        │                                   │
│   🔒 Scroll Independent│   🔒 Scroll Independent           │
└────────────────────────┴───────────────────────────────────┘
```

#### **Key Features**

**1. Independent Scrolling**
- Each pane has its own scrollbar
- No synchronized scrolling (intentional—creator may need to view paragraph 6 while editing question about paragraph 2)
- **Exception:** Optional "Link Scroll" toggle button in toolbar that syncs scroll positions (useful for verifying alignment)

**2. Resizable Divider**
- Drag the center divider (4px wide grab handle) to adjust ratio
- Minimum width: 30% / Maximum width: 70%
- Visual feedback: Blue highlight on hover, cursor change to `col-resize`
- Snap points: 50/50 (default), 40/60, 60/40

**3. Pane Collapse**
- Click collapse button (<< or >>) to hide one pane temporarily
- Collapsed pane shows as thin tab (showing title)
- Click tab to restore

### 6.2 Stimulus Pane (Left Side)

#### **For Reading Modules: Rich Text Editor**

**Toolbar Configuration:**
```
┌─────────────────────────────────────────────────────────┐
│ [Format] [B] [I] [U] [S] | [H2] [H3] | [UL] [OL] [LI] │
│ [Quote] [Code] | [Image] [Table] [Link] | [¶ Numbers]  │
│ [Undo] [Redo] | [Clear Formatting]                      │
└─────────────────────────────────────────────────────────┘
```

**Special Features:**

**Paragraph Numbering Tool:**
- Button: `[¶ Add Paragraph Labels]`
- Automatically inserts: **Paragraph A**, **Paragraph B**, **Paragraph C**...
- Used for Matching Headings questions
- Visual style: Bold, small caps, left-aligned with margin
- **Editable:** Creator can manually override labels (e.g., "Section A", "Paragraph i")

**Image/Diagram Upload:**
- Drag-and-drop zone or click-to-upload
- Supported formats: PNG, JPG, SVG, PDF (for complex diagrams)
- Once uploaded, image becomes inline element in text flow
- **Annotation mode:** Click image to enter annotation mode (add arrows, labels, boxes)
- **Cropping tool:** Built-in crop/resize before insertion

**Word Count Display:**
- Real-time counter in bottom-right corner of editor
- Format: `Words: 847 | Chars: 5,230`
- Target indicator: Shows if within typical IELTS passage length (700-1000 words)
  - ✅ Green: 700-1000 words
  - ⚠️ Yellow: 500-699 or 1001-1200 words
  - 🔴 Red: <500 or >1200 words (warning tooltip)

#### **For Listening Modules: Audio Workspace**

**Layout:**
```
┌─────────────────────────────────────────────┐
│  🎧 AUDIO PLAYER                            │
│  ┌─────────────────────────────────────┐    │
│  │▶▶████████████████░░░░░░░░░░░░░░░░░░│    │
│  │ 02:15                    / 05:43    │    │
│  └─────────────────────────────────────┘    │
│  [Play] [Pause] [Stop] [-10s] [+10s] [Loop]│
├─────────────────────────────────────────────┤
│  📍 TIMESTAMP PINS                          │
│                                             │
│  Part 1 Start:  00:00  ──●                 │
│  Q1-5:          00:45  ──●                 │
│  Q6-10:         02:15  ──●  ← Hover: Play  │
│  Part 2 Start:  03:30  ──●     from here   │
│  ...                                        │
│                                             │
│  [+ Add Timestamp Pin]                      │
└─────────────────────────────────────────────┘
```

**Audio Waveform Visualization:**
- Render audio waveform visually (using Web Audio API)
- Allow clicking anywhere on waveform to jump to that timestamp
- Show pin markers on waveform timeline
- Zoom controls: `[Zoom In] [Zoom Out] [Fit to Window]`

**Timestamp Pin Creation Flow:**
1. User plays audio and pauses at desired moment (e.g., 02:15)
2. Clicks `[+ Pin Current Time]` button OR presses `P` key
3. Pin appears on timeline with editable label field
4. User types: "Q4 answer mentioned here"
5. Pin is now associated with that question block

**Pin Metadata:**
```json
{
  "id": "pin_001",
  "timestamp": "02:15",
  "label": "Q4: Factory location",
  "linked_question_block": "block_q4_6",
  "color": "#3B82F6",
  "notes": "Speaker mentions 'north of the river'"
}
```

### 6.3 Question Builder Pane (Right Side)

#### **Block-Based Architecture**

Questions are never standalone—they live inside **Question Blocks**.

**Block Card Component:**
```
╭──────────────────────────────────────────────╮
│ 📦 Questions 1-6              [⋮ Menu] [−]  │
│ ─────────────────────────────────────────── │
│ Type: [Summary Completion ▾]                 │
│                                              │
│ Instruction:                                 │
│ "Complete the summary below."                │
│ "Choose NO MORE THAN TWO WORDS..." [▾]      │
│                                              │
│ ┌────────────────────────────────────────┐  │
│ │ Q1: The Industrial Revolution began in │  │
│ │     ____ (1) ____ in the late 1700s.   │  │
│ │     Answer: [Britain        ] [✏️][🗑️] │  │
│ │                                       │  │
│ │ Q2: This period saw the rise of ____  │  │
│ │     (2) ____.                         │  │
│ │     Answer: [factories       ] [✏️][🗑️]│  │
│ └────────────────────────────────────────┘  │
│                                              │
│ [+ Add Question]  [Duplicate Block] [Delete] │
╰──────────────────────────────────────────────╯
```

**Block Header Features:**
- **Auto-calculated range:** "Questions 1-6" updates automatically when questions added/removed
- **Collapse/Expand:** Click header to minimize block (shows only header + question count)
- **Drag Handle:** Left edge of header has grip icon (⠿) for reordering blocks
- **Color Coding:** Left border accent matches question type
  - Cloze: Blue (#3B82F6)
  - T/F/NG: Amber (#F59E0B)
  - Matching: Purple (#8B5CF6)
  - Map Labeling: Teal (#14B8A6)
  - MCQ: Rose (#F43F5E)

**Block Actions (⋮ Menu):**
```
┌──────────────────────────┐
│ 📝 Edit Block Settings   │
│ 📋 Duplicate Block       │
│ 🔄 Convert to Other Type │
│ ──────────────────────── │
│ 🔢 Renumber Starting At  │
│ 📊 Preview Student View  │
│ ──────────────────────── │
│ 🗑️ Delete Block          │
└──────────────────────────┘
```

---

## **7. Stimulus-Based Question Architecture**

### 7.1 The "Parent-Child" Relationship Model

**Data Structure:**
```
STIMULUS (Parent)
├── ID: stimulus_reading_passage_1
├── Type: "reading_text" | "audio_file" | "image_diagram"
├── Content: { ... }
├── Metadata: { word_count, duration, source }
│
└── CHILDREN: Question Blocks []
    ├── Block 1: Questions 1-6 (T/F/NG)
    │   ├── Question 1 { statement, answer: "True" }
    │   ├── Question 2 { statement, answer: "False" }
    │   └── ...
    │
    ├── Block 2: Questions 7-13 (Matching Headings)
    │   ├── Question 7 { paragraph: "A", answer: "iii" }
    │   └── ...
    │
    └── Block 3: Questions 14-20 (Cloze Summary)
        ├── Question 14 { blank_position, answer: "industrial" }
        └── ...
```

### 7.2 Creating a New Stimulus Block

**Workflow:**

**Step 1: Initiate Block Creation**
- User clicks `[+ Add Question Block]` button in Question Builder Pane
- Modal appears:

```
┌─────────────────────────────────────────────┐
│  Create New Question Block                   │
│  ─────────────────────────────────────────  │
│                                             │
│  Select Question Type:                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Cloze    │ │ T/F/NG   │ │ Matching │   │
│  │ Summary  │ │ Yes/No   │ │ Headings │   │
│  └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Map/     │ │ Multiple │ │ Sentence │   │
│  │ Diagram  │ │ Choice   │ │ Completion│  │
│  └──────────┘ └──────────┘ └──────────┘   │
│                                             │
│  Or search: [________________]             │
│                                             │
│  [Cancel]                    [Create Block] │
└─────────────────────────────────────────────┘
```

**Step 2: Block Instantiation**
- Selected template renders as new card in Question Builder Pane
- Auto-populated with placeholder content
- Focus moves to first editable field

**Step 3: Link to Stimulus**
- Block automatically associated with current stimulus (passage/audio)
- Visual indicator: Small link icon showing connection
- Can be changed via dropdown: `[Linked to: Passage 1 ▾]`

### 7.3 Stimulus Switching

If user wants to move a block to different stimulus:

1. Open block's `[⋮]` menu
2. Select `"Move to Different Stimulus"`
3. Modal shows available stimuli in current module:
   ```
   Move "Questions 7-13" to:
   ○ Passage 1 (currently has Q1-6)
   ● Passage 2 (currently has Q14-26) ← Selected
   ○ Passage 3 (currently has Q27-40)
   ```
4. Confirm → Block animates to new location
5. **Auto-renumbering triggers** (see Section 12)

---

## **8. IELTS-Specific Question Templates**

### 8.1 Template 1: Summary / Sentence Completion (Cloze)

#### **Use Case**
Students read a summary paragraph with missing words and fill them in based on the passage.

#### **UI Specification**

**Instruction Selector:**
```
┌─────────────────────────────────────────────┐
│  Word Limit Instruction:                    │
│  [NO MORE THAN ONE WORD               ▾]   │
│  ○ NO MORE THAN ONE WORD                   │
│  ● NO MORE THAN TWO WORDS                  │
│  ○ NO MORE THAN THREE WORDS                │
│  ○ NO MORE THAN THREE WORDS AND/OR A NUMBER│
│  ○ Custom: [_____________]                 │
└─────────────────────────────────────────────┘
```

**Cloze Editor (Main Interaction Zone):**

```
┌─────────────────────────────────────────────────────┐
│  📝 Summary Text Editor                             │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  The Industrial Revolution, which began in          │
│  Britain in the late 18th century, was driven by    │
│  several key factors. First, there were abundant    │
│  natural resources, particularly ̲̲̲coal̲̲̲_____(1)_____  │
│  and iron ore. Second, Britain had a strong          │
│  system of ̲̲̲banking̲̲̲_____(2)_____ and trade networks.│
│  Third, political stability allowed for long-term   │
│  ̲̲̲investment̲̲̲_____(3)_____ in new technologies.      │
│                                                     │
│  [Highlighted: coal, banking, investment]           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Highlight-to-Blank Conversion Flow:**

1. **User selects text** in editor (e.g., highlights "coal")
2. **Mini-toolbar appears** above selection:
   ```
   ┌─────────────────────────────┐
   │ [Create Blank #1] [Cancel]  │
   └─────────────────────────────┘
   ```
3. **User clicks "Create Blank #1"**
4. **Transformation occurs:**
   - Original word replaced with: `_____(1)_____`
   - Word stored as correct answer in backend
   - Visual styling: Dashed underline, light gray background, bold number
5. **Answer Panel slides open** on right side:

```
┌──────────────────────────────────┐
│  ✓ Answers for Blank #1          │
│  ──────────────────────────────  │
│                                  │
│  Primary Answer:                 │
│  [coal_______________] ✏️        │
│                                  │
│  Alternative Acceptable Answers: │
│  [+ Add Alternative]             │
│  [Coal______________] [×]        │
│  [+ Add Alternative]             │
│                                  │
│  Case Sensitive? [ ]             │
│  Allow Plurals?   [✓]           │
│  Allow Hyphens?   [ ]           │
│                                  │
│  [Save & Close]                  │
└──────────────────────────────────┘
```

**Alternative Answer Management:**
- Common use cases:
  - US/UK spelling variants: "color" / "colour"
  - Singular/plural: "factory" / "factories"
  - Synonyms (if accepted): "big" / "large"
- UI allows unlimited alternatives
- Each alternative has its own validation rules

**Word Bank Mode (Toggle):**

When enabled (`[✓] Use Word Bank`):

```
┌─────────────────────────────────────────────┐
│  Word Bank Options                          │
│  ─────────────────────────────────────────  │
│                                             │
│  Letter   Word/Phrase                       │
│  ┌─────┐  ┌────────────────────────────┐   │
│  │  A  │  │ coal                        │   │
│  └─────┘  └────────────────────────────┘   │
│  ┌─────┐  ┌────────────────────────────┐   │
│  │  B  │  │ banking                    │   │
│  └─────┘  └────────────────────────────┘   │
│  ┌─────┐  ┌────────────────────────────┐   │
│  │  C  │  │ investment                 │   │
│  └─────┘  └────────────────────────────┘   │
│  ┌─────┐  ┌────────────────────────────┐   │
│  │  D  │  │ (distractor - transport)   │   │
│  └─────┘  └────────────────────────────┘   │
│                                             │
│  [+ Add Option]                             │
│                                             │
│  Correct Answers (select letters):          │
│  [✓] A  [✓] B  [✓] C  [ ] D               │
│                                             │
│  Note: Students will select letters,        │
│  not type words.                            │
└─────────────────────────────────────────────┘
```

**Keyboard Shortcuts for Cloze Editor:**
- `Double-click word`: Select word + show mini-toolbar
- `Ctrl/Cmd + B`: Convert selection to blank
- `Tab`: Move to next blank
- `Shift + Tab`: Move to previous blank
- `Enter` (in answer field): Save and move to next blank

---

### 8.2 Template 2: True / False / Not Given (T/F/NG) & Yes / No / Not Given

#### **Use Case**
Students evaluate statements against the passage. Two variants exist:
- **T/F/NG**: For factual/informational passages
- **Y/N/NG**: For opinion/writer's view passages

**CRITICAL RULE:** These must never be mixed in the same block.

#### **UI Specification**

**Template Header:**
```
┌─────────────────────────────────────────────┐
│  Question Type: True / False / Not Given    │
│  ─────────────────────────────────────────  │
│                                             │
│  Variant:                                   │
│  ( ) True / False / Not Given               │
│  (*) Yes / No / Not Given  ← Selected       │
│                                             │
│  ⚠️ Important:                               │
│  Use T/F/NG for factual statements.         │
│  Use Y/N/NG for writer's opinions/views.     │
│                                             │
│  Instruction Text (optional):               │
│  ["Do the following statements agree with    │
│   the views of the writer in Reading         │
│   Passage 3?"]                              │
│  [Edit Instruction...]                      │
└─────────────────────────────────────────────┘
```

**Spreadsheet-Style Entry Interface:**

```
┌─────────────────────────────────────────────────────────────┐
│  Statements                                                 │
│  ┌─────────────────────────────────┬─────┬─────┬──────────┐ │
│  │ # │ Statement                   │  T  │  F  │   NG     │ │
│  ├─────────────────────────────────┼─────┼─────┼──────────┤ │
│  │ 1 │ The Industrial Revolution   │  ○  │  ●  │    ○     │ │
│  │   │ began in France.            │     │     │          │ │
│  ├─────────────────────────────────┼─────┼─────┼──────────┤ │
│  │ 2 │ Coal was the only fuel      │  ○  │  ○  │    ●     │ │
│  │   │ used during this period.    │     │     │          │ │
│  ├─────────────────────────────────┼─────┼─────┼──────────┤ │
│  │ 3 │ Banking systems enabled     │  ●  │  ○  │    ○     │ │
│  │   │ large-scale investment.     │     │     │          │ │
│  ├─────────────────────────────────┼─────┼─────┼──────────┤ │
│  │ 4 │ [Type statement here...    │  ○  │  ○  │    ○     │ │
│  │   │ Press Enter to add next]   │     │     │          │ │
│  └─────────────────────────────────┴─────┴─────┴──────────┘ │
│                                                             │
│  [+ Add Row]  [Import from CSV]  [Clear All]               │
│                                                             │
│  Total Statements: 3  |  T: 1  |  F: 1  |  NG: 1           │
└─────────────────────────────────────────────────────────────┘
```

**Rapid Entry Mode (Power User Feature):**

Toggle `[✓] Rapid Entry Mode]` transforms interface:

```
┌─────────────────────────────────────────────┐
│  🚀 Rapid Entry Mode (Press Esc to exit)   │
│  ─────────────────────────────────────────  │
│                                             │
│  Type statement, then press:               │
│  [T] = True    [F] = False    [N] = NG     │
│                                             │
│  > The revolution started in Britain. [T] ✓ │
│  > Coal was essential.              [F] ✓   │
│  > Transport improved significantly.  [N] ✓ │
│  > [_Cursor waiting for input_]            │
│                                             │
│  Last action: Added Q3 as "Not Given"       │
└─────────────────────────────────────────────┘
```

**Interaction Details:**

**Radio Button Behavior:**
- Click once to select
- Keyboard navigation: Arrow keys move between T/F/NG within row
- Screen reader announces: "Question 2, selected: False"
- Visual state change: Selected radio fills with color, others dim

**Row Actions (Hover):**
- Right side of row shows: `[↑] [↓] [✂️] [🗑️]`
- ↑ ↓ = Reorder row
- ✂️ = Cut (to paste elsewhere)
- 🗑️ = Delete (with confirmation if >3 rows)

**Statement Text Field:**
- Auto-expands height as user types (min 1 line, max 6 lines)
- Character limit: 300 characters (with counter: `247/300`)
- Supports basic formatting: Bold (**word**) for emphasis
- Paste detection: Strips formatting from external sources

**Bulk Import Feature:**
Click `[Import from CSV]`:
```
Supported Format (.csv):
statement,answer
"The revolution began in Britain.",TRUE
"Coal was the main fuel.",FALSE
"Transport improved.",NOT_GIVEN
```

---

### 8.3 Template 3: Matching Headings

#### **Use Case**
Students match Roman numeral headings (i, ii, iii, iv...) to lettered paragraphs (A, B, C, D...). Always includes extra headings as distractors.

#### **UI Specification**

**Two-Column Layout:**

```
┌─────────────────────────────────────────────────────────────┐
│  📦 Questions 7-13: Matching Headings                       │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  HEADINGS (Left Column)     PARAGRAPHS (Right Column)       │
│  ┌─────────────────────┐   ┌───────────────────────────┐   │
│  │ i.  [Heading text]  │   │ Paragraph A  [▾ Choose]   │   │
│  │ ii. [Heading text]  │──│→│ Paragraph B  [▾ iii    ] │   │
│  │ iii.[Heading text]  │   │ Paragraph C  [▾ Choose]   │   │
│  │ iv. [Heading text]  │   │ Paragraph D  [▾ i      ] │   │
│  │ v.  [Heading text]  │   │ Paragraph E  [▾ Choose]   │   │
│  │ vi. [Heading text]  │   │ Paragraph F  [▾ v      ] │   │
│  │ vii.[Distractor]    │   │                           │   │
│  │                     │   │                           │   │
│  │ [+ Add Heading]     │   │ Unmatched Headings:       │   │
│  └─────────────────────┘   │ • ii                      │   │
│                             │ • iv                      │   │
│  Auto-generated numerals    │ • vi, vii                 │   │
│  (do not type manually)     │                           │   │
│                             └───────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Heading Input Mechanics:**

1. User clicks `[+ Add Heading]`
2. Text field appears with auto-assigned next numeral:
   ```
   viii. [Type heading here...]
   ```
3. User types heading text (no need to type "viii.")
4. Press Enter → heading saved, new blank appears below
5. Numerals auto-increment: i, ii, iii, iv, v, vi, vii, viii, ix, x...

**Rules Enforced by UI:**
- ✅ Must have more headings than paragraphs (distractors required)
- ✅ Minimum 5 headings, maximum 12
- ✅ Each heading unique (duplicate detection with warning)
- ✅ Paragraph labels auto-generated (A, B, C... up to Z)

**Matching Mechanism (Dropdown):**

For each paragraph, dropdown populated with:
- All heading numerals (i through vii...)
- Option: "[– Not Matched]" (if distractors exist)

**Selection Behavior:**
- When "iii" chosen for Paragraph B:
  - Dropdown displays "iii"
  - **Visual connector line** draws from "iii" in left column to Paragraph B in right column (SVG overlay, curved Bezier path, subtle gray/blue)
  - "iii" in left column dims slightly (opacity 0.6) indicating it's used
  - "Unmatched Headings" list updates (removes "iii")

**Reassignment:**
- If user changes Paragraph B from "iii" to "v":
  - Old line fades out
  - New line draws to "v"
  - "iii" returns to full opacity
  - "v" dims
  - Unmatched list updates

**Visual Connector Line Styling:**
```css
.matching-line {
  stroke: #94A3B8; /* Slate-400 */
  stroke-width: 2px;
  stroke-dasharray: 5,5;
  fill: none;
  pointer-events: none;
  transition: all 0.3s ease;
}

.matching-line.active {
  stroke: #3B82F6; /* Blue-500 */
  stroke-dasharray: none;
}
```

**Distractor Indicator:**
Headings not matched to any paragraph show tag:
```
vi. [The role of government policy] 🏷️ DISTRACTOR
```
Tag is amber-colored pill badge.

---

### 8.4 Template 4: Map / Diagram / Flowchart Labeling

#### **Use Case**
An image (map, floor plan, diagram, flowchart) has missing labels. Students identify them from options or by typing.

#### **UI Specification**

**Phase 1: Image Upload**

```
┌─────────────────────────────────────────────┐
│  🖼️ Diagram / Map Upload                    │
│  ─────────────────────────────────────────  │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │                                     │   │
│  │    ┌─────────────────────────┐      │   │
│  │    │                         │      │   │
│  │    │   Drag & drop image     │      │   │
│  │    │   or click to upload    │      │   │
│  │    │                         │      │   │
│  │    │   PNG, JPG, SVG, PDF   │      │   │
│  │    │                         │      │   │
│  │    └─────────────────────────┘      │   │
│  │                                     │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Recommended: High contrast, minimum        │
│  800px width for clarity                    │
│                                             │
└─────────────────────────────────────────────┘
```

**Phase 2: Annotation Canvas (After Upload)**

```
┌─────────────────────────────────────────────────────────────┐
│  🗺️ Diagram Annotation Mode                                │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Toolbar: [Pointer] [Hotspot 📌] [Arrow➝] [Text📝] [Zoom±] │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │                  LIBRARY FLOOR PLAN                 │   │
│  │                                                     │   │
│  │     ┌─────────┐                                    │   │
│  │     │ Reception│───📌Q21──┐                        │   │
│  │     └─────────┘          │                        │   │
│  │                          ▼                        │   │
│  │     ┌─────────┐    ┌──────────┐    ┌─────────┐    │   │
│  │     │Computer │    │   📌Q22  │    │ Café    │    │   │
│  │     │  Lab    │    │          │    │         │    │   │
│  │     └─────────┘    └──────────┘    └─────────┘    │   │
│  │          ▲                             │           │   │
│  │          │──📌Q23──┐                   │           │   │
│  │                   ▼                   │           │   │
│  │          ┌──────────────┐     ┌─────────────┐     │   │
│  │          │  📌Q24       │     │ Study Room  │     │   │
│  │          │              │     │   📌Q25     │     │   │
│  │          └──────────────┘     └─────────────┘     │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Active Hotspot: Q22 [Configure] [Delete]                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Hotspot Creation Flow:**

1. **Select Hotspot Tool** (📌 icon in toolbar)
2. **Click on image** at desired location
3. **Hotspot pin drops** with auto-number (Q21, Q22, Q23...)
4. **Configuration popover appears:**

```
┌──────────────────────────────────┐
│  Configure Hotspot Q21           │
│  ──────────────────────────────  │
│                                  │
│  Question Number: [21] (auto)   │
│                                  │
│  Answer Type:                    │
│  (●) Text Input                  │
│  ( ) Letter Selection (A-G)      │
│                                  │
│  ── If Text Input: ──────────    │
│  Correct Answer:                 │
│  [reception_________]            │
│                                  │
│  Alternative Answers:            │
│  [+ Add]                         │
│                                  │
│  ── If Letter Selection: ────    │
│  Options List:                   │
│  A: [reception___]               │
│  B: [café_______]                │
│  C: [computer lab_]              │
│  D: [study room__]               │
│  E: [library_____]               │
│  F: [bookstore____]              │
│  G: [toilets______]              │
│                                  │
│  Correct Letter: (●) A           │
│                                  │
│  [Save] [Cancel]                 │
└──────────────────────────────────┘
```

**Hotspot Visual States:**

**Default (Unconfigured):**
- Red pin icon (📍)
- Pulsing animation (draws attention)
- Label: "Q21 ?"

**Configured (Complete):**
- Blue pin icon (📍)
- Solid appearance
- Label: "Q21"

**On Hover (Creator View):**
- Pin enlarges slightly
- Tooltip shows: "Q21: Answer = 'reception'"
- Dashed circle around pin showing clickable area

**Draggable & Resizable:**
- Click and hold to drag pin to new position
- Resize handles on corners (if hotspot is box, not just point)
- Snap-to-grid option (aligns to 10px grid for precision)
- Position coordinates shown in status bar: `X: 245px Y: 189px`

**Canvas Controls:**
```
[Zoom In] [Zoom Out] [Fit to Screen] [100% ▾] [Reset Positions]
```
- Mouse wheel zoom (with cursor-centered zoom)
- Pan by clicking and dragging empty space (when Pointer tool active)
- Double-click to reset zoom

---

### 8.5 Template 5: Multi-Select Multiple Choice ("Choose TWO letters")

#### **Use Case**
Standard multiple choice but requiring selection of 2 or 3 correct answers from options. Counts as multiple question numbers.

#### **UI Specification**

**Question Header:**
```
┌─────────────────────────────────────────────┐
│  Choose the correct TWO letters, A-E.       │
│  ─────────────────────────────────────────  │
│                                             │
│  Question Stem:                             │
│  ["Which TWO factors contributed to the     │
│   success of the Industrial Revolution?"]   │
│  [Edit stem...]                             │
│                                             │
│  Smart Numbering: This block counts as       │
│  Questions 14 AND 15 (2 points total)       │
└─────────────────────────────────────────────┘
```

**Options Builder:**

```
┌─────────────────────────────────────────────┐
│  Options (Auto-labeled A-E)                 │
│  ─────────────────────────────────────────  │
│                                             │
│  How many correct answers? [2 ▾]           │
│  (This determines how many question         │
│   numbers are allocated)                    │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ A. [Abundant natural resources   ] │   │
│  │    ☑ Correct  [↑] [↓] [✂️] [🗑️]   │   │
│  ├─────────────────────────────────────┤   │
│  │ B. [Strong military presence      ] │   │
│  │    ☐ Incorrect                     │   │
│  ├─────────────────────────────────────┤   │
│  │ C. [Advanced banking systems      ] │   │
│  │    ☑ Correct                       │   │
│  ├─────────────────────────────────────┤   │
│  │ D. [Favorable climate conditions  ] │   │
│  │    ☐ Incorrect                     │   │
│  ├─────────────────────────────────────┤   │
│  │ E. [Government subsidies          ] │   │
│  │    ☐ Incorrect                     │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  [+ Add Option]  [Shuffle Options]          │
│                                             │
│  Correct selections: A, C (2 of 2 required) │
└─────────────────────────────────────────────┘
```

**Smart Numbering Logic (Critical):**

When creator sets "How many correct answers?" to `2`:
- Backend allocates **2 question numbers** (e.g., Q14, Q15)
- Student receives **1 point per correct selection**
- Partial credit possible (1 point if only 1 of 2 correct)
- **All-or-nothing toggle** available: `[ ] Require both correct for any points`

**Visual Representation in Sidebar:**
```
Reading
└── Passage 1
    ├── Q1-6 (T/F/NG)
    ├── Q7-13 (Matching)
    └── Q14-15 (Multi-Select MCQ)  ← Shows as range
```

**Option Management:**
- **Add Option:** Click `[+ Add Option]`, next letter auto-assigned
- **Reorder:** Drag handles or ↑↓ buttons
- **Delete:** Remove option (minimum 3 options if choosing 2, minimum 5 if choosing 3)
- **Shuffle:** Randomize order (for student view; creator always sees alphabetical)

**Validation Rules:**
- ✅ Cannot select fewer correct answers than specified
- ✅ Cannot select more correct answers than options allow
- ⚠️ Warning if too many distractors (suggests 5-7 options max for usability)
- ⚠️ Warning if correct answers are clustered (e.g., A & B) — suggests distributing

---

## **9. Specialized Module UIs (Writing & Speaking)**

### 9.1 Writing Module UI

**Fundamental Difference:** Unlike Reading/Listening, Writing has no "correct answers"—only prompts and rubrics.

#### **Task 1 Interface (Academic: Graph/Letter | General Training: Letter)**

```
┌─────────────────────────────────────────────────────────────┐
│  ✍️ WRITING TASK 1                                         │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Task Type:                                                 │
│  (●) Academic (Graph/Chart/Diagram Description)             │
│  ( ) General Training (Letter Writing)                      │
│                                                             │
│  ── PROMPT SECTION ────────────────────────────────────    │
│                                                             │
│  Prompt Instructions:                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ You should spend about 20 minutes on this task.     │   │
│  │                                                     │   │
│  │ The chart below shows the number of visitors to      │   │
│  │ three museums in London between 2000 and 2020.       │   │
│  │                                                     │   │
│  │ Summarise the information by selecting and          │   │
│  │ reporting the main features, and make comparisons    │   │
│  │ where relevant.                                     │   │
│  │                                                     │   │
│  │ Write at least 150 words.                           │   │
│  └─────────────────────────────────────────────────────┘   │
│  [Edit Prompt...]                                         │
│                                                             │
│  ── VISUAL STIMULUS (Task 1 Only) ────────────────────    │
│                                                             │
│  [Upload Chart/Image]  or  [Create Simple Chart]           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  📊 [Uploaded bar chart preview]                    │   │
│  │                                                     │   │
│  │  Visitors to London Museums (000s)                  │   │
│  │                                                     │   │
│  │  500 ┤                                             │   │
│  │  400 ┤         ████                                │   │
│  │  300 ┤   ████  ████  ████                          │   │
│  │  200 ┤   ████  ████  ████                          │   │
│  │  100 ┤   ████  ████  ████                          │   │
│  │    0 └────────────────────────                     │   │
│  │       2000  2010  2020                              │   │
│  │          British  Science  Natural History          │   │
│  │          Museum   Museum  Museum                    │   │
│  └─────────────────────────────────────────────────────┘   │
│  [Change Image] [Crop] [Remove]                           │
│                                                             │
│  ── WORD COUNT CONSTRAINTS ──────────────────────────    │
│                                                             │
│  Minimum Words: [150]  Maximum Words: [ ] (no max)        │
│  Time Allocation: [20] minutes                             │
│                                                             │
│  ⚠️ Note: Word count enforced strictly during exam.        │
│     Student cannot submit if under 150 words.              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### **Task 2 Interface (Essay)**

```
┌─────────────────────────────────────────────────────────────┐
│  ✍️ WRITING TASK 2                                         │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Essay Prompt:                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ You should spend about 40 minutes on this task.     │   │
│  │                                                     │   │
│  │ Write about the following topic:                    │   │
│  │                                                     │   │
│  │ "Some people believe that universities should       │   │
│  │ focus on providing skills for the workplace.        │   │
│  │ Others think the main function of a university      │   │
│  │ should be to give access to knowledge for its own   │   │
│  │ sake. Discuss both views and give your own opinion." │   │
│  │                                                     │   │
│  │ Write at least 250 words.                           │   │
│  └─────────────────────────────────────────────────────┘   │
│  [Edit Prompt...]                                         │
│                                                             │
│  Word Count Constraints:                                    │
│  Minimum: [250] words  |  Time: [40] minutes               │
│                                                             │
│  ── MARKING RUBRIC ATTACHMENT ────────────────────────    │
│                                                             │
│  Attached Rubric:                                           │
│  ✅ IELTS Writing Task 2 Criteria (Official)               │
│     • Task Response (25%)                                   │
│     • Coherence & Cohesion (25%)                            │
│     • Lexical Resource (25%)                                │
│     • Grammatical Range (25%)                               │
│                                                             │
│  [View Full Rubric] [Replace with Custom Rubric]            │
│                                                             │
│  ── MODEL ANSWER (Optional) ─────────────────────────    │
│                                                             │
│  [+] Attach Model Answer (for examiner reference)           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Writing Module Specific Features:**

**Prompt Template Library:**
- Pre-built IELTS-style prompts organized by topic:
  - Education, Technology, Environment, Health, Society, etc.
- Searchable database
- One-click insert into prompt field

**Simple Chart Builder (for Task 1):**
If creator doesn't have an image:
- Built-in tool to create basic charts (bar, line, pie, table)
- Data entry table → automatic chart rendering
- Export as high-quality PNG

---

### 9.2 Speaking Module UI

**Unique Challenge:** Speaking tests involve human examiners, so the builder creates materials for both student and examiner.

#### **Part 1: Introduction & Interview**

```
┌─────────────────────────────────────────────────────────────┐
│  🗣️ SPEAKING PART 1 (4-5 minutes)                          │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Topic Areas:                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. Work/Studies                                      │   │
│  │    • What is your job/study subject?                 │   │
│  │    • Why did you choose this field?                  │   │
│  │    • Do you enjoy it? Why/why not?                   │   │
│  │                                                     │   │
│  │ 2. Home Town/Accommodation                           │   │
│  │    • Where are you from?                              │   │
│  │    • What do you like about your hometown?           │   │
│  │    • Is it a good place for young people?            │   │
│  │                                                     │   │
│  │ 3. [Add another topic area...]                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [+ Add Topic Area]  [Import from Question Bank]           │
│                                                             │
│  Expected Duration: 4-5 minutes                             │
│  Number of Questions: 8-12 (system counts: 6)              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### **Part 2: Cue Card (Long Turn)**

```
┌─────────────────────────────────────────────────────────────┐
│  🗣️ SPEAKING PART 2: CUE CARD (3-4 minutes)               │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Describe something you own which is very important  │   │
│  │  to you.                                            │   │
│  │                                                     │   │
│  │  You should say:                                    │   │
│  │  • what it is                                       │   │
│  │  • when you got it                                   │   │
│  │  • how often you use it                              │   │
│  │  • and explain why it is important to you.           │   │
│  │                                                     │   │
│  │  You will have one minute to prepare, and you        │   │
│  │  should speak for one to two minutes.               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [Edit Cue Card Text...]                                   │
│                                                             │
│  Preparation Time: [1] minute                              │
│  Speaking Time: [1-2] minutes                              │
│                                                             │
│  ── FOLLOW-UP QUESTIONS (Examiner asks after) ─────────    │
│                                                             │
│  Q1: [Is it expensive to maintain?]                        │
│  Q2: [Would you replace it if lost?]                       │
│  Q3: [+ Add follow-up question...]                          │
│                                                             │
│  ── SUPPORTING MATERIALS (Optional) ──────────────────    │
│                                                             │
│  Upload Image for Cue Card: [No image attached]            │
│  (Some cue cards include photos/diagrams)                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Cue Card Visual Editor:**
- Live preview of how cue card will print/display
- Formatting options: Bold bullet points, centered topic
- Option to include small image (thumbnail) on card

#### **Part 3: Discussion (Two-Way)**

```
┌─────────────────────────────────────────────────────────────┐
│  🗣️ SPEAKING PART 3: DISCUSSION (4-5 minutes)              │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Topic: [Possessions and Materialism]                       │
│  (Related to Part 2 cue card topic)                         │
│                                                             │
│  Discussion Questions:                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Q1: Why do some people value material possessions   │   │
│  │     more than experiences?                           │   │
│  │                                                     │   │
│  │ Q2: Has consumerism changed in recent years? How?   │   │
│  │                                                     │   │
│  │ Q3: Do you think advertising influences what people │   │
│  │     buy? In what way?                               │   │
│  │                                                     │   │
│  │ Q4: Should governments restrict advertising?        │   │
│  │                                                     │   │
│  │ Q5: [+ Add discussion question...]                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Difficulty Progression:                                    │
│  [✓] Questions move from concrete → abstract               │
│  [!] Consider adding more abstract/analytical questions     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### **Evaluator Notes Field (Critical for Examiners)**

```
┌─────────────────────────────────────────────────────────────┐
│  📝 EVALUATOR NOTES (Private - Student Cannot See)         │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  These notes are visible only to the examiner conducting    │
│  the speaking test. Use them for guidance, reminders,       │
│  or special instructions.                                   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ General Instructions:                                │   │
│  │ • Ensure candidate speaks for full 2 minutes in     │   │
│  │   Part 2. Prompt if necessary after 1 min.          │   │
│  │ • For Part 3, challenge the candidate's opinions.   │   │
│  │ • Pay attention to grammatical range and fluency.   │   │
│  │                                                     │   │
│  │ Specific Notes for This Test:                        │   │
│  │ [Free-text area for examiner to read or add notes]  │   │
│  │                                                     │   │
│  │ Example: "This candidate may need extra             │   │
│  │ encouragement in Part 2. They tend to give          │   │
│  │ short answers."                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [Save Notes]                                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## **10. Scoring & Grading System UI**

### 10.1 The IELTS Band Score System (0-9 Scale)

**Understanding the Challenge:**
Unlike percentage-based grading, IELTS uses a band system where raw scores convert differently for Academic vs. General Training.

### 10.2 Raw-to-Band Conversion Matrix UI

**Location:** Exam Settings → Grading Configuration

```
┌─────────────────────────────────────────────────────────────┐
│  🎯 GRADING CONFIGURATION                                   │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Test Type:                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ (●) IELTS Academic                                  │   │
│  │ ( ) IELTS General Training                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ⚠️ Changing test type will reset conversion tables to     │
│     official IELTS standards for that type.                 │
│                                                             │
│  ── READING RAW SCORE TO BAND CONVERSION ──────────────    │
│                                                             │
│  Academic Reading:                                          │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐  │
│  │ Raw Score│  0-12   │ 13-19    │ 20-28    │ 29-40    │  │
│  ├──────────┼──────────┼──────────┼──────────┼──────────┤  │
│  │ Band     │   4.0   │  4.5-5.0 │  5.5-6.5 │  7.0-9.0 │  │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘  │
│                                                             │
│  [View Full Table] [Customize (not recommended)]            │
│                                                             │
│  General Training Reading:                                  │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐  │
│  │ Raw Score│  0-11   │ 12-17    │ 18-27    │ 28-40    │  │
│  ├──────────┼──────────┼──────────┼──────────┼──────────┤  │
│  │ Band     │   3.0   │  3.5-4.5 │  5.0-6.0 │  7.0-9.0 │  │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘  │
│                                                             │
│  [View Full Table] [Customize (not recommended)]            │
│                                                             │
│  ── LISTENING CONVERSION (Same for Both) ──────────────    │
│                                                             │
│  ┌──────────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐  │
│  │ Raw      │0-3 │4-9 │10-15│16-21│22-26│27-30│31-33│34-36│37-40│
│  ├──────────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤  │
│  │ Band     │4.0 │4.5 │5.0 │5.5 │6.0 │6.5 │7.0 │7.5 │8.0-9│  │
│  └──────────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘  │
│                                                             │
│  [Reset to Official Standards]                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Interactive Table Features:**
- Hover over cell to see exact mapping tooltip
- Click cell to edit (if customization enabled)
- **Warning system:** If custom values deviate >10% from official standards, red warning appears
- **Export:** Download conversion table as PDF for reference

### 10.3 Subjective Grading Rubrics (Writing & Speaking)

**Rubric Attachment Interface:**

```
┌─────────────────────────────────────────────────────────────┐
│  📋 SUBJECTIVE RUBRICS (Writing & Speaking)                 │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Writing Task Response Criteria:                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ✅ Official IELTS Writing Rubric (Attached)          │   │
│  │                                                     │   │
│  │ Criteria Breakdown:                                 │   │
│  │ • Task Achievement (TA) - Weight: 25%               │   │
│  │ • Coherence & Cohesion (CC) - Weight: 25%           │   │
│  │ • Lexical Resource (LR) - Weight: 25%               │   │
│  │ • Grammatical Range & Accuracy (GRA) - Weight: 25%  │   │
│  │                                                     │   │
│  │ Band Descriptors:                                   │   │
│  │ [View Band 9 descriptors] [View Band 7] [...]       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Speaking Criteria:                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ✅ Official IELTS Speaking Rubric (Attached)         │   │
│  │                                                     │   │
│  │ Criteria Breakdown:                                 │   │
│  │ • Fluency & Coherence (FC) - Weight: 25%            │   │
│  │ • Lexical Resource (LR) - Weight: 25%               │   │
│  │ • Grammatical Range & Accuracy (GRA) - Weight: 25%  │   │
│  │ • Pronunciation (P) - Weight: 25%                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Customization Options:                                     │
│  [Modify Weights] [Add Custom Criteria]                    │
│  [Attach Institution-Specific Rubric]                      │
│                                                             │
│  📤 These rubrics will be embedded in the grader's view    │
│     when assessing student submissions.                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Grader View Integration:**
When a teacher/examiner grades a Writing submission:
```
┌─────────────────────────────────────────────────────────────┐
│  GRADING VIEW: Writing Task 2 - Student: John Smith        │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │  Student Essay  │  │  RUBRIC-BASED SCORING            │  │
│  │                 │  │                                 │  │
│  │  [Essay text    │  │  Task Achievement:               │  │
│  │   displayed     │  │  [Band 6 ▾]                      │  │
│  │   here...]      │  │  Comments: [________________]    │  │
│  │                 │  │                                 │  │
│  │  Word Count:    │  │  Coherence & Cohesion:           │  │
│  │  287 words ✅   │  │  [Band 7 ▾]                      │  │
│  │                 │  │  Comments: [________________]    │  │
│  │                 │  │                                 │  │
│  │                 │  │  Lexical Resource:               │  │
│  │                 │  │  [Band 6 ▾]                      │  │
│  │                 │  │  Comments: [________________]    │  │
│  │                 │  │                                 │  │
│  │                 │  │  Grammatical Range:              │  │
│  │                 │  │  [Band 7 ▾]                      │  │
│  │                 │  │  Comments: [________________]    │  │
│  │                 │  │                                 │  │
│  │                 │  │  ─────────────────────────      │  │
│  │                 │  │  FINAL BAND: 6.5                 │  │
│  │                 │  │  [Submit Grade]                  │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## **11. Time Management Interface**

### 11.1 Module-Level Timer Configuration

**Location:** Exam Settings → Time Management

```
┌─────────────────────────────────────────────────────────────┐
│  ⏱️ TIME MANAGEMENT SETTINGS                                │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Global Settings:                                           │
│  [✓] Enable Timers                                          │
│  [✓] Auto-submit when time expires                          │
│  [✓] Lock module after submission                           │
│  [ ] Allow pause (for technical difficulties)               │
│                                                             │
│  ── MODULE TIMERS ──────────────────────────────────────    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🎧 LISTENING                                        │   │
│  │ Total Time: [30:00] minutes                         │   │
│  │                                                     │   │
│  │ [✓] Include audio playback time in timer            │   │
│  │ [✓] Auto-advance after last question                │   │
│  │ [ ] Allow replay of sections (limit: [___] times)   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 📚 READING                                          │   │
│  │ Total Time: [60:00] minutes                         │   │
│  │                                                     │   │
│  │ [✓] No warnings during test                         │   │
│  │ [ ] Warn at 30 minutes remaining                    │   │
│  │ [ ] Warn at 10 minutes remaining                    │   │
│  │ [✓] Auto-submit at 00:00                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ✍️ WRITING                                          │   │
│  │ Total Time: [60:00] minutes                         │   │
│  │                                                     │   │
│  │ Task 1 Allocation: [20:00] minutes                  │   │
│  │ Task 2 Allocation: [40:00] minutes                  │   │
│  │                                                     │   │
│  │ [✓] Show suggested time split to student            │   │
│  │ [✓] Allow early submission of individual tasks      │   │
│  │ [ ] Transfer unused time from Task 1 to Task 2      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🗣️ SPEAKING                                         │   │
│  │ Total Time: [11:00-14:00] minutes (range)           │   │
│  │                                                     │   │
│  │ Part 1: [4-5] minutes                               │   │
│  │ Part 2: [3-4] minutes (includes 1 min prep)         │   │
│  │ Part 3: [4-5] minutes                               │   │
│  │                                                     │   │
│  │ [⚠️ Speaking times managed by examiner, not timer]  │   │
│  │ [✓] Show examiner timing guide                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [Save Timer Settings]                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 11.2 Student Timer View (Preview)

What the student sees during exam:

```
┌─────────────────────────────────────────────────────────────┐
│  READING MODULE                          ⏱ 47:23 remaining │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  [Passage Text Area - Student is reading]                   │
│                                                             │
│  [Questions Area - Student is answering]                    │
│                                                             │
│  Timer Bar: [████████████████████████░░░░░░░░░░] 79%       │
│                                                             │
│  Status: [Answered: 23/40]  [Flagged: 3]  [Current: Q24]   │
│                                                             │
│  [Previous] [Next] [Flag for Review]                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Timer Behaviors:**
- **Color Changes:**
  - >10 min: Green (#10B981)
  - 5-10 min: Amber (#F59E0B)
  - <5 min: Red (#EF4444) + pulsing animation
- **Audio Alert:** Optional beep at 10 min and 5 min marks
- **Auto-submit:** At 00:00, exam submits automatically with confirmation modal

---

## **12. Core Global Mechanics**

### 12.1 The "Global Sequential Auto-Numbering" Engine

**Problem Statement:**
In IELTS, questions must be numbered 1-40 sequentially per module. Manual numbering is error-prone and breaks when questions are reordered or deleted.

**Solution: Fully Automatic Numbering**

**Architecture:**
```
┌─────────────────────────────────────────────┐
│         AUTO-NUMBERING ENGINE               │
│  ─────────────────────────────────────────  │
│                                             │
│  INPUT: Ordered list of question blocks     │
│                                             │
│  ALGORITHM:                                 │
│  1. Traverse blocks in visual order          │
│  2. For each block, assign starting number  │
│  3. Increment by number of questions in     │
│     block (accounting for multi-select      │
│     allocations)                            │
│  4. Update all UI references instantly      │
│                                             │
│  OUTPUT: Every question has unique,         │
│  sequential number within module            │
│                                             │
└─────────────────────────────────────────────┘
```

**Example Scenario:**

**Initial State:**
```
Reading Module
├── Block A: Q1-6 (T/F/NG)        ← 6 questions
├── Block B: Q7-13 (Matching)     ← 7 questions
└── Block C: Q14-20 (Cloze)       ← 7 questions
Total: 20 questions (Passage 1 of 3)
```

**Action:** User drags Block C above Block B

**Instant Result (No manual intervention):**
```
Reading Module
├── Block A: Q1-6 (T/F/NG)        ← Unchanged
├── Block C: Q7-13 (Cloze)       ← Was Q14-20, now renumbered
└── Block B: Q14-20 (Matching)    ← Was Q7-13, now renumbered
Total: 20 questions (order changed)
```

**Animation:**
- Numbers "morph" to new values (crossfade effect, 300ms)
- Brief highlight (yellow flash) on changed numbers
- Sidebar updates simultaneously

**Edge Cases Handled:**

| Scenario | Behavior |
|----------|----------|
| Delete question in middle | All subsequent numbers shift down (-1) |
| Insert new block between existing | Following blocks push down (+n, where n = new block size) |
| Change multi-select from 2 to 3 correct answers | Block consumes 1 extra question number; subsequent blocks push down |
| Move block to different passage | Source passage numbers close gap; destination passage inserts and pushes down |

**Developer Implementation Notes:**
```javascript
// Pseudocode for auto-numbering engine
function recalculateNumbers(module) {
  let currentNumber = 1;
  
  // Get all blocks ordered by visual position (from DOM or state)
  const orderedBlocks = getBlocksInOrder(module);
  
  orderedBlocks.forEach(block => {
    block.startingNumber = currentNumber;
    
    // Calculate how many question numbers this block consumes
    const questionCount = block.questions.length;
    
    // Special case: Multi-select MCQ
    if (block.type === 'multi_select_mcq') {
      const correctAnswersRequired = block.settings.correctCount;
      block.questionNumbersConsumed = correctAnswersRequired;
      currentNumber += correctAnswersRequired;
    } else {
      block.questionNumbersConsumed = questionCount;
      currentNumber += questionCount;
    }
    
    // Update individual question numbers within block
    updateInternalQuestionNumbers(block);
  });
  
  // Trigger UI re-render with animation
  renderWithTransition(orderedBlocks);
}
```

**User Control Override (Rare Cases):**
While fully automatic is default, power users can:
- Right-click block → **"Manually Set Starting Number"**
- This overrides auto for that block only
- Shows warning icon (⚠️) indicating non-standard numbering
- **Not recommended** but available for edge cases

### 12.2 The "Question Block" Grouping UI

**Philosophy:** Questions are never orphans. They always belong to a "family" (block).

**Visual Grouping Components:**

**Block Container Card:**
```
╭════════════════════════════════════════════════════════╮
│ ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■│
│ ■  Questions 14-20                    [⋮]  [−]      ■ │
│ ■  ─────────────────────────────────────────────────  ■ │
│ ■                                                    ■ │
│ ■  Type: [Sentence Completion]  Difficulty: [Medium] ■ │
│ ■                                                    ■ │
│ ■  ┌────────────────────────────────────────────┐   ■ │
│ ■  │ Q14: The factory was located near the _____│   ■ │
│ ■  │     river for easy transportation.         │   ■ │
│ ■  │     Answer: [river_____] [✏️] [🗑️]        │   ■ │
│ ■  │                                          │   ■ │
│ ■  │ Q15: Workers were paid _____ per week.    │   ■ │
│ ■  │     Answer: [low wages___] [✏️] [🗑️]    │   ■ │
│ ■  └────────────────────────────────────────────┘   ■ │
│ ■                                                    ■ │
│ ■  [+ Add Question to this block]                    ■ │
│ ╰════════════════════════════════════════════════════════╯
```

**Visual Distinction:**
- **Border-left:** 4px colored strip matching question type
- **Background:** White with subtle shadow (elevation)
- **Header:** Light gray background (#F9FAFB), bold text
- **Corner radius:** 8px (consistent with design system)
- **Spacing between blocks:** 16px margin-bottom

**Block Operations:**

**Collapse/Expand:**
- Click header to collapse
- Collapsed state:
  ```
  ╭──────────────────────────────────╮
  │ ▸ Q14-20: Sentence Completion    │
  │    (7 questions)  [⋮]           │
  ╰──────────────────────────────────╯
  ```
- Chevron indicates state (▸ collapsed, ▾ expanded)

**Drag Handle:**
- Left side of header shows grip icon when hovered: `⠿`
- Entire block draggable via this handle
- Cursor changes to `grab` then `grabbing`

**Selection State:**
- Click block header to select (for batch operations)
- Selected: Blue outline (2px solid #3B82F6), light blue background tint
- Multi-select: Cmd/Ctrl + click to select multiple blocks
- Batch actions toolbar appears: [Move] [Duplicate] [Delete] [Export]

**Block Internal Layout:**

Questions within a block follow consistent pattern:
```
┌─────────────────────────────────────────────┐
│ Q[n]: [Question text/statement]             │
│                                                │
│ [Answer input area - varies by type]           │
│ [Edit] [Delete] [Move Up] [Move Down]         │
└─────────────────────────────────────────────┘
```

**Reordering Within Block:**
- Drag questions using handle (left side)
- Or use ↑↓ buttons
- Auto-numbers adjust within block (though global number usually unchanged unless cross-block move)

**Splitting Blocks:**
Sometimes a block needs dividing:
1. Select questions to extract
2. Right-click → **"Split into New Block"**
3. Selected questions move to new block inserted immediately after current
4. Auto-renumbering triggers

**Merging Blocks:**
1. Select two adjacent blocks of same type
2. Right-click → **"Merge Blocks"**
3. Questions combine into single block (first block's header preserved)
4. Auto-renumbering triggers

---

## **13. Interaction Patterns & Micro-interactions**

### 13.1 Loading States

**Initial Workspace Load:**
```
┌─────────────────────────────────────────────┐
│                                             │
│           🔄 Loading Exam Workspace         │
│                                             │
│         ████████████░░░░░░░░░░  67%         │
│                                             │
│  Loading modules...                          │
│  ✓ Listening configuration loaded           │
│  ✓ Reading passages retrieved               │
│  ⏳ Writing prompts loading...               │
│  ○ Speaking rubrics pending...              │
│                                             │
└─────────────────────────────────────────────┘
```

**Skeleton Screens (Preferred over spinners):**
While content loads, show skeleton shapes:
- Sidebar: Gray rectangles simulating module structure
- Content area: Gray boxes simulating text lines and cards
- Smooth fade-in when real content loads (200ms)

### 13.2 Empty States

**Brand New Exam (No Content Yet):**
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                    📝 Let's Build Your IELTS Exam           │
│                                                             │
│         Your exam canvas is ready. Start by adding          │
│              content to any module below.                   │
│                                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│  │  🎧     │  │  📚     │  │  ✍️     │  │  🗣️     │      │
│  │Listen.  │  │Reading  │  │Writing  │  │Speaking │      │
│  │         │  │         │  │         │  │         │      │
│  │[+ Add]  │  │[+ Add]  │  │[+ Add]  │  │[+ Add]  │      │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘      │
│                                                             │
│  💡 Tip: Most creators start with Reading or Listening,     │
│     as these contain the most questions.                    │
│                                                             │
│  [Watch Tutorial Video] [Load Template] [Import from File]  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Empty Module (e.g., Reading has no passages):**
```
┌─────────────────────────────────────────────┐
│                                             │
│  📚 Reading Module is Empty                 │
│                                             │
│  Add a reading passage to begin building    │
│  questions.                                 │
│                                             │
│  [+ Add Passage 1]                          │
│                                             │
│  Or choose a template:                      │
│  [Academic Test A] [Practice Test 3]        │
│                                             │
└─────────────────────────────────────────────┘
```

### 13.3 Success/Error Feedback

**Success States:**
- **Block created:** Brief green checkmark animation (✓) top-right corner, slides away after 2s
- **Saved:** "All changes saved" text in header with timestamp
- **Validated:** Green border flash around component (300ms)

**Error States:**
- **Validation error:** Red border, error message below field, shake animation
- **Conflict detected:** Yellow warning banner with explanation
- **Save failed:** Toast notification with retry button

**Example Error Message:**
```
⚠ Cannot save question block

Issue: T/F/NG block contains duplicate statement.
       "The revolution began in Britain" appears twice (Q3 and Q7).

Fix: Edit the statements to make them unique, or remove the duplicate.
     [Go to Q3]  [Go to Q7]  [Dismiss]
```

### 13.4 Undo/Redo System

**Global Undo Stack:**
- `Ctrl/Cmd + Z`: Undo last action
- `Ctrl/Cmd + Shift + Z` / `Ctrl/Cmd + Y`: Redo
- Unlimited history (within session)
- **Actions tracked:**
  - Question text edits
  - Block reorder/move/delete
  - Answer changes
  - Stimulus modifications
  - Settings changes

**Undo Toast:**
```
┌─────────────────────────────┐
│ ↩ Undeleted "Questions 7-13"│
│ [Undo] [Redo]        [×]    │
└─────────────────────────────┘
```

### 13.5 Keyboard Shortcuts (Power User Features)

**Global Shortcuts:**
| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + S` | Save exam |
| `Cmd/Ctrl + Z` | Undo |
| `Cmd/Cmd + Shift + Z` | Redo |
| `Cmd/Ctrl + N` | New question block |
| `Cmd/Ctrl + F` | Find in exam |
| `Cmd/Cmd + K` | Quick jump (command palette) |

**Editor Shortcuts (Within Stimulus/Question Panes):**
| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + B` | Bold |
| `Cmd/Ctrl + I` | Italic |
| `Cmd/Ctrl + U` | Underline |
| `Cmd/Ctrl + Convert to Blank` (in Cloze editor) | Create blank from selection |
| `Enter` (in T/F/NG rapid mode) | Add new row |
| `Tab` | Move to next field/question |
| `Shift + Tab` | Move to previous field/question |
| `Cmd/Ctrl + D` | Duplicate current question/block |

**Command Palette (`Cmd/Ctrl + K`):**
```
┌─────────────────────────────────────────────┐
│  🔍 Search commands or jump to...           │
│  [________________________________]         │
│                                             │
│  Recent:                                    │
│  Go to Reading Passage 2                    │
│  Add T/F/NG block                          │
│  Save exam                                 │
│                                             │
│  Commands:                                 │
│  > Add question block                      │
│  > Go to Listening Part 3                  │
│  > Preview student view                    │
│  > Export exam as PDF                      │
│  > Toggle word count display               │
│                                             │
└─────────────────────────────────────────────┘
```

### 13.6 Tooltip System

**Tooltips provide context without cluttering UI:**

**Trigger:** Hover (delay 500ms) or focus (immediate for keyboard users)

**Types:**
1. **Descriptive:** Explains what a button does
   ```
   [i] Converts selected text into a fill-in-the-blank
       space. The original word becomes the correct
       answer.
   ```

2. **Informational:** Shows additional data
   ```
   [i] This passage contains 892 words.
       Average IELTS passage: 700-1000 words.
   ```

3. **Warning:** Alerts to potential issues
   ```
   [⚠] This block has 12 questions. Consider splitting
       into two blocks for better organization.
   ```

**Styling:**
- Max width: 280px
- Background: Dark (#1F2937) with white text
- Arrow pointing to trigger element
- Dismiss: Click outside, press Escape, or move mouse away

### 13.7 Confirmation Modals

**Destructive Actions Require Confirmation:**

**Delete Block Modal:**
```
┌─────────────────────────────────────────────┐
│  ⚠️ Delete Question Block?                  │
│  ─────────────────────────────────────────  │
│                                             │
│  You are about to delete:                   │
│  "Questions 14-20: Sentence Completion"     │
│                                             │
│  This will permanently delete 7 questions   │
│  and their associated answers.              │
│                                             │
│  Affected numbering:                        │
│  • Questions 21-27 will become Q14-20       │
│  • Questions 28-34 will become Q21-27       │
│  • (and so on for remaining questions)      │
│                                             │
│  [Cancel]                    [Delete Block] │
│                                             │
└─────────────────────────────────────────────┘
```

**Modal Rules:**
- Always show what will be affected
- Use red color for destructive button
- Never use "Confirm" as button text—use action verb ("Delete", "Remove", "Discard")
- Escape key cancels
- Click outside cancels (optional, can disable for critical actions)

---

## **14. Accessibility Requirements**

### 14.1 WCAG 2.1 AA Compliance (Minimum Target)

**Color Contrast:**
- Normal text: Minimum 4.5:1 contrast ratio against background
- Large text (18pt+): Minimum 3:1 ratio
- Interactive elements: Visible focus indicators (3px outline, offset 2px)

**Keyboard Navigation:**
- All functions accessible via keyboard alone
- Logical tab order (follows visual flow: sidebar → header → left pane → right pane)
- No keyboard traps (modal exceptions acceptable with clear exit)
- Skip links provided: "Skip to main content", "Skip to sidebar"

**Screen Reader Support:**
- ARIA labels on all interactive elements
- Regions marked properly: `role="navigation"`, `role="main"`, `role="complementary"`
- Live regions for dynamic content updates (auto-numbering changes, save confirmations)
- Alt text for all images (stimulus images require descriptive alt)

**Specific Accessibility Implementations:**

**Sidebar Navigation:**
- `aria-label="Exam module navigator"`
- `aria-expanded="true/false"` on collapsible sections
- `aria-current="page"` on active module
- Each item is a focusable link/button

**Drag and Drop:**
- Provide alternative: "Move" context menu item for keyboard users
- Announce drag start/end: `"Moving Questions 7-13 to new position"`
- Escape key cancels drag operation

**Cloze Editor (Highlight to Blank):**
- Keyboard alternative: Select text, press Enter or context menu
- Screen reader announces: `"Selected text: 'coal'. Press Enter to convert to blank."`
- Blank areas announced as: `"Blank 1, currently empty"` or `"Blank 1, answer: coal"`

**T/F/NG Radios:**
- Fieldset with legend: `"Answers for statement 3"`
- Each radio: `aria-label="True"`, checked state announced
- Rapid entry mode: Announces each new row addition

**Map/Diagram Labeling:**
- Hotspots are focusable (Tab navigates between pins)
- Each hotspot announces: `"Question 21, position: upper left area"`
- Configuration panel is a dialog (`role="dialog"`) with focus trap

**Audio Player:**
- Standard HTML5 `<audio>` with controls
- Keyboard shortcuts: Space = play/pause, Arrow keys = seek
- Transcripts provided (required for accessibility): `[Show Transcript]` button

### 14.2 Motion Sensitivity

**Respect `prefers-reduced-motion` media query:**
- Users who prefer reduced motion see instant transitions (no animations)
- Disable: Number morphing animations, slide-in panels, pulsing timers
- Keep: Essential state changes (color updates, visibility toggles)

### 14.3 Cognitive Accessibility

**Clear Language:**
- Avoid jargon in UI labels
- Use consistent terminology ("block" always means grouping, never "section" or "group")
- Error messages written in plain language

**Consistent Layout:**
- Similar functionality in similar positions across modules
- Predictable behavior (save button always top-right, sidebar always left)

**Error Prevention:**
- Confirmation before destructive actions
- Undo capability for most operations
- Clear indication of unsaved changes (dot in title bar: `Exam Name *`)

---

## **15. Responsive Design Considerations**

### 15.1 Tablet Adaptation (768px - 1024px)

**Layout Changes:**
- Sidebar collapses to icon-only mode (64px wide)
- Icons show tooltips on hover/tap
- Dual-pane maintained but narrower
- Touch targets increased to minimum 44x44px

**Touch Interactions:**
- Drag and drop via touch (long-press to initiate)
- Swipe gestures for pane resizing
- On-screen keyboard doesn't obscure critical inputs

### 15.2 Mobile Adaptation (< 768px)

**Major Restructuring Needed:**

**Single-Pane View with Tab Switching:**
```
┌─────────────────────────┐
│ [≡]  READING MODULE  [💾]│
├─────────────────────────┤
│                         │
│  [Stimulus] [Questions] │  ← Tab switcher
│  ─────────────────────  │
│                         │
│  (Only one pane visible │
│   at a time)            │
│                         │
│  [Passage text or       │
│   Question builder      │
│   depending on tab]     │
│                         │
└─────────────────────────┘
```

**Mobile-Specific Workflows:**
- Simplified question templates (fewer features visible)
- Vertical stacking of T/F/NG (instead of spreadsheet)
- Full-screen image view for map/diagram labeling
- Swipe between questions (card-style navigation)

**Mobile Limitations (Acceptable Compromises):**
- Split-screen disabled (alternating tabs instead)
- Drag-and-drop disabled (use reorder buttons instead)
- Some advanced features hidden behind "Desktop Mode" prompt

**Responsive Banner (on Mobile):**
```
┌─────────────────────────────────────────────┐
│  💻 For the best experience, use a desktop  │
│     or tablet device to build IELTS exams.  │
│                                             │
│  You can make basic edits on mobile, but    │
│  some features require larger screens.      │
│                                             │
│  [Continue to Mobile View] [Dismiss]        │
└─────────────────────────────────────────────┘
```

---

## **Appendix A: Glossary of Terms**

| Term | Definition |
|------|------------|
| **Stimulus** | The source material (reading passage, audio track, or image) that questions reference |
| **Question Block** | A grouped set of questions sharing the same format and linked to one stimulus |
| **Cloze** | Fill-in-the-blank question type where words are removed from a text |
| **T/F/NG** | True / False / Not Given - factual evaluation question type |
| **Y/N/NG** | Yes / No / Not Given - opinion evaluation question type |
| **Band Score** | IELTS scoring scale from 0 (non-user) to 9 (expert user) |
| **Raw Score** | Number of correct answers before band conversion |
| **Academic** | IELTS variant for university admission |
| **General Training** | IELTS variant for work/immigration purposes |
| **Cue Card** | Speaking Part 2 prompt card with topic and bullet points |
| **Auto-Numbering Engine** | System that assigns sequential question numbers automatically |

---

## **Appendix B: User Flow Diagrams**

### Flow 1: Creating a Reading Section

```
START
  │
  ▼
[Click "Create New Exam"]
  │
  ▼
[Select: Academic or GT]
  │
  ▼
[Workspace Opens - 4 Modules Visible]
  │
  ▼
[Click "Reading" in Sidebar]
  │
  ▼
[Reading Workspace Loads (Empty)]
  │
  ▼
[Click "+ Add Passage 1"]
  │
  ▼
[Split-Screen Appears]
  │
  ├── LEFT PANE: Rich Text Editor (Empty)
  │
  └── RIGHT PANE: "+ Add Question Block" Button
         │
         ▼
[Paste/Type Passage Text in Left Pane]
  │
  ▼
[Click "+ Add Question Block" in Right Pane]
  │
  ▼
[Template Selection Modal Opens]
  │
  ▼
[Select "T/F/NG"]
  │
  ▼
[T/F/NG Block Renders]
  │
  ▼
[Type Statements, Select T/F/NG Answers]
  │
  ▼
[Repeat: Add More Blocks (Cloze, Matching, etc.)]
  │
  ▼
[System Auto-Numbers: Q1-40]
  │
  ▼
[Click "+ Add Passage 2"] (Repeat Process)
  │
  ▼
[Save Exam] (Ctrl+S or Click Save Button)
  │
  ▼
END
```

### Flow 2: Creating a Listening Section with Audio

```
START
  │
  ▼
[Navigate to Listening Module]
  │
  ▼
[Click "+ Add Part 1"]
  │
  ▼
[Audio Upload Interface Appears]
  │
  ▼
[Drag/Drop MP3 File]
  │
  ▼
[Audio Player Renders with Waveform]
  │
  ▼
[Play Audio to Review]
  │
  ▼
[Click "+ Add Timestamp Pin" at 00:45]
  │
  ▼
[Label Pin: "Q1-5 Location"]
  │
  ▼
[Add Question Block: "Multiple Choice"]
  │
  ▼
[Build Questions 1-10 for Part 1]
  │
  ▼
[Click "+ Add Part 2"]
  │
  ▼
[Upload Next Audio Section OR Continue Same File]
  │
  ▼
[Add Timestamp Pins for Part 2]
  │
  ▼
[Build Questions 11-20]
  │
  ▼
[Repeat for Parts 3 & 4 (Q21-40)]
  │
  ▼
END
```

---

## **Appendix C: Component Inventory**

### Atomic Components

**Buttons:**
- Primary (solid blue, white text)
- Secondary (outline, blue border)
- Danger (red, for deletions)
- Ghost (transparent, hover gray)
- Icon-only (with tooltip)
- Size variants: sm (32px), md (40px), lg (48px)

**Form Inputs:**
- Text field (single line)
- Text area (multi-line, auto-expand)
- Rich text editor (full formatting)
- Select/dropdown
- Radio group
- Checkbox group
- Toggle switch
- File upload (drag zone)
- Color picker (for annotations)

**Display Components:**
- Badge/Pill (status indicators)
- Tag (labels, removable)
- Tooltip (informational)
- Toast notification (feedback)
- Progress bar (timers, uploads)
- Skeleton loader (placeholder)
- Avatar/Icon (visual identifiers)

**Navigation:**
- Sidebar (collapsible tree)
- Tabs (module switching)
- Breadcrumbs (location context)
- Pagination (question navigation)
- Command palette (search/jump)

**Feedback:**
- Modal (confirmations, complex forms)
- Alert banner (warnings, errors)
- Inline validation (field-level)
- Empty states (no data)
- Success checkmarks (micro-feedback)

### Composite Components

**Question Block Card** (contains: header, type badge, question list, actions)
**Stimulus Editor Pane** (contains: toolbar, editor, media embed, metadata)
**Audio Timeline** (contains: player controls, waveform, pins, zoom)
**Image Annotation Canvas** (contains: image, hotspots, drawing tools, layers)
**Scoring Matrix Table** (contains: raw scores, bands, interactive cells)
**Grading Rubric Panel** (contains: criteria list, band selectors, comment fields)

---

## **Appendix D: Design Token Reference**

### Colors

```css
/* Primary Palette */
--color-primary-50: #EFF6FF;
--color-primary-100: #DBEAFE;
--color-primary-500: #3B82F6;  /* Main brand blue */
--color-primary-600: #2563EB;
--color-primary-700: #1D4ED8;

/* Semantic Colors */
--color-success: #10B981;    /* Green - correct, complete */
--color-warning: #F59E0B;    /* Amber - caution, pending */
--color-error: #EF4444;      /* Red - errors, delete */
--color-info: #6366F1;       /* Indigo - informational */

/* Neutral Palette */
--color-gray-50: #F9FAFB;    /* Background */
--color-gray-100: #F3F4F6;   /* Borders, dividers */
--color-gray-200: #E5E7EB;   /* Disabled states */
--color-gray-500: #6B7280;   /* Secondary text */
--color-gray-900: #111827;   /* Primary text */

/* Module Accent Colors */
--color-listening: #3B82F6;  /* Blue */
--color-reading: #10B981;    /* Green */
--color-writing: #F59E0B;    /* Amber */
--color-speaking: #EF4444;   /* Red */

/* Question Type Colors */
--color-cloze: #3B82F6;      /* Blue */
--color-tfng: #F59E0B;       /* Amber */
--color-matching: #8B5CF6;   /* Purple */
--color-map-label: #14B8A6;  /* Teal */
--color-mcq: #F43F5E;        /* Rose */
```

### Shadows

```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07);
--shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
--shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.15);
```

### Border Radius

```css
--radius-sm: 4px;   /* Buttons, inputs */
--radius-md: 8px;   /* Cards, modals */
--radius-lg: 12px;  /* Large containers */
--radius-full: 9999px; /* Pills, avatars */
```

### Transitions

```css
--transition-fast: 150ms ease;
--transition-base: 250ms ease;
--transition-slow: 350ms ease;
```

---

## **Document Version History**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024 | UX Team | Initial comprehensive specification |

---

## **End of Document**

**Status:** Ready for Development Handoff  
**Next Steps:** 
1. Design review with stakeholders
2. Prototype development (high-fidelity)
3. Usability testing with target users (IELTS content creators)
4. Developer implementation sprints
5. QA against acceptance criteria in this document

---

*This document represents the complete UX/UI specification for the IELTS Exam Builder platform. All interactions, layouts, components, and behaviors described herein should be treated as requirements for development unless explicitly marked as optional or aspirational.*
