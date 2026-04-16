# **IELTS Exam Platform: Management & Administration System**
## **Complete UX/UI Specification Document**

---

## **Document Overview**

**Version:** 1.0  
**Type:** Product Design Specification (PDS) - Management Layer  
**Target Audience:** Product Managers, UI/UX Designers, Full-Stack Developers, DevOps Engineers  
**Scope:** Complete management system bridging **Exam Builder** → **Student Delivery** → **Results Processing**

---

## **Table of Contents**

1. [Executive Summary](#1-executive-summary)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Master Dashboard](#3-master-dashboard)
4. [Exam Library & Repository](#4-exam-library--repository)
5. [User & Role Management](#5-user--role-management)
6. [Exam Deployment & Scheduling](#6-exam-deployment--scheduling)
7. [Class/Cohort Management](#7-classcohort-management)
8. [Template & Asset Management](#8-template--asset-management)
9. [Collaboration & Workflow](#9-collaboration--workflow)
10. [Version Control & History](#10-version-control--history)
11. [Import/Export & Sharing](#11-importexport--sharing)
12. [Grading & Review Center](#12-grading--review-center)
13. [Results & Analytics](#13-results--analytics)
14. [Settings & Configuration](#14-settings--configuration)
15. [Notification System](#15-notification-system)
16. [Responsive Admin Portal](#16-responsive-admin-portal)

---

## **1. Executive Summary**

### 1.1 The "Missing Middle" Problem

Most educational platforms focus heavily on either:
- **Content Creation** (the Builder we already specified), OR
- **Test Delivery** (the Student interface we just specified)

But the **management layer** between them is often neglected. This document defines the complete administrative ecosystem that makes IELTS exam platforms viable for institutions.

### 1.2 Core Management Domains

```
┌─────────────────────────────────────────────────────────────┐
│                    IELTS PLATFORM ECOSYSTEM                  │
│                                                             │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │   BUILDER    │───▶│  MANAGEMENT  │───▶│   STUDENT    │   │
│  │   (Create)   │    │    LAYER     │    │   (Take)     │   │
│  └─────────────┘    └──────────────┘    └──────────────┘   │
│                            │                                 │
│              ┌─────────────┼─────────────┐                   │
│              ▼             ▼             ▼                   │
│        ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│        │  Users   │ │ Schedule │ │ Results  │              │
│        │  Roles   │ │ Deploy   │ │ Grade    │              │
│        └──────────┘ └──────────┘ └──────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 Key Personas Served

| Persona | Primary Needs | Key Screens |
|---------|--------------|-------------|
| **Administrator** | User management, system config, oversight | Settings, User Admin, Audit Log |
| **Exam Creator/Teacher** | Build, organize, deploy, grade | Dashboard, Exam Library, Grading |
| **Proctor/Invigilator** | Monitor sessions, verify students | Session List, Student Verification |
| **Student** (indirect) | Access assigned exams, view results | Student Portal (separate spec) |
| **Grader** | Score Writing/Speaking responses | Grading Queue, Rubric Interface |

---

## **2. System Architecture Overview]

### 2.1 High-Level Information Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      DATA FLOW DIAGRAM                          │
│                                                                 │
│  CREATION PHASE                                                 │
│  ══════════════                                                │
│                                                                 │
│  [Creator] ──▶ [Builder UI] ──▶ [Exam Draft] ──▶ [Library]     │
│                     │                    │                      │
│                     ▼                    ▼                      │
│               [Assets Store]       [Version History]           │
│                                                                 │
│  MANAGEMENT PHASE                                               │
│  ══════════════════                                            │
│                                                                 │
│  [Library] ──▶ [Schedule] ──▶ [Assign] ──▶ [Cohort]           │
│      │            │           │          │                    │
│      ▼            ▼           ▼          ▼                    │
│  [Templates]   [Calendar]  [Notifications] [Roster]            │
│                                                                 │
│  DELIVERY PHASE                                                 │
│  ═══════════════                                               │
│                                                                 │
│  [Cohort] ──▶ [Student Portal] ──▶ [Exam Session]              │
│                                     │                         │
│                                     ▼                         │
│                              [Response Store]                  │
│                                     │                         │
│  GRADING PHASE                                                 │
│  ══════════════                                                │
│                                                                 │
│  [Response] ──▶ [Auto-Score] ──▶ [Grading Queue]               │
│                     │                  │                        │
│                     ▼                  ▼                        │
│              [Raw Scores]      [Human Graders]                 │
│                     │                  │                        │
│                     └──────▶ [Band Calculator]                 │
│                                      │                         │
│                                      ▼                         │
│                               [Results Report]                │
│                                      │                         │
│                                      ▼                         │
│                             [Student ✓ / Admin ✓]             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Navigation Map (Admin Portal)

```
╔═════════════════════════════════════════════════════════════════╗
║  🎓 IELTS EXAM MANAGEMENT PLATFORM                            ║
╠═════════════════════════════════════════════════════════════════╣
║                                                               ║
║  SIDEBAR NAVIGATION                                           ║
║  ─────────────────────────────────────────────────────────    ║
║                                                               ║
║  📊 Dashboard                                                ║
║  ─────────────────────                                        ║
║                                                               ║
║  📚 Exams                                                     ║
║  ├── All Exams                                                ║
║  ├── My Exams                                                 ║
║  ├── Drafts                                                   ║
║  ├── Published                                                ║
║  ├── Archived                                                 ║
║  └── Templates                                                ║
║                                                               ║
║  👥 People                                                    ║
║  ├── Students                                                ║
║  ├── Teachers / Creators                                      ║
║  ├── Graders                                                  ║
║  ├── Proctors                                                 ║
║  └── Administrators                                           ║
║                                                               ║
║  📅 Scheduling                                                ║
║  ├── Calendar View                                            ║
║  ├── Upcoming Sessions                                        ║
║  ├── Active Now                                               ║
║  └── Past Sessions                                            ║
║                                                               ║
║  🏫 Classes / Cohorts                                         ║
║  ├── All Cohorts                                              ║
║  ├── Enrollments                                              ║
║  └── Groups                                                   ║
║                                                               ║
║  ✅ Grading                                                   ║
║  ├── Grading Queue                                            ║
║  ├── Completed Grades                                        ║
║  ├── Calibration                                             ║
║  └── Band Distribution                                       ║
║                                                               ║
║  📈 Results                                                   ║
║  ├── Score Reports                                           ║
║  ├── Analytics                                               ║
║  ├── Export Data                                             ║
║  └── Certificates                                            ║
║                                                               ║
║  ⚙️ Settings                                                 ║
║  ├── General                                                 ║
║  ├── Scoring Rules                                           ║
║  ├── Security                                                ║
║  ├── Integrations                                           ║
║  └── Billing / Plan                                          ║
║                                                               ║
╚═════════════════════════════════════════════════════════════════╝
```

---

## **3. Master Dashboard]

### 3.1 Purpose

The dashboard is the **command center** for every user type. It provides at-a-glance visibility into their domain of responsibility.

### 3.2 Layout Specification

```
╔═══════════════════════════════════════════════════════════════════╗
║  🎓 IELTS Platform                           🔔(3) 👤 Admin ▾ ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Welcome back, Dr. Sarah Chen!                    Monday, Jan 15  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  QUICK ACTIONS                                             │  ║
║  │  [+ New Exam]  [+ Import Template]  [+ Add Students]       │  ║
║  │  [View Calendar]  [Run Reports]                            │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────┐  ┌─────────────────────┐               ║
║  │  TOTAL EXAMS         │  │  ACTIVE STUDENTS     │               ║
║  │                     │  │                     │               ║
║  │  247                │  │  1,842              │               ║
║  │  ↑ 12% this month   │  │  ↑ 8% this month    │               ║
║  └─────────────────────┘  └─────────────────────┘               ║
║                                                                   ║
║  ┌─────────────────────┐  ┌─────────────────────┐               ║
║  │  EXAMS THIS WEEK     │  │  PENDING GRADING     │               ║
║  │                     │  │                     │               ║
║  │  18 scheduled       │  │  47 submissions     │               ║
║  │  5 today remaining  │  │  23 Writing tasks    │               ║
║  └─────────────────────┘  └─────────────────────┘               ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  UPCOMING EXAM SESSIONS (Next 7 Days)                      │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Date/Time      Exam Name              Cohort      Status   │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │  Today 14:00    IELTS Academic Prac A  Class 2024-A  🟢 On │  ║
║  │  Today 16:00    IELTS GT Practice B    Evening Batch ⏳ Up │  ║
║  │  Tomorrow 09:00 Mock Exam Final      Cohort C     ⏳ Up  │  ║
║  │  Wed 10:00      Diagnostic Test #12   New Intake   ⏳ Up  │  ║
║  │                                                             │  ║
║  │  [View Full Calendar →]                                   │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  RECENT ACTIVITY FEED                                      │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  2 min ago   You published "IELTS Practice Test v3"        │  ║
║  │  15 min ago  23 students completed "Diagnostic Test Q1"    │  ║
║  │  1 hr ago    Grader John finished batch of 15 essays       │  ║
║  │  3 hrs ago   New cohort "Spring 2024 Intake" created       │  ║
║  │  Yesterday   System backup completed successfully          │  ║
║  │                                                             │  ║
║  │  [View All Activity →]                                    │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  YOUR RECENTLY MODIFIED EXAMS                              │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │  ║
║  │  │ Academic A3  │ │ GT Practice  │ │ Diagnostic   │        │  ║
║  │  │ Modified:    │ │ Modified:    │ │ Modified:    │        │  ║
║  │  │ 2 hours ago  │ │ Yesterday    │ │ 3 days ago   │        │  ║
║  │  │ Status: ✅   │ │ Status: 📝   │ │ Status: ✅   │        │  ║
║  │  │ Published    │ │ Draft        │ │ Published    │        │  ║
║  │  └──────────────┘ └──────────────┘ └──────────────┘        │  ║
║  │                                                             │  ║
║  │  [View All My Exams →]                                    │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

### 3.3 KPI Cards Specifications

**Card Component:**
```css
.kpi-card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  border-left: 4px solid var(--color-primary);
}

.kpi-card .value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.kpi-card .trend {
  font-size: 0.875rem;
  display: flex;
  align-items: center;
  gap: 4px;
}
.trend-up { color: #10B981; }  /* Green */
.trend-down { color: #EF4444; } /* Red */
.trend-neutral { color: #6B7280; }
```

**KPI Types Available:**

| KPI | Data Source | Refresh Rate |
|-----|------------|--------------|
| Total Exams | Count from library | Real-time |
| Active Students | User table (status=active) | Hourly cache |
| Exams This Week | Schedule table | Real-time |
| Pending Grading | Submissions where status='awaiting_grade' | Real-time |
| Avg Completion Rate | Aggregated session data | Daily |
| Pass Rate (Band 6.5+) | Results table | Weekly |
| Storage Used | Asset store size | Hourly |

### 3.4 Role-Based Dashboard Variants

**For Teacher/Creator:**
- Focus on *their* exams, *their* classes, *their* grading queue
- Quick action: "+ Create New Exam" prominent
- Shows: Drafts needing completion, upcoming sessions they're proctoring

**For Administrator:**
- Focus on *system-wide* metrics, user management, billing
- Quick action: "Add User", "System Settings"
- Shows: License usage, storage quotas, security alerts

**For Grader:**
- Focus on grading queue only
- Shows: Assignments waiting, average grading speed, calibration status
- Quick action: "Start Grading Session"

---

## **4. Exam Library & Repository]

### 4.1 Purpose

Centralized storage for all examinations in various states of readiness.

### 4.2 Library Views

#### **View A: Grid/Card View (Default)**

```
╔═══════════════════════════════════════════════════════════════════╗
║  📚 Exam Library                              [Grid ▾] [Filter] ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Search: [________________________]  Status: [All ▾]            ║
║  Type: [All ▾]  Creator: [All ▾]  Sort: [Modified Date ▾]      ║
║                                                                   ║
║  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐  ║
║  │ 📘 Academic PT v3│  │ 📗 GT Practice 5 │  │ 📙 Diagnostic  │  ║
║  │                  │  │                  │  │  Test Q1      │  ║
║  │ Type: Academic   │  │ Type: Gen.Train. │  │ Type: Academic │  ║
║  │ Modules: 4/4     │  │ Modules: 4/4     │  │ Modules: 3/4  │  ║
║  │ Questions: 160   │  │ Questions: 155   │  │ Questions: 120 │  ║
║  │                  │  │                  │  │                │  ║
║  │ ✅ Published     │  │ 📝 Draft         │  │ ✅ Published   │  ║
║  │ Last: 2h ago     │  │ Last: 1d ago     │  │ Last: 3d ago  │  ║
║  │ By: S. Chen      │  │ By: M. Johnson   │  │ By: S. Chen   │  ║
║  │                  │  │                  │  │                │  ║
║  │ Sessions: 12     │  │ Sessions: 0      │  │ Sessions: 45   │  ║
║  │ Completions: 234  │  │                  │  │ Completions:892│  ║
║  │                  │  │                  │  │                │  ║
║  │ [Open] [Edit]    │  │ [Open] [Edit]    │  │ [Open] [Edit]  │  ║
║  │ [Duplicate] [⋯] │  │ [Publish] [⋯]   │  │ [Duplicate][⋯]│  ║
║  └──────────────────┘  └──────────────────┘  └────────────────┘  ║
║                                                                   ║
║  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐  ║
║  │ 📕 Speaking Only │  │ 📓 Listening     │  │ 📔 Archived:   │  ║
║  │  Focus Test      │  │  Intensive Drill │  │  2023 Finals   │  ║
║  │ ...              │  │ ...              │  │ ...            │  ║
║  └──────────────────┘  └──────────────────┘  └────────────────┘  ║
║                                                                   ║
║  Showing 1-24 of 247 exams                    [← Prev] [1 2...11] ║
╚═══════════════════════════════════════════════════════════════════╝
```

**Card Anatomy:**
```
╭──────────────────────────────────╮
│ [Icon] Title              [Badge]│  ← Header row
│                                │
│ Metadata row:                 │
│ • Type (Academic/GT)         │
│ • Module completeness        │
│ • Question count             │
│                                │
│ Status Badge:                 │
│ 📝 Draft / ✅ Published /     │
│ 🚫 Archived / ⚠️ Needs Review│
│                                │
│ Timestamp + Author            │
│                                │
│ Stats (if published):         │
│ • Sessions conducted          │
│ • Total completions           │
│                                │
│ Action Buttons:               │
│ [Primary] [Secondary] [Menu]  │
╰──────────────────────────────────╯
```

**Status Badges:**
| Status | Color | Icon | Meaning |
|--------|-------|------|---------|
| Draft | Gray (#9CA3AF) | 📝 | In creation, not deployable |
| Review | Amber (#F59E0B) | 👁️ | Ready for QA review |
| Published | Green (#10B981) | ✅ | Live, can be assigned |
| Scheduled | Blue (#3B82F6) | 📅 | Assigned to future session |
| Active | Purple (#8B5CF6) | 🎯 | Currently being taken |
| Archived | Dark gray (#374151) | 📦 | Hidden from default views |
| Deprecated | Red (#EF4444) | ❌ | Obsolete, shouldn't use |

#### **View B: List/Table View**

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ☐  Title              Type     Status    Modules  Q's   Creator   Modified │
├─────────────────────────────────────────────────────────────────────────┤
│ ☐  Academic PT v3     Acad.    ✅ Pub.   4/4     160   S.Chen    2h ago  │
│ ☐  GT Practice 5      G.T.     📝 Draf.  4/4     155   M.Johnson 1d ago  │
│ ☐  Diagnostic Q1      Acad.    ✅ Pub.   3/4     120   S.Chen    3d ago  │
│ ☐  Speaking Focus     Mixed    ✅ Pub.   1/4     24    A.Williams5d ago  │
│ ☐  Listening Drill    Acad.    📝 Draf.  1/4     40    K.Lee     1w ago  │
│ ...                                                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

**Table Features:**
- Column sorting (click header)
- Column visibility toggle (choose which columns show)
- Row selection (bulk actions)
- Inline preview (expand row to see summary)
- Drag to reorder (if custom order desired)

### 4.3 Exam Detail Page (Management View)

When clicking an exam card:

```
╔═══════════════════════════════════════════════════════════════════╗
║  ← Back to Library                                               ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  📘 IELTS Academic Practice Test v3          ✅ Published        ║
║  ─────────────────────────────────────────────────────────────    ║
║                                                                   ║
║  [🖊️ Edit Exam] [📋 Duplicate] [📤 Publish/Unpublish] [⋯ More]   ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  OVERVIEW                                                   │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Created: Dec 15, 2024 by Sarah Chen                        │  ║
║  │  Last Modified: Jan 15, 2025 at 09:34                       │  ║
║  │  Version: 3.2 (Published)                                  │  ║
║  │  Status: ✅ Published & Active                              │  ║
║  │                                                             │  ║
║  │  Exam Structure:                                           │  ║
║  │  • Listening: 40 questions (30 min) ✅ Complete             │  ║
║  │  • Reading: 40 questions (60 min) ✅ Complete              │  ║
║  │  • Writing Task 1: Graph Description (20 min) ✅ Complete  │  ║
║  │  • Writing Task 2: Essay (40 min) ✅ Complete              │  ║
║  │  • Speaking Parts 1-3 (11-14 min) ✅ Complete             │  ║
║  │                                                             │  ║
║  │  Total Questions: 160  |  Est. Duration: 2h 44m           │  ║
║  │                                                             │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌────────────────────┐  ┌────────────────────────────────────┐  ║
║  │  DEPLOYMENT STATS  │  │  PERFORMANCE SUMMARY               │  ║
║  │  ─────────────────  │  │  ─────────────────────────────────  │  ║
║  │                    │  │                                    │  ║
║  │  Sessions: 12      │  │  Avg Band Score: 6.2              │  ║
║  │  Completions: 234   │  │  Listening Avg: 6.5              │  ║
║  │  In Progress: 8     │  │  Reading Avg: 5.9                 │  ║
║  │  Abandoned: 3       │  │  Writing Avg: 6.0                 │  ║
║  │                    │  │  Speaking Avg: 6.4                 │  ║
║  │  Pass Rate: 72%     │  │                                    │  ║
║  │  (Band 6.5+)        │  │  Band Distribution:               │  ║
║  │                    │  │  ■■■■■□□□□□  (visual bar)         │  ║
║  └────────────────────┘  └────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  TABS: [Details] [Versions] [Sessions] [Grading] [Settings] │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  [Tab Content Area - see below sections]                         ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

### 4.4 Bulk Operations on Exams

**Selection Mode:**
- Click checkbox on each card/row OR
- `Ctrl/Cmd + A` to select all visible
- Selection counter appears: "3 selected"

**Bulk Actions Bar (appears when items selected):**
```
┌─────────────────────────────────────────────────────────────┐
│  3 exams selected                              [Clear All]  │
│  [Publish] [Unpublish] [Archive] [Delete] [Assign to...]    │
│  [Export] [Add Tag] [Move to Folder] [Change Owner]        │
└─────────────────────────────────────────────────────────────┘
```

**Confirmation for destructive bulk actions:**
```
┌─────────────────────────────────────────────┐
│  Delete 3 Exams?                            │
│                                             │
│  This will permanently delete:              │
│  • Academic PT v3                           │
│  • GT Practice 5                            │
│  • Diagnostic Q1                            │
│                                             │
⚠  These exams have 234 combined completions.│
│   Historical results will be preserved,    │
│   but the exam content will be lost.        │
│                                             │
│  [Cancel]                    [Delete 3 Items]│
└─────────────────────────────────────────────┘
```

---

## **5. User & Role Management]

### 5.1 Role Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                    ROLE HIERARCHY                           │
│                                                             │
│                    ┌─────────┐                              │
│                    │ SUPER   │                              │
│                    │ ADMIN   │                              │
│                    └────┬────┘                              │
│                         │                                  │
│            ┌────────────┼────────────┐                     │
│            ▼            ▼            ▼                     │
│     ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│     │ADMINISTRATOR│  │MANAGER   │  │TECH LEAD │              │
│     └─────┬────┘  └─────┬────┘  └─────┬────┘              │
│           │              │              │                   │
│     ┌─────┴────┐         │              │                   │
│     ▼          ▼         ▼              ▼                   │
│  ┌──────┐  ┌──────┐  ┌──────┐      ┌──────┐                │
│  │TEACHER│  │CREATOR│  │GRADER│      │PROCTOR│               │
│  └──┬───┘  └──┬───┘  └──┬───┘      └──┬───┘                │
│     │         │         │             │                     │
│     └────┬────┘         │             │                     │
│          ▼              │             │                     │
│     ┌──────┐            │             │                     │
│     │STUDENT│────────────┴─────────────┘                     │
│     └──────┘                                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Permissions Matrix

| Capability | Super Admin | Admin | Manager | Teacher | Creator | Grader | Proctor | Student |
|-----------|:----------:|:-----:|:-------:|:-------:|:------:|:-----:|:------:|:------:|
| Manage users | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Create exams | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit any exam | ✅ | ✅ | ✅ | Own only | Own only | ❌ | ❌ | ❌ |
| Publish exams | ✅ | ✅ | ✅ | Own only | Own only | ❌ | ❌ | ❌ |
| Schedule sessions | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View results (all) | ✅ | ✅ | ✅ | Own cohorts | Own cohorts | Assigned | ❌ | Own only |
| Grade submissions | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Manage cohorts | ✅ | ✅ | ✅ | Own only | ❌ | ❌ | ❌ | ❌ |
| Access admin settings | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Take exams | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View own results | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### 5.3 User List Interface

```
╔═══════════════════════════════════════════════════════════════════╗
║  👥 People / Users                              [+ Add User]   ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Filter: [All Roles ▾] [Active ▾] [Cohort: All ▾]               ║
║  Search: [By name, email, ID...]                                 ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │ Avatar  Name           Email           Role      Status    │  ║
║  ├─────────────────────────────────────────────────────────────┤  ║
║  │  SC     Sarah Chen     s.chen@...     Admin     🟢 Active │  ║
║  │         ID: USR-001    Last login: 2h ago           [⋯]    │  ║
║  ├─────────────────────────────────────────────────────────────┤  ║
║  │  MJ     Mike Johnson  m.johnson@...   Teacher   🟢 Active │  ║
║  │         ID: USR-002    Last login: 1d ago           [⋯]    │  ║
║  ├─────────────────────────────────────────────────────────────┤  ║
║  │  AL     Anna Lee      a.lee@...       Creator   🟡 Invited│  ║
║  │         ID: USR-003    Pending acceptance           [⋯]    │  ║
║  ├─────────────────────────────────────────────────────────────┤  ║
║  │  RT     Robert Taylor r.taylor@...   Grader    🔴 Suspended│  ║
║  │         ID: USR-004    Reason: Inactive 6mo         [⋯]    │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  Showing 1-20 of 1,842 users        [← Prev] [1 2 3 ... 93]     ║
╚═══════════════════════════════════════════════════════════════════╝
```

### 5.4 User Profile / Detail View

```
╔═══════════════════════════════════════════════════════════════════╗
║  ← Back to Users                                                 ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  ┌────────────────┐  Sarah Chen                                  ║
║  │                │  s.chen@ielts-institute.edu                   ║
║  │   [Photo]      │  User ID: USR-001                             ║
║  │                │  Joined: March 2023                           ║
║  └────────────────┘  Last Login: January 15, 2025 at 09:15       ║
║                                                                   ║
║  [Edit Profile] [Reset Password] [Impersonate] [Disable] [Delete]  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  ROLES & PERMISSIONS                                        │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Current Roles:                                             │  ║
║  │  🔵 Administrator                                          │  ║
║  │  🟢 Teacher (Department: English Prep)                      │  ║
║  │  🟣 Exam Creator                                            │  ║
║  │                                                             │  ║
║  │  [+ Add Role] [Remove Role]                                 │  ║
║  │                                                             │  ║
║  │  Custom Permissions (overrides):                            │  ║
║  │  ✅ Can publish without approval                            │  ║
║  │  ✅ Can access analytics module                             │  ║
║  │  ❌ Cannot delete exams (requires admin)                    │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  ASSIGNED COHORTS / CLASSES                                 │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Spring 2024 Intake (Owner)    [View Cohort]                │  ║
║  │  Evening Batch (Teacher)        [View Cohort]                │  ║
║  │  Summer Workshop (Guest)        [View Cohort]                │  ║
║  │                                                             │  ║
║  │  [+ Assign to Cohort]                                     │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  ACTIVITY SUMMARY                                          │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Exams Created: 47                                          │  ║
║  │  Exams Published: 43                                        │  ║
║  │  Sessions Conducted: 156                                    │  ║
║  │  Students Taught: 342                                      │  ║
║  │  Submissions Graded: 1,247                                  │  ║
║  │                                                             │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

### 5.5 Add/Edit User Modal

```
┌─────────────────────────────────────────────────────────────┐
│  ➕ Add New User / Edit User                                │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Step 1 of 3: Basic Information                             │
│                                                             │
│  First Name:     [Sarah_____________]                       │
│  Last Name:      [Chen______________]                       │
│  Email:          [s.chen@...________]                       │
│                                                             │
│  Employee/Student ID: [EMP-2024-0156__]                     │
│                                                             │
│  Step 2: Role Assignment                                   │
│                                                             │
│  Primary Role:    [Teacher        ▾]                        │
│  Additional:      [☑ Exam Creator] [☐ Grader] [☐ Proctor] │
│                                                             │
│  Department:      [English Prep    ▾]                       │
│                                                             │
│  Step 3: Notifications & Settings                          │
│                                                             │
│  Send welcome email?  [✓] Yes                               │
│  Require password change on first login? [✓] Yes           │
│  Account expires:    [Never     ▾] or [Set date: ____]     │
│                                                             │
│  [Cancel]                        [Create User]              │
└─────────────────────────────────────────────────────────────┘
```

### 5.6 Student Self-Registration (Optional)

If institution allows self-signup:

```
╔═══════════════════════════════════════════════════════════════════╗
║  🎓 Student Registration - IELTS Prep Institute                 ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Please fill in your details to create your account.             │
║                                                                   ║
║  Personal Information:                                           │
║  First Name:     [_______________________]                        │
║  Last Name:      [_______________________]                        │
║  Email:          [_______________________]                        │
║  Phone:          [_______________________]                        │
║  Date of Birth:  [DD / MM / YYYY       ]                         │
║                                                                   ║
║  Academic Information:                                           │
║  Student ID:     [_______________________]  (if applicable)       │
║  Program/Course: [_______________________ ▾]                      │
║  Enrollment Date:[DD / MM / YYYY       ]                         │
║                                                                   ║
║  Target IELTS Date: [DD / MM / YYYY       ]  (optional)          │
║  Target Band Score: [6.0 ▾]               (helps recommend exams)│
║                                                                   ║
║  Password:       [_______________________]                        │
║  Confirm:        [_______________________]                        │
║                                                                   ║
║  ☐ I agree to the Terms of Service and Privacy Policy             │
║                                                                   ║
║  [Create Account]                                                │
║                                                                   ║
║  Already have an account? [Log In Here]                           │
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

**Approval Workflow (if required):**
```
After registration:
1. Student sees: "Your account is pending approval. 
   You will receive an email within 24 hours."
   
2. Admin sees notification:
   "New student registration: John Smith (john@s...) 
   pending approval."

3. Admin clicks: [Approve] [Reject] [Request More Info]
```

---

## **6. Exam Deployment & Scheduling]

### 6.1 The Scheduling Concept

An **exam must be "scheduled" before students can take it.** This creates a **session**—a specific instance of an exam with defined time window, assigned students, and proctoring arrangements.

**Data Model:**
```
EXAM (Template)          SESSION (Instance)         ATTEMPT (Individual)
┌─────────────┐         ┌──────────────┐          ┌──────────────┐
│ "Academic   │ 1:N    │ "Jan 16,     │ 1:N     │ "John's      │
│  PT v3"     │───────▶│  2024 10AM"  │────────▶│  attempt"    │
│             │         │              │          │              │
│ Content     │         │ Start time   │          │ Responses    │
│ Questions   │         │ End time     │          │ Score        │
│ Settings    │         │ Students []  │          │ Time taken   │
│ Rubrics     │         │ Proctors []  │          │ Status       │
└─────────────┘         └──────────────┘          └──────────────┘
```

### 6.2 Calendar View (Primary Scheduling Interface)

```
╔═══════════════════════════════════════════════════════════════════╗
║  📅 Exam Scheduler                    [Month ▾] [Today] [+ New]  ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  ◀ January 2025                              February 2025 ▶     ║
║                                                                   ║
║  Mon  Tue  Wed  Thu  Fri  Sat  Sun                              ║
║  ─────────────────────────────────────────────────────────────    ║
║          1    2    3    4    5                                   ║
║                                                                   ║
║  6    7    8    9   10   11   12                                 ║
║           │                   │                                  ║
║           │  📘 Diag.Q1       │  📗 GT Pract.5                   ║
║           │  09:00-12:00      │  14:00-16:30                    ║
║           │  25 students      │  18 students                    ║
║                                                                   ║
║  13   14   15   16   17   18   19                                 ║
║           │    │📘 Acad.PT v3   │                                 ║
║           │    │ 10:00-13:00   │                                 ║
║           │    │ 30 students   │                                 ║
║  📘 Speak.  │    │              │                                 ║
║  Focus     │    │              │                                 ║
║  09:00-11:00│    │              │                                 ║
║  12 stud.  │    │              │                                 ║
║                                                                   ║
║  20   21   22   23   24   25   26                                 ║
║                │📘 Final Mock   │                                 ║
║                │ 09:00-12:30   │                                 ║
║                │ 45 students   │                                 ║
║                                                                   ║
║  27   28   29   30   31                                          ║
║                                                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║  Legend:                                                           ║
║  📘 Academic  📗 General Training  📙 Diagnostic  📕 Speaking     ║
║  ━━━━ Confirmed  - - - - Draft/Pending                           ║
╚═══════════════════════════════════════════════════════════════════╝
```

**Calendar Event Card (Expanded):**
```
Click event to see details popover:

┌─────────────────────────────────────┐
│ 📘 Academic Practice Test v3       │
│ ─────────────────────────────────── │
│                                    │
│ 📅 Thursday, January 16, 2025      │
│ 🕐 10:00 AM - 1:00 PM (3 hours)   │
│                                    │
│ 👤 Students: 30 enrolled          │
│    (28 confirmed, 2 pending)       │
│                                    │
│ 👁️ Proctors: Sarah Chen (Lead)    │
│    Mike Johnson                    │
│                                    │
│ 💻 Location: Main Computer Lab 204 │
│    (or Remote via Zoom link)       │
│                                    │
│ Status: 🟢 Confirmed & Scheduled   │
│                                    │
│ [Edit] [Duplicate] [Cancel] [View Roster] │
└─────────────────────────────────────┘
```

### 6.3 Create New Session Wizard

**Step-by-step guided flow for scheduling:**

**Step 1: Select Exam**
```
┌─────────────────────────────────────────────────────────────┐
│  Schedule New Exam Session - Step 1/5                      │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Which exam do you want to schedule?                        │
│                                                             │
│  Search: [________________________]                         │
│  Filter: [Published only ☑] [Type: All ▾]                  │
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ 📘 Academic PT v3│  │ 📗 GT Practice 5 │               │
│  │ 160 questions   │  │ 155 questions   │               │
│  │ Duration: 2h 44m │  │ Duration: 2h 38m │               │
│  │ [Select]        │  │ [Select]        │               │
│  └──────────────────┘  └──────────────────┘               │
│                                                             │
│  Selected: Academic Practice Test v3                        │
│                                                             │
│                    [Cancel]  [Next →]                       │
└─────────────────────────────────────────────────────────────┘
```

**Step 2: Date, Time & Duration**
```
┌─────────────────────────────────────────────────────────────┐
│  Schedule New Exam Session - Step 2/5                      │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  When will this session take place?                         │
│                                                             │
│  Date:       [16 / 01 / 2025  📅]  (picker)                │
│                                                             │
│  Start Time: [10 : 00 AM  ▾]                               │
│                                                             │
│  End Time:   [01 : 00 PM  ▾]                               │
│  (Auto-calculated: Exam duration 2h 44m + 17m buffer)      │
│  [✓] Auto-calculate end time based on exam duration        │
│                                                             │
│  Buffer Time: [15 ▾] minutes after exam ends               │
│  (For technical issues, stragglers)                         │
│                                                             │
│  Time Zone: [UTC+8 Singapore/Malaysia ▾]                    │
│                                                             │
│  Availability Check:                                        │
│  ✅ No conflicts detected for Main Lab 204                  │
│  ⚠️ Proctor Sarah Chen has another session at 1:30 PM      │
│     (this session ends at 1:17 PM - OK!)                   │
│                                                             │
│                    [← Back]  [Next →]                       │
└─────────────────────────────────────────────────────────────┘
```

**Step 3: Assign Students**
```
┌─────────────────────────────────────────────────────────────┐
│  Schedule New Exam Session - Step 3/5                      │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Who will take this exam?                                   │
│                                                             │
│  Option A: Assign Entire Cohort                             │
│  Cohort: [Spring 2024 Intake    ▾]                          │
│  Students: 45 total                                        │
│  [Select Cohort]                                            │
│                                                             │
│  Option B: Select Individual Students                       │
│  Search: [Name or email...]                                 │
│                                                             │
│  Available Students:                                        │
│  ┌──────────────────────────────────────────────────┐      │
│  │ ☐ John Smith    john@s...  Band Target: 7.0     │      │
│  │ ☐ Maria Garcia  maria@g... Band Target: 6.5     │      │
│  │ ☑ Wei Zhang     wei.z@...  Band Target: 7.5     │      │
│  │ ☐ Priya Sharma  priya@s... Band Target: 6.0     │      │
│  │ ☐ Tom Wilson    tom.w@...  Band Target: 7.0     │      │
│  └──────────────────────────────────────────────────┘      │
│                                                             │
│  Selected: 1 student                                        │
│                                                             │
│  Option C: Open Registration (Self-enroll via link)         │
│  [☐] Allow self-enrollment                                 │
│  Max capacity: [___] (blank = unlimited)                    │
│                                                             │
│                    [← Back]  [Next →]                       │
└─────────────────────────────────────────────────────────────┘
```

**Step 4: Proctoring & Settings**
```
┌─────────────────────────────────────────────────────────────┐
│  Schedule New Exam Session - Step 4/5                      │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Proctoring Arrangements:                                   │
│                                                             │
│  Mode:                                                      │
│  (●) In-Person (Physical venue)                             │
│  ( ) Online (Video proctored)                               │
│
### 13.2 Cohort-Level Analytics Dashboard

```
╔═══════════════════════════════════════════════════════════════════╗
║  📊 Cohort Analytics: Spring 2024 Intake Program                   ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Date Range: [Jan 6, 2025] - [Jan 16, 2025]  [Apply]            ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  SUMMARY CARDS                                            │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │  ║
║  │  │ Avg Band    │  │ Pass Rate   │  │ Improvement  │        │  ║
║  │  │    6.2      │  │    72%      │  │   +0.4       │        │  ║
║  │  │ ↑ +0.3 vs   │  │ ↑ 8% vs    │  │ since start  │        │  ║
║  │  │   last exam  │  │   last exam │  │             │        │  ║
║  │  └─────────────┘  └─────────────┘  └─────────────┘        │  ║
║  │                                                             │  ║
║  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │  ║
║  │  │ At Risk     │  │ Top Perf.   │  │ Completion   │        │  ║
║  │  │    5 students│  │    7.8     │  │    89%       │        │  ║
║  │  │ (< 5.5 band)│  │ Wei Zhang  │  │ (on track)   │        │  ║
║  │  └─────────────┘  └─────────────┘  └─────────────┘        │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  BAND DISTRIBUTION CHART                                   │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │         Frequency                                           │  ║
║  │          20 ┤                                              │  ║
║  │          18 ┤          ████                                │  ║
║  │          16 ┤     ████ ████                                 │  ║
║  │          14 ┤     ████ ████ ████                            │  ║
║  │          12 ┤ ████ ████ ████ ████                            │  ║
║  │          10 ┤ ████ ████ ████ ████ ████                      │  ║
║  │           8 ┤ ████ ████ ████ ████ ████                      │  ║
║  │           6 ┤ ████ ████ ████ ████ ████ ████                  │  ║
║  │           4 ┤ ████ ████ ████ ████ ████ ████                  │  ║
║  │           2 ┼━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                │  ║
║  │           0 └────┬────┬────┬────┬────┬────┬────┬────┬──     │  ║
║  │              4.0  4.5  5.0  5.5  6.0  6.5  7.0  7.5  8.0+  │  ║
║  │                                                             │  ║
║  │  Target: 6.5 (vertical line)                               │  ║
║  │  Mean: 6.2 | Median: 6.3 | Std Dev: 0.8                    │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  MODULE PERFORMANCE BREAKDOWN                              │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Module        Cohort Avg  Target    Gap      Trend        │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │  Listening     6.7        6.5      +0.2     ↗ Improving   │  ║
║  │  Reading       5.9        6.5      -0.6     → Stable     │  ║
║  │  Writing       6.1        6.5      -0.4     ↗ Improving   │  ║
║  │  Speaking      6.4        6.5      -0.1     ↗ Improving   │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │  OVERALL       6.2        6.5      -0.3     ↗ Improving   │  ║
║  │                                                             │  ║
║  │  ⚠ Reading module needs attention (-0.6 below target)      │  ║
║  │  [View Reading Intervention Suggestions]                     │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  INDIVIDUAL STUDENT PROGRESS (Sortable Table)              │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Student        │ L  │ R  │ W  │ S  │ Overall │ Trend │ Act│  ║
║  │  ─────────────────────────────────────────────────────────── │  ║
║  │  Wei, Zhang     │7.5│7.0│7.0│7.5│  7.3   │ ↗↑↑   │ ✅  │  ║
║  │  Garcia, Maria  │7.0│6.5│6.5│6.5│  6.6   │ →→→   │ ✅  │  ║
║  │  Smith, John    │7.0│6.5│6.0│6.5│  6.5   │ ↗→↗   │ ✅  │  ║
║  │  Sharma, Priya  │6.5│6.0│6.5│7.0│  6.5   │ ↗↗↑   │ ✅  │  ║
║  │  Wilson, Tom    │6.5│5.5│6.0│6.0│  6.0   │ →↗→   │ ⚠️  │  ║
║  │  Kim, Sue       │6.0│5.5│5.5│6.0│  5.8   │ ↘↘↗   │ ⚠️  │  ║
║  │  Patel, Raj     │5.5│5.0│5.5│5.5│  5.4   │ ↘↘→   │ 🔴  │  ║
║  │  [...]                                                          │  ║
║  │                                                                 │  ║
║  │  Click student name for full report                           │  ║
║  │  L=Listening R=Reading W=Writing S=Speaking                 │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  Tabs: [Overview] [Question Analysis] [Time Analysis]            ║
║       [Improvement Tracking] [Predictions] [Export]             │  ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

### 13.3 Question-Level Analytics (Item Analysis)

**For educators to evaluate question quality:**

```
╔═══════════════════════════════════════════════════════════════════╗
║  📊 Item Analysis: Academic PT v3 - Reading Module               ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Filter: [All Questions ▾] [Difficulty: All ▾]                  ║
║  Search: [Question text or ID...]                                ║
║                                                                   ║
║  Summary Statistics:                                             ║
║  Total Questions: 40  |  Attempts: 234  |  Avg Score: 26.2/40   ║
║  Reliability (Cronbach's α): 0.84  |  SEM: ±0.28 bands          ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  QUESTION DETAIL TABLE                                     │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Q# │ Type      │ Diff. │ Disc. │ %Correct │ Flag      │  ║
║  │  ──┼───────────┼───────┼───────┼─────────┼───────────│  ║
║  │  1  │ T/F/NG    │ 0.62  │ 0.41  │  78%    │ ✅ Good   │  ║
║  │  2  │ T/F/NG    │ 0.71  │ 0.38  │  65%    │ ✅ Good   │  ║
║  │  3  │ T/F/NG    │ 0.45  │ 0.52  │  82%    │ ✅ Good   │  ║
║  │  4  │ T/F/NG    │ 0.88  │ 0.19  │  34%    │ ⚠ Too Hard│  ║
║  │  5  │ T/F/NG    │ 0.55  │ 0.44  │  76%    │ ✅ Good   │  ║
║  │  ...                                                         │  ║
║  │  14 │ Matching  │ 0.58  │ 0.48  │  71%    │ ✅ Good   │  ║
║  │  15 │ Cloze     │ 0.67  │ 0.35  │  68%    │ ✅ Good   │  ║
║  │  16 │ Cloze     │ 0.92  │ 0.08  │  22%    │ 🔴 Review  │  ║
║  │  ...                                                         │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  Selected Question: Q16 (Cloze / Fill-in-the-blank)             ║
║  ─────────────────────────────────────────────────────────────    ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  Question Preview:                                         │  ║
║  │  "The ___________ (16) of coal was crucial for..."        │  ║
║  │  Correct Answer: "availability"                             │  ║
║  │  Max Words: 2                                               │  ║
║  │                                                             │  ║
║  │  Performance Metrics:                                       │  ║
║  │  • Difficulty Index: 0.92 (Very Hard - target: 0.4-0.7)   │  ║
║  │  • Point Biserial: 0.08 (Poor discriminator)              │  ║
║  │  • % Correct: 22% (52/234 students)                        │  ║
║  │                                                             │  ║
║  │  Answer Distribution:                                      │  ║
║  │  ┌────────────────────────────────────────────┐           │  ║
║  │  │ availability █████████████████  22% ✓ correct│          │  ║
║  │  │ abundant     █████████████████  31%         │          │  ║
║  │  │ abundance    ████████████       18%         │          │  ║
║  │  │ available    ██                 4%         │          │  ║
║  │  │ (no answer)  █████████████      15%         │          │  ║
║  │  │ other        ██████             10%         │          │  ║
║  │  └────────────────────────────────────────────┘           │  ║
║  │                                                             │  ║
║  │  Recommendations:                                          │  ║
║  │  ⚠ This question may be too difficult or ambiguous.      │  ║
║  │    Consider:                                                │  ║
║  │    • Review if vocabulary is appropriate for level        │  ║
║  │    • Check if passage context makes answer clear           │  ║
║  │    • Verify word limit isn't causing issues                │  ║
║  │                                                             │  ║
║  │  [Edit Question] [Retire Question] [View in Context]       │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

**Difficulty & Discrimination Guide:**

| Metric | Range | Interpretation | Action |
|--------|-------|----------------|--------|
| **Difficulty Index** (p-value) | 0.9-1.0 | Very Easy | May not differentiate; consider for warm-up |
| **Difficulty Index** | 0.7-0.9 | Easy | Appropriate for early questions |
| **Difficulty Index** | 0.3-0.7 | Ideal | Good range for discrimination |
| **Difficulty Index** | 0.1-0.3 | Hard | OK for few challenging questions |
| **Difficulty Index** | 0.0-0.1 | Very Hard | Review for fairness/ambiguity |
| **Point Biserial** | >0.4 | Excellent discriminator | Keep |
| **Point Biserial** | 0.2-0.4 | Good discriminator | Acceptable |
| **Point Biserial** | 0.0-0.2 | Weak discriminator | Review/revise |
| **Point Biserial** | <0.0 | Negative (wrong!) | Miskeyed or flawed—remove |

### 13.4 Export Reports Center

```
╔═══════════════════════════════════════════════════════════════════╗
║  📥 Reports & Exports                                          ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Generate reports for administrators, accreditors, or analysis.   │
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  STANDARD REPORTS                                         │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Report Name                    Format  Last Run   [Generate]│  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Student Results Roster          PDF     Jan 15    [Generate]│  ║
║  │  (All students, all scores, one exam)                       │  ║
║  │                                                             │  ║
║  │  Cohort Performance Summary        XLSX    Jan 14    [Generate]│  ║
║  │  (Aggregated stats by class/cohort)                          │  ║
║  │                                                             │  ║
║  │  Item Analysis Report             CSV     Jan 12    [Generate]│  ║
║  │  (Question-level statistics for psychometricians)           │  ║
║  │                                                             │  ║
║  │  Grade Distribution Chart          PNG     Jan 10    [Generate]│  ║
║  │  (Visual band distribution graph)                            │  ║
║  │                                                             │  ║
║  │  At-Risk Student List             PDF     Jan 16    [Generate]│  ║
║  │  (Students below threshold needing intervention)            │  ║
║  │                                                             │  ║
║  │  Grader Calibration Report        PDF     Jan 11    [Generate]│  ║
║  │  (Inter-rater reliability stats)                             │  ║
║  │                                                             │  ║
║  │  Attendance & Completion Audit     XLSX    Jan 09    [Generate]│  ║
║  │  (Who took what, when, duration)                             │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  CUSTOM REPORT BUILDER                                    │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Select Data Points:                                        │  ║
║  │  [✓] Student demographics                                   │  ║
║  │  [✓] Scores (overall and per-module)                         │  ║
║  │  [✓] Band scores                                             │  ║
║  │  [ ] Criterion scores (TA, CC, LR, GRA, FC, P)             │  ║
║  │  [✓] Time taken per module                                   │  ║
║  │  [ ] Individual question responses                            │  ║
║  │  [✓] Attendance records                                      │  ║
║  │  [ ] Grader comments                                         │  ║
║  │                                                             │  ║
║  │  Filters:                                                    │  ║
║  │  Cohort: [Spring 2024 Intake ▾]                              │  ║
║  │  Exam: [All Exams ▾]                                        │  ║
║  │  Date Range: [Jan 1, 2025] - [Jan 16, 2025]                 │  ║
║  │  Score Range: [All ▾]                                       │  ║
║  │                                                             │  ║
║  │  Output Format: [PDF ▾]                                     │  ║
║  │                                                             │  ║
║  │  [Generate Custom Report]                                   │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  SCHEDULED REPORTS (Auto-deliver via email)                │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  📧 Weekly Progress Report                                  │  ║
║  │     Sent every Monday at 8:00 AM to: admin@ielts.edu        │  ║
║  │     Covers: Previous week's completions & averages         │  ║
║  │     [Edit Schedule] [Pause] [Delete]                        │  ║
║  │                                                             │  ║
║  │  📧 Monthly Executive Summary                               │  ║
║  │     Sent 1st of month to: director@ielts.edu                │  ║
║  │     Covers: Monthly trends, cohort comparisons              │  ║
║  │     [Edit Schedule] [Pause] [Delete]                        │  ║
║  │                                                             │  ║
║  │  [+ Create New Scheduled Report]                            │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

## **14. Settings & Configuration]

### 14.1 Global Settings Hierarchy

```
Settings Structure:
├── Organization Settings (Super Admin only)
│   ├── Branding & Appearance
│   ├── Licensing & Billing
│   ├── Security Policies
│   └── Integrations
│
├── Examination Settings (Admin)
│   ├── Scoring Rules & Band Conversion
│   ├── Default Timer Configurations
│   ├── Exam Creation Guidelines
│   └── Grading Workflows
│
├── User Preferences (Per-user)
│   ├── Interface Preferences
│   ├── Notification Settings
│   └── Default Views
```

### 14.2 Scoring Configuration UI

```
╔═══════════════════════════════════════════════════════════════════╗
║  ⚙️ Settings > Scoring Rules                                    ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Configure how raw scores convert to IELTS band scores.           │
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  ACTIVE SCORING PROFILE: "Official IELTS 2024"            │  ║
║  │  Based on: British Council / IDP current standards        │  ║
║  │  Last updated: Dec 1, 2024 by System Admin               │  ║
║  │  Status: ✅ Active (applies to all new exams)            │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  LISTENING BAND CONVERSION                                 │  ║
║  │  (Same for Academic and General Training)                  │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Raw Score ( /40 )    Band Score                           │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │  0 - 3                4.0                                 │  ║
║  │  4 - 9                4.5                                 │  ║
║  │  10 - 15              5.0                                 │  ║
║  │  16 - 21              5.5                                 │  ║
║  │  22 - 26              6.0                                 │  ║
║  │  27 - 30              6.5                                 │  ║
║  │  31 - 33              7.0                                 │  ║
║  │  34 - 36              7.5                                 │  ║
║  │  37 - 39              8.0                                 │  ║
║  │  40                   8.5 - 9.0*                          │  ║
║  │                                                             │  ║
║  │  *Band 9 requires perfect score + controlled conditions    │  ║
║  │                                                             │  ║
║  │  [Reset to Official Standards]                             │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  READING BAND CONVERSION - ACADEMIC                        │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Raw Score ( /40 )    Band Score                           │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │  0 - 12               4.0                                 │  ║
║  │  13 - 19              4.5 - 5.0                           │  ║
║  │  20 - 28              5.5 - 6.5                           │  ║
║  │  29 - 39              7.0 - 8.0                           │  ║
║  │  40                  8.5 - 9.0                           │  ║
║  │                                                             │  ║
║  │  [Edit Table] [Reset to Official]                           │  ║
║  ├─────────────────────────────────────────────────────────────┤  ║
║  │  READING BAND CONVERSION - GENERAL TRAINING                │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Raw Score ( /40 )    Band Score                           │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │  0 - 11               3.0 - 4.0                           │  ║
║  │  12 - 17              4.5                                 │  ║
║  │  18 - 27              5.0 - 6.0                           │  ║
║  │  28 - 37              6.5 - 7.5                           │  ║
║  │  38 - 40              8.0 - 9.0                           │  ║
║  │                                                             │  ║
║  │  [Edit Table] [Reset to Official]                           │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  WRITING & SPEAKING CONFIGURATION                         │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Rubric Weighting:                                         │  ║
║  │  Writing:                                                  │  ║
║  │  Task Achievement:   [25]%  Coherence/Cohesion: [25]%      │  ║
║  │  Lexical Resource:    [25]%  Grammatical Range:  [25]%      │  ║
║  │                                                            │  ║
║  │  Speaking:                                                 │  ║
║  │  Fluency/Coherence:  [25]%  Lexical Resource:   [25]%      │  ║
║  │  Grammatical Range:  [25]%  Pronunciation:     [25]%      │  ║
║  │                                                            │  ║
║  │  Overall Band Calculation:                                  │  ║
║  │  (●) Average of four modules (round to nearest 0.5)       │  ║
║  │  ( ) Weighted average (custom weights below)               │  ║
║  │                                                             │  ║
║  │  If weighted:                                              │  ║
║  │  Listening: [1.0x]  Reading: [1.0x]                        │  ║
║  │  Writing: [1.0x]   Speaking: [1.0x]                        │  ║
║  │                                                             │  ║
║  │  Half-band rounding rule:                                  │  ║
║  │  (●) Round to nearest 0.5 (standard IELTS)                │  ║
║  │  ( ) Always round down (conservative)                      │  ║
║  │  ( ) Always round up (benefit of doubt)                    │  ║
║  │                                                             │  ║
║  │  [Save Scoring Configuration]                              │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
⚠ Warning: Changing scoring rules affects future exams only.
   Past results are preserved with original scoring rules.          │
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

### 14.3 Security & Access Control Settings

```
╔═══════════════════════════════════════════════════════════════════╗
║  ⚙️ Settings > Security                                         ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  EXAM SESSION SECURITY                                    │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Browser Requirements:                                     │  ║
║  │  [✓] Block browser extensions during exam                 │  ║
║  │  [✓] Detect developer tools open (flag attempt)            │  ║
║  │  [✓] Prevent right-click context menu                     │  ║
║  │  [✓] Disable copy/paste keyboard shortcuts               │  ║
║  │  [ ] Force fullscreen mode                                │  ║
║  │  [ ] Lock to single tab (prevent new tabs)               │  ║
║  │                                                             │  ║
║  │  Session Integrity:                                        │  ║
║  │  [✓] Warn before closing browser/tab                      │  ║
║  │  [✓] Auto-save every 30 seconds                           │  ║
║  │  [✓] Encrypt data in transit (TLS 1.3+)                   │  ║
║  │  [✓] Encrypt data at rest (AES-256)                      │  ║
║  │  [✓] Log all access attempts                              │  ║
║  │                                                             │  ║
║  │  Identity Verification:                                    │  ║
║  │  (●) None (honor system)                                  │  ║
║  │  ( ) Photo verification on entry                          │  ║
║  │  ( ) ID document upload required                           │  ║
║  │  ( ) Single Sign-On (SSO) integration                    │  ║
║  │                                                             │  ║
║  │  IP Restrictions (optional):                               │  ║
║  │  [ ] Restrict access to specific IP ranges                │  ║
║  │  Allowed IPs: [_________________________]                  │  ║
║  │  (One per line, supports CIDR notation)                  │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  PASSWORD POLICY                                          │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  Minimum length: [12] characters                           │  ║
║  │  Require uppercase letter: [✓] Yes                         │  ║
║  │  Require lowercase letter: [✓] Yes                         │  ║
║  │  Require number: [✓] Yes                                   │  ║
║  │  Require special character: [✓] Yes                       │  ║
║  │  Prevent common passwords: [✓] Yes                         │  ║
║  │  Password history (cannot reuse last N): [5]               │  ║
║  │  Password expiry days: [90] (0 = never)                   │  ║
║  │  Max login attempts before lockout: [5]                    │  ║
║  │  Lockout duration: [15] minutes                            │  ║
║  │                                                             │  ║
║  │  Two-Factor Authentication:                                │  ║
║  │  ( ) Disabled                                               │  ║
║  │  ( ) Optional (users can enable)                           │  ║
║  │  (●) Required for Admins/Teachers                          │  ║
║  │  (●) Required for all roles                                │  ║
║  │                                                             │  ║
║  │  [Save Security Settings]                                  │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

### 14.4 Notification & Email Configuration

(See Section 15 for full notification system; this covers settings)

### 14.5 Integration Settings

```
╔═══════════════════════════════════════════════════════════════════╗
║  ⚙️ Settings > Integrations                                     ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Connect third-party services to extend platform capabilities.     │
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  AVAILABLE INTEGRATIONS                                   │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  ┌─────────────────────────────────────────────────────┐   │  ║
║  │  │ 📧 Email Service (SMTP)                    [Configured]│   │  ║
║  │  │ Sends notifications, results, reminders            │   │  ║
║  │  │ Provider: Amazon SES  |  Status: ✅ Connected      │   │  ║
║  │  │ [Configure] [Test Send] [Disconnect]               │   │  ║
║  │  └─────────────────────────────────────────────────────┘   │  ║
║  │                                                             │  ║
║  │  ┌─────────────────────────────────────────────────────┐   │  ║
║  │  │ 👤 Single Sign-On (SSO / SAML)              [Not Set Up]│   │  ║
║  │  │ Allow users to log in via your IdP (Okta, AD...)  │   │  ║
║  │  │ [Configure SSO]                                    │   │  ║
║  │  └─────────────────────────────────────────────────────┘   │  ║
║  │                                                             │  ║
║  │  ┌─────────────────────────────────────────────────────┐   │  ║
║  │  │ 📊 Learning Management System (LMS)           [Not Set Up]│   │  ║
║  │  │ Sync grades to Moodle, Canvas, Blackboard...      │   │  ║
║  │  │ [Connect LMS]                                     │   │  ║
║  │  └─────────────────────────────────────────────────────┘   │  ║
║  │                                                             │  ║
║  │  ┌─────────────────────────────────────────────────────┐   │  ║
║  │  │ 💬 Video Conferencing (for Speaking tests)    [Configured]│   │  ║
║  │  │ Provider: Zoom API  |  Status: ✅ Connected        │   │  ║
║  │  │ Features: Auto-meeting creation, recording        │   │  ║
║  │  │ [Configure] [Test Connection] [Disconnect]         │   │  ║
║  │  └─────────────────────────────────────────────────────┘   │  ║
║  │                                                             │  ║
║  │  ┌─────────────────────────────────────────────────────┐   │  ║
║  │  │ ☁️ Cloud Storage (for media assets)           [Configured]│   │  ║
║  │  │ Provider: AWS S3  |  Used: 4.2GB / 50GB          │   │  ║
║  │  │ [Configure] [Upgrade Storage] [Manage Files]       │   │  ║
║  │  └─────────────────────────────────────────────────────┘   │  ║
║  │                                                             │  ║
║  │  ┌─────────────────────────────────────────────────────┐   │  ║
║  │  │ 🔐 Proctoring Service                     [Not Set Up] │   │  ║
║  │  │ AI-powered remote proctoring (Respondus, etc.)    │   │  ║
║  │  │ [Browse Proctoring Partners]                       │   │  ║
║  │  └─────────────────────────────────────────────────────┘   │  ║
║  │                                                             │  ║
║  │  ┌─────────────────────────────────────────────────────┐   │  ║
║  │  │ 📱 SMS Gateway (for urgent alerts)            [Optional] │   │  ║
║  │  │ Send text messages for critical notifications     │   │  ║
║  │  │ [Configure SMS]                                   │   │  ║
║  │  └─────────────────────────────────────────────────────┘   │  ║
║  │                                                             │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

## **15. Notification System]

### 15.1 Notification Types Matrix

| Event | Trigger | Recipients | Channels | Template |
|-------|---------|------------|----------|----------|
| **Exam Scheduled** | New session created | Assigned students | Email + In-app | `exam_scheduled` |
| **Exam Reminder** | 24h before session | Students + Proctors | Email + SMS | `reminder_24h` |
| **Exam Starting Soon** | 1h before session | Students | In-app + Push | `reminder_1h` |
| **Exam Available** | Session goes live | Enrolled students | In-app | `exam_live` |
| **Submission Complete** | Student finishes | Student | In-app + Email | `submission_confirm` |
| **Grading Complete** | All modules graded | Student | Email | `results_ready` |
| **New Grade Posted** | Individual task graded | Student | In-app | `new_grade` |
| **At Risk Alert** | Score drops below threshold | Student + Teacher | Email + In-app | `at_risk_alert` |
| **Assignment Received** | Student assigned to cohort | Student | Email | `cohort_welcome` |
| **Collaboration Invite** | Added as co-editor | User | Email + In-app | `collab_invite` |
| **Review Requested** | Exam sent for review | Reviewer | Email + In-app | `review_request` |
| **Comment on Your Exam** | Reviewer adds comment | Creator | In-app | `review_comment` |
| **Exam Published** | Draft published | All teachers (opt-in) | In-app | `exam_published` |
| **System Maintenance** | Planned downtime | All users | Email + Banner | `maintenance` |
| **Security Alert** | Suspicious login | User + Admin | Email + SMS | `security_alert` |

### 15.2 Notification Center (In-App)

```
╔═══════════════════════════════════════════════════════════════════╗
║  🔔 Notifications (5 unread)                              [Mark Read]  ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Filter: [All ▾] [Unread] [Mentions] [System]                   ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │ 🔵 NEW                                                   │  ║
║  │ ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  📝 Dr. Wong reviewed your exam "Midterm Mock"            │  ║
║  │  15 minutes ago                                             │  ║
║  │  "Found 2 issues that need fixing before approval."        │  ║
║  │  [View Comments] [Go to Exam]                               │  ║
║  │                                                             │  ║
║  ├─────────────────────────────────────────────────────────────┤  ║
║  │                                                             │  ║
║  │  👥 5 new students enrolled in "Spring 2024 Intake"        │  ║
║  │  1 hour ago                                                 │  ║
║  │  [View Roster]                                              │  ║
║  │                                                             │  ║
║  ├─────────────────────────────────────────────────────────────┤  ║
║  │                                                             │  ║
║  │  📅 Reminder: "Academic PT v3" session tomorrow at 10 AM    │  ║
║  │  3 hours ago                                                │  ║
║  │  30 students confirmed. Check roster.                      │  ║
║  │  [View Session] [Send Reminder]                             │  ║
║  │                                                             │  ║
║  ├─────────────────────────────────────────────────────────────┤  ║
║  │                                                             │  ║
║  │  ✅ Grading complete: 12 Writing Task 2 essays ready         │  ║
║  │  5 hours ago                                                 │  ║
║  │  Average band: 6.3  |  2 students flagged as at-risk       │  ║
║  │  [View Grades]                                              │  ║
║  │                                                             │  ║
║  ├─────────────────────────────────────────────────────────────┤  ║
║  │                                                             │  ║
║  │  ⚠️ At Risk Alert: Kim, Sue (Band 5.4) dropped 0.3        │  ║
║  │  since last exam                                            │  ║
║  │  Yesterday at 4:30 PM                                       │  ║
║  │  [View Student Profile] [Schedule Intervention]             │  ║
║  │                                                             │  ║
║  ├─────────────────────────────────────────────────────────────┤  ║
║  │                                                             │  ║
║  │  📖 READ (Earlier Today)                                   │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  ✅ Your changes to "Diagnostic Q1" were auto-saved        │  ║
║  │  Today at 9:15 AM                                           │  ║
║  │                                                             │  ║
║  ├─────────────────────────────────────────────────────────────┤  ║
║  │                                                             │  ║
║  │  🎉 Weekly report generated: 234 completions this week     │  ║
║  │  Today at 8:00 AM                                           │  ║
║  │  [Download Report]                                          │  ║
║  │                                                             │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  Notification Preferences: [⚙️ Manage Settings]                   │  ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

### 15.3 Notification Preferences (Per-User)

```
╔═══════════════════════════════════════════════════════════════════╗
║  ⚙️ Notification Preferences                                    ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Choose how and when you want to receive notifications.           │
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  EMAIL NOTIFICATIONS                                       │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  [✓] Exam scheduled (I'm assigned to proctor)              │  ║
║  │  [✓] Exam reminder (24h before my sessions)                │  ║
║  │  [ ] Exam reminder (1h before)                             │  ║
║  │  [✓] Student submissions complete                          │  ║
║  │  [✓] Grading assignments (new items in queue)              │  ║
║  │  [✓] At-risk student alerts                                │  ║
║  │  [ ] Collaboration mentions (@mentions only)                │  ║
║  │  [✓] Review requests for my exams                          │  ║
║  │  [ ] Weekly summary digest (Monday mornings)                │  ║
║  │  [✓] Security alerts                                       │  ║
║  │  [ ] Marketing/feature updates                             │  ║
║  │                                                             │  ║
║  │  Digest mode:                                             │  ║
║  │  ( ) Immediate (send each notification instantly)           │  ║
║  │  (●) Hourly digest (batch non-urgent)                      │  ║
║  │  ( ) Daily digest (one email per day)                      │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  IN-APP NOTIFICATIONS                                     │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  [✓] Show browser push notifications (when app is closed) │  ║
║  │  [✓] Play sound for urgent notifications                 │  ║
║  │  [✓] Show badge count on favicon                           │  ║
║  │  [ ] Desktop notifications for all activity                │  ║
║  │                                                             │  ║
║  │  Quiet Hours:                                              │  ║
║  │  [✓] Enable quiet hours                                    │  ║
║  │  From: [10:00 PM] To: [7:00 AM]                           │  ║
║  │  (Urgent/security alerts still come through)                │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  MOBILE NOTIFICATIONS (If mobile app installed)            │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  [✓] Push notifications enabled                           │  ║
║  │  [✓] Exam reminders via push                               │  ║
║  │  [✓] Grading queue updates                                 │  ║
║  │  [ ] Activity feed updates                                 │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  [Save Preferences]                                             │  ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

### 15.4 Email Template Editor

```
╔═══════════════════════════════════════════════════════════════════╗
✂️ --------------------------------------------------------------- ║
║  ✉️ Email Template Editor: "Exam Reminder (24h)"                  ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Template: exam_reminder_24h                                     ║
║  Subject: Reminder: {{exam_name}} tomorrow at {{start_time}}      ║
║  Last modified: Nov 15, 2024 by Admin                           ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │  PREVIEW MODE                                             │  ║
║  │  ─────────────────────────────────────────────────────────  │  ║
║  │                                                             │  ║
║  │  To: john.smith@student.edu                               │  ║
║  │  From: noreply@ielts-platform.edu                          │  ║
║  │                                                             │  ║
║  │  ┌─────────────────────────────────────────────────────┐   │  ║
║  │  │                                                     │   │  ║
║  │  │  [Your Institution Logo]                             │   │  ║
║  │  │                                                     │   │  ║
║  │  │  Hi {{first_name}},                                │   │  ║
║  │  │                                                     │   │  ║
║  │  │  This is a reminder that you are registered for:   │   │  ║
║  │  │                                                     │   │  ║
║  │  │  📘 {{exam_name}}                                  │   │  ║
║  │  │                                                     │   │  ║
║  │  │  📅 When: {{date}} at {{start_time}}               │   │  ║
║  │  │  📍 Where: {{venue}}                                │   │  ║
║  │  │  ⏱ Duration: ~{{duration}}                           │   │  ║
║  │  │                                                     │   │  ║
║  │  │  What to bring:                                     │   │  ║
║  │  │  • Valid photo ID                                    │   │  ║
║  │  │  • Pencil and eraser (if permitted)                 │   │  ║
║  │  │  • Water bottle (no labels)                          │   │  ║
║  │  │                                                     │   │  ║
║  │  │  [Button: Access Exam Portal →]                      │   │  ║
║  │  │                                                     │   │  ║
║  │  │  If you need to reschedule or have questions,        │   │  ║
║  │  │  contact your coordinator: {{coordinator_email}}      │   │  ║
║  │  │                                                     │   │  ║
║  │  │  Good luck!                                          │   │  ║
║  │  │                                                     │   │  ║
║  │  │  The IELTS Prep Team                                │   │  ║
║  │  │                                                     │   │  ║
║  │  └─────────────────────────────────────────────────────┘   │  ║
║  │                                                             │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  Available Variables (click to insert):                           ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │ {{first_name}}  {{last_name}}  {{email}}  {{student_id}} │  ║
║  │ {{exam_name}}  {{date}}  {{start_time}}  {{end_time}}    │  ║
║  │ {{venue}}  {{proctor_name}}  {{cohort_name}}  {{url}}    │  ║
║  │ [Show all 47 variables...]                                 │  ║
║  └─────────────────────────────────────────────────────────────┘  ║
║                                                                   ║
║  [Send Test Email to Myself] [Save Changes] [Revert to Default]   │
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

## **16. Responsive Admin Portal]

### 16.1 Design Philosophy for Management Interfaces

Unlike the student interface (which prioritizes focus), the **admin portal prioritizes information density and efficiency**.

**Key Principles:**
- **Data density:** Show more information per screen (admins process lots of data)
- **Keyboard power-user support:** Full keyboard navigation, shortcuts everywhere
- **Batch operations:** Do things to multiple items at once
- **Progressive disclosure:** Hide complexity behind expandable sections
- **Consistent patterns:** Same table design, same modal behavior throughout

### 16.2 Breakpoint Behavior

| Breakpoint | Layout Adaptations | Key Changes |
|-----------|-------------------|-------------|
| **≥1440px** (Desktop HD) | Full sidebar + content | Optimal experience |
| **1200-1439px** (Desktop) | Collapsible sidebar | Sidebar becomes icons |
| **1024-1199px** (Small Desktop/Large Tablet) | Hidden sidebar (hamburger) | Overlay nav |
| **768-1023px** (Tablet Landscape) | Single column, stacked cards | Tables become cards |
| **<768px** (Tablet Portrait/Mobile) | Simplified views | Limited functionality warning |

### 16.3 Tablet Adaptations (768px - 1024px)

**Sidebar Transformation:**
```
Desktop (>1024px):          Tablet (<1024px):
┌─────┬──────────────┐      ┌──────────────────┐
│     │              │      │ ≡ Menu  [🔍] [🔔]│
│  S  │   Content    │      ├──────────────────┤
│  I  │              │      │                  │
│  D  │              │      │   Content        │
│  E  │              │      │   (full width)    │
│  B  │              │      │                  │
│  A  │              │      │                  │
│  R  │              │      │                  │
│     │              │      │                  │
└─────┴──────────────┘      └──────────────────┘
                              ↑ Tap menu to show
                                overlay sidebar
```

**Table-to-Card Transformation:**
```
Desktop Table View:
┌────┬──────────┬──────┬──────┐
│ ☐  │ Name      │Role  │Status│
├────┼──────────┼──────┼──────┤
│ ☐  │ Sarah Chen│Admin │Active│
│ ☐  │ Mike J.   │Teacher│Active│
└────┴──────────┴──────┴──────┘

Tablet Card View:
┌─────────────────────────────┐
│ ☐  Sarah Chen               │
│     Role: Admin              │
│     Status: 🟢 Active        │
│     [View] [Edit] [⋯]       │
└─────────────────────────────┘

┌─────────────────────────────┐
│ ☐  Mike Johnson             │
│     Role: Teacher            │
│     Status: 🟢 Active        │
│     [View] [Edit] [⋯]       │
└─────────────────────────────┘
```

### 16.4 Mobile Admin (<768px)

**Functionality Limitations (Honest Communication):**
```
┌─────────────────────────────────────────────┐
│  📱 Mobile Admin Mode                      │
│  ─────────────────────────────────────────  │
│                                             │
│  You're viewing the admin portal on a       │
│  small screen. Some features work best      │
│  on larger devices:                        │
│                                             │
│  ✅ Available on Mobile:                    │
│  • View dashboards & KPIs                  │
│  • Browse exam library                     │
│  • View student results                    │
│  • Respond to notifications                │
│  • Basic user management                  │
│                                             │
│  ⚠ Limited on Mobile:                     │
│  • Exam builder (use desktop)              │
│  • Complex grading interface               │
│  • Calendar/scheduling                     │
│  • Bulk operations                         │
│  • Report generation                       │
│                                             │
│  [Continue to Mobile View]                 │
│  [Switch to Desktop Mode]                  │
└─────────────────────────────────────────────┘
```

**Mobile-Navigation Pattern (Bottom Tab Bar):**
```
╔═══════════════════════════════╗
║  [Content Area - Scrollable]  ║
║                               ║
║  Dashboard content here...    ║
║  Cards stacked vertically    ║
║  Swipeable carousels for     ║
║  charts/stats               ║
║                               ║
╠═══════════════════════════════╣
║ [🏠 Home] [📚 Exams] [👥 People] [🔔 Alerts] [≡ More] ║
╚═══════════════════════════════╝
```

**Mobile-Specific Components:**

**Pull-to-Refresh:**
- Standard pattern on all list views
- Shows last refresh timestamp

**Swipe Actions (List Items):
```
Left swipe on exam card:
┌──────────────────────┐
│ [Share]  [Edit]  📕 Delete │  ← Revealed actions
└──────────────────────┘

Right swipe on exam card:
┌──────────────────────┐
│ ⭐ Favorite  🚩 Flag    │  ← Quick actions
└──────────────────────┘
```

**Floating Action Button (FAB):**
```
Circular button, bottom-right:
[+] → Expands to:
    [+ Exam]
    [+ Student]
    [+ Session]
    [+ Task]
```

**Thumb-Zone Optimization:**
- All primary actions within bottom 60% of screen (easy thumb reach)
- Navigation bar fixed at bottom
- Important CTAs above keyboard zone

---

## **Appendix A: Complete Feature Checklist]

### Phase 1: Core Platform (MVP)

**User Management:**
- [ ] User registration/login
- [ ] Role assignment (Admin, Teacher, Creator, Grader, Student)
- [ ] Profile management
- [ ] Password reset flow

**Exam Library:**
- [ ] Exam listing (grid + list view)
- [ ] Exam detail page
- [ ] Create new exam (links to Builder)
- [ ] Duplicate exam
- [ ] Archive/delete exam
- [ ] Search & filter
- [ ] Status management (Draft/Published/Archived)

**Basic Scheduling:**
- [ ] Create session wizard
- [ ] Calendar view
- [ ] Assign students to session
- [ ] Session list view
- [ ] Basic conflict detection

**Student Portal (Basic):**
- [ ] Login for students
- [ ] View assigned exams
- [ ] Take exam (links to Student Interface spec)
- [ ] View own results

**Results:**
- [ ] Individual result report
- [ ] Band score display
- [ ] Module breakdown
- [ ] PDF export

### Phase 2: Collaboration & Workflow

**Multi-Creator:**
- [ ] Real-time collaboration (cursors, presence)
- [ ] Conflict resolution
- [ ] Collaborator invitation
- [ ] Role-based edit permissions
- [ ] Chat/comments within exam

**Review Workflow:**
- [ ] Submit for review
- [ ] Reviewer assignment
- [ ] Inline commenting system
- [ ] Approval/rejection workflow
- [ ] Version comparison (diff view)

**Version Control:**
- [ ] Automatic versioning on save
- [ ] Version history list
- [ ] Named versions/milestones
- [ ] Restore previous version
- [ ] Version comparison tool

**Notifications:**
- [ ] In-app notification center
- [ ] Email notifications (configurable templates)
- [ ] Notification preferences per user
- [ ] Quiet hours
- [ ] Push notifications (mobile)

### Phase 3: Advanced Features

**Cohort Management:**
- [ ] Cohort CRUD operations
- [ ] Bulk student import (CSV)
- [ ] Self-enrollment links
- [ ] Cohort analytics dashboard
- [ ] At-risk student identification
- [ ] Cohort-level reporting

**Asset Management:**
- [ ] Media library (images, audio, PDFs)
- [ ] Asset metadata editor
- [ ] Usage tracking (which exams use this asset)
- [ ] Storage quota management
- [ ] Bulk upload

**Template System:**
- [ ] Save exam as template
- [ ] Template marketplace/library
- [ ] Template rating system
- [ ] Template categories/tags
- [ ] Template preview

**Import/Export:**
- [ ] QTI 2.2 export
- [ ] QTI 2.2 import
- [ ] Native format export/import
- [ ] PDF paper format export
- [ ] Word document export
- [ ] Cross-institution sharing

**Advanced Scheduling:**
- [ ] Recurring session series
- [ ] Multiple venue support
- [ ] Proctor assignment
- [ ] Capacity limits
- [ ] Waitlist management
- [ ] Calendar sync (iCal/Google)

### Phase 4: Grading & Analytics

**Grading Center:**
- [ ] Grading queue (priority sorting)
- [ ] Writing grading interface (rubric-based)
- [ ] Speaking grading interface (audio + transcript)
- [ ] Annotation tools
- [ ] Grader calibration system
- [ ] Inter-reliability statistics
- [ ] Bulk grade actions

**Analytics:**
- [ ] Cohort-level dashboard
- [ ] Band distribution charts
- [ ] Module performance breakdown
- [ ] Item analysis (question-level stats)
- [ ] Difficulty/discrimination metrics
- [ ] Improvement tracking over time
- [ ] Predictive analytics (target achievement)
- [ ] At-risk algorithms

**Reporting:**
- [ ] Standard report templates
- [ ] Custom report builder
- [ ] Scheduled/auto-generated reports
- [ ] Multiple export formats (PDF, XLSX, CSV, PNG)
- [ ] Executive summaries

**Question Bank:**
- [ ] Centralized question repository
- [ ] Question tagging/categorization
- [ ] Question statistics tracking
- [ ] Search/filter questions
- [ ] Add questions to exam from bank
- [ ] Question lifecycle (draft/approved/retired)

### Phase 5: Enterprise Features

**Integrations:**
- [ ] SSO/SAML authentication
- [ ] LMS integration (Moodle, Canvas, Blackboard)
- [ ] Video conferencing (Zoom, Teams)
- [ ] Cloud storage providers
- [ ] SMS gateway
- [ ] AI proctoring services
- [ ] Payment/billing system

**Security & Compliance:**
- [ ] Advanced security settings
- [ ] IP restrictions
- [ ] Audit logging
- [ ] Data encryption controls
- [ ] GDPR compliance tools
- [ ] Data retention policies
- [ ] Backup/restore system

**Branding & White-Label:**
- [ ] Custom logo upload
- [ ] Color scheme customization
- [ ] Domain/URL customization
- [ ] Email template branding
- [ ] Custom login page
- [ ] Multi-tenant support

**API & Extensibility:**
- [ ] RESTful API for all resources
- [ ] Webhook support (event triggers)
- [ ] Developer documentation
- [ ] API key management
- [ ] Rate limiting
- [ ] Third-party plugin architecture

---

## **Appendix B: Data Model Overview]

```
┌─────────────────────────────────────────────────────────────────┐
│                      ENTITY RELATIONSHIP DIAGRAM                │
│                                                                 │
│  ┌──────────────┐       ┌──────────────┐                      │
│  │   ORGANIZATION│       │    USER      │                      │
│  │──────────────│       │──────────────│                      │
│  │ id           │◄──────│ id           │                      │
│  │ name         │ 1   M │ email        │                      │
│  │ settings     │       │ role[]       │                      │
│  │ plan_type    │       │ profile      │                      │
│  └──────┬───────┘       │ preferences │                      │
│         │               └──────┬───────┘                      │
│         │                      │                               │
│         │ 1                    │ 1                             │
│         │                      │                               │
│  ┌──────▼───────┐       ┌──────▼───────┐                      │
│  │     EXAM     │       │   COHORT    │                      │
│  │──────────────│       │──────────────│                      │
│  │ id           │       │ id           │                      │
│  │ title        │◄──────│ name         │                      │
│  │ type         │       │ owner_id     │                      │
│  │ status       │       │ settings     │                      │
│  │ version      │       └──────┬───────┘                      │
│  │ config       │              │                               │
│  │ rubrics      │              │ M                             │
│  │ creator_id   │              │                               │
│  └──────┬───────┘              │                               │
│         │                      │                               │
│         │ 1                    │ M                             │
│         │                      │                               │
│  ┌──────▼───────┐       ┌──────▼───────┐                      │
│  │   SESSION    │       │ ENROLLMENT  │                      │
│  │──────────────│       │──────────────│                      │
│  │ id           │       │ id           │                      │
│  │ exam_id (FK) │───────│ cohort_id(FK)│                      │
│  │ schedule     │       │ student_id   │                      │
│  │ venue        │       │ status       │                      │
│  │ proctors[]   │       │ enrolled_at  │                      │
│  │ settings_ov  │       └──────┬───────┘                      │
│  └──────┬───────┘              │                               │
│         │                      │ 1                             │
│         │ 1                    │                               │
│         │                      │                               │
│  ┌──────▼───────┐       ┌──────▼───────┐                      │
│  │   ATTEMPT    │       │   RESULT    │                      │
│  │──────────────│       │──────────────│                      │
│  │ id           │       │ id           │                      │
│  │ session_id   │───────│ attempt_id   │                      │
│  │ student_id   │       │ overall_band │                      │
│  │ started_at   │       │ module_scores│                      │
│  │ completed_at │       │ criteria    │                      │
│  │ status       │       │ feedback    │                      │
│  │ time_taken   │       │ graded_by    │                      │
│  │ responses[]  │       │ graded_at    │                      │
│  └──────┬───────┘       └──────────────┘                      │
│         │                                                      │
│         │ 1                                                    │
│         │                                                      │
│  ┌──────▼───────┐      ┌──────────────┐                      │
│  │  RESPONSE    │      │    ASSET     │                      │
│  │──────────────│      │──────────────│                      │
│  │ id           │      │ id           │                      │
│  │ attempt_id   │      │ file_name    │                      │
│  │ question_id  │      │ file_type    │                      │
│  │ value        │      │ size         │                      │
│  │ is_correct   │      │ url          │                      │
│  │ time_spent   │      │ metadata     │                      │
│  └──────────────┘      │ uploaded_by  │                      │
│                         └──────────────┘                      │
│                                                                 │
│  SUPPORTING ENTITIES:                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   VERSION    │  │   COMMENT    │  │ NOTIFICATION │        │
│  │──────────────│  │──────────────│  │──────────────│        │
│  │ exam_id      │  │ author_id    │  │ recipient   │        │
│  │ number       │  │ target_type  │  │ type        │        │
│  │ snapshot     │  │ content      │  │ read_status │        │
│  │ created_by   │  │ resolved     │  │ sent_at     │        │
│  │ changelog    │  └──────────────┘  └──────────────┘        │
│  └──────────────┘                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## **Appendix C: Permission Matrix (Complete)]

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CAPABILITY PERMISSION MATRIX                         │
├─────────────────┬───────┬───────┬───────┬─────────┬─────────┬───────┬───────┤
│ Capability      │ Super │ Admin │Manager│ Teacher │Creator │Grader │Student│
│                 │ Admin │       │       │         │         │       │       │
├─────────────────┼───────┼───────┼───────┼─────────┼─────────┼───────┼───────┤
│ USER MANAGEMENT  │       │       │       │         │         │       │       │
│ View users      │ ✓     │ ✓     │ ✗     │ ✗       │ ✗       │ ✗     │ ✗    │
│ Create users    │ ✓     │ ✓     │ ✗     │ ✗       │ ✗       │ ✗     │ ✗    │
│ Edit users      │ ✓     │ ✓     │ ✗     │ ✗       │ ✗       │ ✗     │ Self │
│ Delete users    │ ✓     │ ✓     │ ✗     │ ✗       │ ✗       │ ✗     │ ✗    │
│ Assign roles    │ ✓     │ ✓     │ ✗     │ ✗       │ ✗       │ ✗     │ ✗    │
│ Impersonate      │ ✓     │ ✓     │ ✗     │ ✗       │ ✗       │ ✗     │ ✗    │
├─────────────────┼───────┼───────┼───────┼─────────┼─────────┼───────┼───────┤
│ EXAM MANAGEMENT│       │       │       │         │         │       │       │
│ View all exams  │ ✓     │ ✓     │ ✓     │ ✓       │ Own     │ ✗     │ Assgn│
│ Create exam     │ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✗     │ ✗    │
│ Edit exam       │ ✓     │ ✓     │ ✓     │ Own     │ Own     │ ✗     │ ✗    │
│ Delete exam     │ ✓     │ ✓     │ Own   │ Own     │ Own     │ ✗     │ ✗    │
│ Publish exam    │ ✓     │ ✓     │ ✓     │ Own     │ Own     │ ✗     │ ✗    │
│ Archive exam    │ ✓     │ ✓     │ Own   │ Own     │ Own     │ ✗     │ ✗    │
│ Duplicate exam  │ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✗     │ ✗    │
│ Share exam      │ ✓     │ ✓     │ ✓     │ Own     │ Own     │ ✗     │ ✗    │
│ Import/export   │ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✗     │ ✗    │
├─────────────────┼───────┼───────┼───────┼─────────┼─────────┼───────┼───────┤
│ SCHEDULING      │       │       │       │         │         │       │       │
│ View calendar   │ ✓     │ ✓     │ ✓     │ ✓       │ ✗       │ ✗     │ Own  │
│ Create session  │ ✓     │ ✓     │ ✓     │ ✓       │ ✗       │ ✗     │ ✗    │
│ Edit session    │ ✓     │ ✓     │ ✓     │ Own     │ ✗       │ ✗     │ ✗    │
│ Cancel session  │ ✓     │ ✓     │ ✓     │ Own     │ ✗       │ ✗     │ ✗    │
│ Assign students │ ✓     │ ✓     │ ✓     │ Own     │ ✗       │ ✗     │ ✗    │
│ Manage venues   │ ✓     │ ✓     │ ✓     │ ✗       │ ✗       │ ✗     │ ✗    │
├─────────────────┼───────┼───────┼───────┼─────────┼─────────┼───────┼───────┤
│ COHORT MGMT     │       │       │       │         │         │       │       │
│ View cohorts    │ ✓     │ ✓     │ ✓     │ ✓       │ ✗       │ ✗     │ Own  │
│ Create cohort   │ ✓     │ ✓     │ ✓     │ ✓       │ ✗       │ ✗     │ ✗    │
│ Edit cohort     │ ✓     │ ✓     │ ✓     │ Own     │ ✗       │ ✗     │ ✗    │
│ Enroll students │ ✓     │ ✓     │ ✓     │ Own     │ ✗       │ ✗     │ ✗    │
│ Bulk import     │ ✓     │ ✓     │ ✓     │ Own     │ ✗       │ ✗     │ ✗    │
├─────────────────┼───────┼───────┼───────┼─────────┼─────────┼───────┼───────┤
│ GRADING         │       │       │       │         │         │       │       │
│ View grading q  │ ✓     │ ✓     │ ✓     │ ✓       │ ✗       │ ✓     │ ✗    │
│ Grade submissions│ ✓     │ ✓     │ ✓     │ ✓       │ ✗       │ ✓     │ ✗    │
│ Edit grades     │ ✓     │ ✓     │ ✓     │ Own     │ ✗       │ Own    │ ✗    │
│ Calibrate       │ ✓     │ ✓     │ ✓     │ ✓       │ ✗       │ ✓     │ ✗    │
│ View all results│ ✓     │ ✓     │ ✓     │ Cohort  │ ✗       │ Assign│ Own  │
│ Export reports  │ ✓     │ ✓     │ ✓     │ Cohort  │ ✗       │ ✗     │ ✗    │
├─────────────────┼───────┼───────┼───────┼─────────┼─────────┼───────┼───────┤
│ ANALYTICS       │       │       │       │         │         │       │       │
│ View dashboards │ ✓     │ ✓     │ ✓     │ ✓       │ ✗       │ ✗     │ ✗    │
│ Item analysis   │ ✓     │ ✓     │ ✓     │ ✓       │ ✗       │ ✗     │ ✗    │
│ Cohort analytics│ ✓     │ ✓     │ ✓     │ Own     │ ✗       │ ✗     │ ✗    │
│ Custom reports  │ ✓     │ ✓     │ ✓     │ ✓       │ ✗       │ ✗     │ ✗    │
├─────────────────┼───────┼───────┼───────┼─────────┼─────────┼───────┼───────┤
│ SYSTEM SETTINGS │       │       │       │         │         │       │       │
│ General settings│ ✓     │ ✓     │ ✗     │ ✗       │ ✗       │ ✗     │ ✗    │
│ Scoring rules   │ ✓     │ ✓     │ ✗     │ ✗       │ ✗       │ ✗     │ ✗    │
│ Security config │ ✓     │ ✓     │ ✗     │ ✗       │ ✗       │ ✗     │ ✗    │
│ Integrations   │ ✓     │ ✓     │ ✗     │ ✗       │ ✗       │ ✗     │ ✗    │
│ Billing/license │ ✓     │ ✓     │ ✗     │ ✗       │ ✗       │ ✗     │ ✗    │
│ Audit logs     │ ✓     │ ✓     │ ✗     │ ✗       │ ✗       │ ✗     │ ✗    │
├─────────────────┼───────┼───────┼───────┼─────────┼─────────┼───────┼───────┤
│ COLLABORATION   │       │       │       │         │         │       │       │
│ Invite collabs  │ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✗     │ ✗    │
│ Real-time edit  │ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✗     │ ✗    │
│ Comments        │ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✓     │ ✗    │
│ Version history │ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✗     │ ✗    │
│ Review/approve  │ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✗     │ ✗    │
├─────────────────┼───────┼───────┼───────┼─────────┼─────────┼───────┼───────┤
│ ASSETS/TEMPLATES│       │       │       │         │         │       │       │
│ Asset library   │ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✗     │ ✗    │
│ Upload assets   │ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✗     │ ✗    │
│ Templates       │ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✗     │ ✗    │
│ Question bank   │ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✗     │ ✗    │
├─────────────────┼───────┼───────┼───────┼─────────┼─────────┼───────┼───────┤
│ TAKE EXAMS      │       │       │       │         │         │       │       │
│ Take assigned   │ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✓     │ ✓    │
│ View own results│ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✓     │ ✓    │
│ Download cert   │ ✓     │ ✓     │ ✓     │ ✓       │ ✓       │ ✓     │ ✓    │
└─────────────────┴───────┴───────┴───────┴─────────┴─────────┴───────┴───────┘

Legend:
✓ = Full permission
Own = Only own-created or assigned items
Assgn = Only assigned to self
Self = Only own user record
✗ = No permission
```

---

## **Document Version History**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025 | UX Team | Initial comprehensive specification - Management Layer |

---

## **End of Document**

**Status:** Ready for Development Handoff  
**Related Documents:**
- IELTS Exam Builder UX/UI Specification (Creator Interface)
- IELTS Exam Student Interface UX/UI Specification (Test-Taker Experience)
- IELTS Technical Architecture Documentation
- IELTS Database Schema Reference
- IELTS API Specification

**Implementation Priority Recommendation:**

```
Phase 1 (Months 1-3): Foundation
├── User auth & roles
├── Exam library (CRUD)
├── Basic scheduling
├── Student portal (take exam)
├── Basic results
└── Simple notifications

Phase 2 (Months 4-6): Collaboration
├── Real-time collaboration
├── Review workflows
├── Version control
├── Notification system (full)
└── Cohort management

Phase 3 (Months 7-9): Intelligence
├── Grading center
├── Analytics dashboards
├── Item analysis
├── Reporting engine
└── Question bank

Phase 4 (Months 10-12): Enterprise
├── Integrations (SSO, LMS, Zoom)
├── Advanced security
├── White-label/branding
├── API & webhooks
└── Mobile admin app
```

---

*This document represents the complete UX/UI specification for the IELTS Examination Platform's Management and Administration layer. It bridges the gap between content creation (Builder) and content consumption (Student Interface), providing the operational infrastructure necessary for institutions to effectively manage IELTS examination programs at scale.*
