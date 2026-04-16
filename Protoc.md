# 🎨 IELTS Proctoring System — UI/UX Design Specification Document

**Document Version:** 1.0  
**Status:** Draft  
**Date:** June 2025  
**Based On:** PRD v1.0 — IELTS Online Exam Proctoring System  

---

## 📑 Table of Contents

1. [Design Philosophy & Principles](#1-design-philosophy--principles)
2. [Design System Foundation](#2-design-system-foundation)
3. [Color System](#3-color-system)
4. [Typography](#4-typography)
5. [Spacing & Layout Grid](#5-spacing--layout-grid)
6. [Component Library](#6-component-library)
7. [Icon System](#7-icon-system)
8. [Screen Specifications — Student Flow](#8-screen-specifications--student-flow)
9. [Screen Specifications — Proctor Dashboard](#9-screen-specifications--proctor-dashboard)
10. [Screen Specifications — Admin Panel](#10-screen-specifications--admin-panel)
11. [Screen Specifications — Post-Exam Review](#11-screen-specifications--post-exam-review)
12. [Interaction Patterns & Animations](#12-interaction-patterns--animations)
13. [Responsive Design Guidelines](#13-responsive-design-guidelines)
14. [Accessibility (WCAG) Compliance](#14-accessibility-wcag-compliance)
15. [Error States & Edge Cases](#15-error-states--edge-cases)
16. [Design Asset Deliverables](#16-design-asset-deliverables)

---

## 1. Design Philosophy & Principles

### 1.1 Core Design Values

| Principle | Description | Application |
|-----------|-------------|-------------|
| **🎯 Clarity Over Decoration** | Every element must serve a functional purpose; minimize visual noise | Clean layouts, generous whitespace, clear hierarchy |
| **⚡ Performance First** | UI must load fast and feel instant on standard hardware | Minimal animations, optimized assets, CSS-first graphics |
| **🔒 Trust & Security** | Visual language must convey seriousness and security | Professional color palette, formal typography, status clarity |
| **♿ Universal Access** | Usable by students of all abilities and technical literacy levels | Large touch targets, clear labels, high contrast, keyboard navigable |
| **😌 Calm Under Pressure** | Exam environments are stressful; UI must reduce anxiety | Soothing colors, clear progress indication, reassuring messages |
| **📱 Device Agnostic** | Works consistently across desktop/laptop browsers | Responsive but desktop-optimized for exam integrity |

### 1.2 Mood Board / Visual Direction

```
┌─────────────────────────────────────────────────────────────────────┐
│                     VISUAL DIRECTION                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   KEYWORDS:     Professional · Clinical · Secure · Calm · Modern    │
│                                                                     │
│   REFERENCES:                                                       │
│   • Banking/Financial dashboards (trust, data-dense)                │
│   • Medical software (clarity, precision)                           │
│   • Airport control towers (monitoring grids)                       │
│   • Government portals (accessibility, formality)                   │
│                                                                     │
│   AVOID:                                                             │
│   • Playful/casual aesthetics                                       │
│   • Heavy gradients or skeuomorphism                                │
│   • Dark themes for student interface (eye strain during long exams)│
│   • Excessive animation/motion                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 User-Centered Design Considerations

| User Type | Design Priority | Key Considerations |
|-----------|----------------|-------------------|
| **Student** | Zero-friction, zero-anxiety | Clear instructions, minimal decisions, large readable text, no confusing elements, reassuring feedback |
| **Proctor** | Information density, rapid action | Compact data display, color-coded alerts, one-click actions, keyboard shortcuts |
| **Admin** | Comprehensive control, auditability | Full data tables, bulk operations, detailed forms, export capabilities |

---

## 2. Design System Foundation

### 2.1 Design Token Architecture

```
DESIGN TOKENS HIERARCHY
═══════════════════════

┌─────────────────────────────────────────────────────┐
│                  GLOBAL TOKENS                       │
│  (Used across all products/platforms)               │
│                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Color    │ │ Typography│ │ Spacing  │            │
│  │ Primitives│ │ Scale    │ │ Scale    │            │
│  │ (Raw hex)│ │ (px/rem) │ │ (px/rem) │            │
│  └──────────┘ └──────────┘ └──────────┘            │
└──────────────────────────┬──────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
│ ALIAS TOKENS    │ │ ALIAS TOKENS│ │ ALIAS TOKENS    │
│                 │ │             │ │                 │
│ • color.primary │ │ font.sm     │ │ space.xs        │
│ • color.danger  │ │ font.md     │ │ space.sm        │
│ • color.success │ │ font.lg     │ │ space.md        │
│ • color.warning │ │ font.xl     │ │ space.lg        │
│ • ...           │ │ ...         │ │ ...             │
└────────┬────────┘ └──────┬──────┘ └────────┬────────┘
         │                │                │
         └────────────────┼────────────────┘
                          ▼
              ┌───────────────────────┐
              │ COMPONENT TOKENS      │
              │                       │
              │ • button.bg           │
              │ • button.text.color   │
              │ • card.border.radius  │
              │ • input.height        │
              │ • modal.shadow        │
              │ • badge.font.size     │
              │ • ...                 │
              └───────────────────────┘
```

### 2.2 CSS Custom Properties Structure (Implementation)

```css
/* ============================================
   DESIGN TOKENS - CSS Custom Properties
   ============================================ */

:root {
  /* ===== COLOR PRIMITIVES ===== */
  --color-blue-900: #0a1628;
  --color-blue-800: #0f2440;
  --color-blue-700: #143a66;
  --color-blue-600: #1a508b;
  --color-blue-500: #2066b0;
  --color-blue-400: #3d80d4;
  --color-blue-300: #6a9de0;
  --color-blue-200: #a3c0eb;
  --color-blue-100: #d0e0f5;
  --color-blue-50: #e8f2fc;

  --color-green-900: #062a18;
  --color-green-700: #0d5c32;
  --color-green-600: #117a44;
  --color-green-500: #169e58;
  --color-green-400: #28c472;
  --color-green-300: #5ed99c;
  --color-green-100: #b5eed4;
  --color-green-50: #e0f9ec;

  --color-red-900: #2d0f0f;
  --color-red-800: #521515;
  --color-red-700: #8b1a1a;
  --color-red-600: #c42020;
  --color-red-500: #e53935;
  --color-red-400: #ef5350;
  --color-red-300: #f57c75;
  --color-red-100: #ffcdd2;
  --color-red-50: #ffebee;

  --color-amber-900: #3d2500;
  --color-amber-700: #7a4b00;
  --color-amber-600: #b36b00;
  --color-amber-500: #e69100;
  --color-amber-400: #ffab00;
  --color-amber-300: #ffc533;
  --color-amber-100: #ffe5a0;
  --color-amber-50: #fff8e1;

  --color-gray-900: #1a1a1a;
  --color-gray-800: #333333;
  --color-gray-700: #4d4d4d;
  --color-gray-600: #666666;
  --color-gray-500: #808080;
  --color-gray-400: #999999;
  --color-gray-300: #b3b3b3;
  --color-gray-200: #cccccc;
  --color-gray-100: #e5e5e5;
  --color-gray-50: #f7f7f7;

  --color-white: #ffffff;
  --color-black: #000000;

  /* ===== SEMANTIC COLOR ALIASES ===== */
  
  /* Primary / Brand */
  --color-primary: var(--color-blue-600);
  --color-primary-hover: var(--color-blue-700);
  --color-primary-active: var(--color-blue-800);
  --color-primary-light: var(--color-blue-100);
  --color-primary-text: var(--color-white);

  /* Status Colors */
  --color-success: var(--color-green-600);
  --color-success-bg: var(--color-green-50);
  --color-success-border: var(--color-green-100);

  --color-warning: var(--color-amber-600);
  --color-warning-bg: var(--color-amber-50);
  --color-warning-border: var(--color-amber-100);

  --color-danger: var(--color-red-600);
  --color-danger-bg: var(--color-red-50);
  --color-danger-border: var(--color-red-100);

  --color-info: var(--color-blue-500);
  --color-info-bg: var(--color-blue-50);
  --color-info-border: var(--color-blue-100);

  /* Neutral */
  --color-text-primary: var(--color-gray-900);
  --color-text-secondary: var(--color-gray-600);
  --color-text-tertiary: var(--color-gray-400);
  --color-text-disabled: var(--color-gray-300);
  --color-text-inverse: var(--color-white);

  --color-bg-primary: var(--color-white);
  --color-bg-secondary: var(--color-gray-50);
  --color-bg-tertiary: var(--color-gray-100);
  --color-bg-elevated: var(--color-white);

  --color-border-default: var(--color-gray-200);
  --color-border-strong: var(--color-gray-300);
  --color-border-subtle: var(--color-gray-100);

  /* ===== TYPOGRAPHY SCALE ===== */
  --font-family-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-family-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;

  --font-size-xs: 0.75rem;    /* 12px */
  --font-size-sm: 0.875rem;   /* 14px */
  --font-size-base: 1rem;     /* 16px */
  --font-size-lg: 1.125rem;   /* 18px */
  --font-size-xl: 1.25rem;    /* 20px */
  --font-size-2xl: 1.5rem;    /* 24px */
  --font-size-3xl: 1.875rem;  /* 30px */
  --font-size-4xl: 2.25rem;   /* 36px */

  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  --line-height-tight: 1.25;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.75;

  /* ===== SPACING SCALE (4px base unit) ===== */
  --space-0: 0;
  --space-px: 1px;
  --space-0-5: 0.125rem;  /* 2px */
  --space-1: 0.25rem;     /* 4px */
  --space-1-5: 0.375rem;  /* 6px */
  --space-2: 0.5rem;      /* 8px */
  --space-2-5: 0.625rem;  /* 10px */
  --space-3: 0.75rem;     /* 12px */
  --space-4: 1rem;        /* 16px */
  --space-5: 1.25rem;     /* 20px */
  --space-6: 1.5rem;      /* 24px */
  --space-8: 2rem;        /* 32px */
  --space-10: 2.5rem;     /* 40px */
  --space-12: 3rem;       /* 48px */
  --space-16: 4rem;       /* 64px */
  --space-20: 5rem;       /* 80px */
  --space-24: 6rem;       /* 96px */

  /* ===== BORDER RADIUS ===== */
  --radius-none: 0;
  --radius-sm: 0.25rem;   /* 4px */
  --radius-md: 0.375rem;  /* 6px */
  --radius-lg: 0.5rem;    /* 8px */
  --radius-xl: 0.75rem;   /* 12px */
  --radius-2xl: 1rem;     /* 16px */
  --radius-full: 9999px;

  /* ===== SHADOWS ===== */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05);
  --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04);
  --shadow-inner: inset 0 2px 4px rgba(0, 0, 0, 0.06);

  /* ===== TRANSITIONS ===== */
  --transition-fast: 150ms ease;
  --transition-base: 200ms ease;
  --transition-slow: 300ms ease;

  /* ===== Z-INDEX SCALE ===== */
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-overlay: 300;
  --z-modal: 400;
  --z-popover: 500;
  --z-toast: 600;
  --z-tooltip: 700;
}
```

---

## 3. Color System

### 3.1 Primary Palette

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PRIMARY PALETTE (Blue)                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ■■■■■■■■■■■■■■■■■  blue-900  #0A1628  →  Headers, dark backgrounds │
│   ■■■■■■■■■■■■■■■□□  blue-800  #0F2440  →  Active nav states         │
│   ■■■■■■■■■■■■■□□□□  blue-700  #143A66  →  Hover states (primary)    │
│   ■■■■■■■■■■■■□□□□□  blue-600  #1A508B  →  PRIMARY BRAND COLOR       │
│   ■■■■■■■■■■□□□□□□□  blue-500  #2066B0  →  Links, interactive elements│
│   ■■■■■■■■□□□□□□□□□  blue-400  #3D80D4  →  Light accents             │
│   ■■■■■□□□□□□□□□□□□  blue-300  #6A9DE0  →  Disabled states           │
│   ■■□□□□□□□□□□□□□□□  blue-200  #A3C0EB  →  Borders, dividers         │
│   □□□□□□□□□□□□□□□□□  blue-100  #D0E0F5  →  Light backgrounds          │
│   □□□□□□□□□□□□□□□░░  blue-50   #E8F2FC  →  Page backgrounds (alt)    │
│                                                                         │
│   USAGE:                                                                │
│   • Primary buttons: blue-600 bg + white text                          │
│   • Primary hover: blue-700                                            │
│   • Links: blue-500                                                    │
│   • Page header bg: blue-900 or blue-800                               │
│   • Selected state indicator: blue-100 bg + blue-700 text             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Semantic Status Colors

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      STATUS COLOR SYSTEM                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ✅ SUCCESS (Green)        ⚠️ WARNING (Amber)       ❌ DANGER (Red)   │
│   ══════════════════        ═══════════════════       ═════════════════  │
│                                                                         │
│   Solid:  #169E58            Solid:  #E69100           Solid:  #E53935 │
│   BG:     #E0F9EC            BG:     #FFF8E1           BG:     #FFEBEE │
│   Border: #B5EED4            Border: #FFE5A0           Border: #FFCDD2 │
│   Text:   #0D5C32            Text:   #7A4B00           Text:   #8B1A1A │
│                                                                         │
│   USAGE:                                                                 │
│   • Success: Session completed, check passed, clean flag                │
│   • Warning: Minor violation, idle alert, caution needed                │
│   • Danger: Critical violation, terminated session, errors              │
│                                                                         │
│   🔵 INFO (Blue)              ⚫ NEUTRAL (Gray)                         │
│   ══════════════════          ═══════════════════                        │
│                                                                         │
│   Solid:  #2066B0              Neutral: #6B7280                         │
│   BG:     #E8F2FC              BG:      #F3F4F6                         │
│   Border: #D0E0F5              Border:  #E5E7EB                         │
│   Text:   #143A66              Text:    #374151                         │
│                                                                         │
│   USAGE:                                                                 │
│   • Info: Informational messages, tips, help text                       │
│   • Neutral: Default states, inactive elements, secondary info         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Status Indicator Colors (Proctor Dashboard)

| Status | Dot Color | Background | Border | Text Color | Usage |
|--------|-----------|------------|--------|------------|-------|
| 🟢 **Active / Normal** | `#169E58` | `#E0F9EC` | `#B5EED4` | `#0D5C32` | Student actively taking exam normally |
| 🟡 **Warned** | `#E69100` | `#FFF8E1` | `#FFE5A0` | `#7A4B00` | Student has received warning(s) |
| 🟠 **Paused** | `#D97706` | `#FFF7ED` | `#FDE68A` | `#92400E` | Exam paused by proctor or auto-pause |
| 🔴 **Terminated** | `#DC2626` | #FEF2F2` | `#FECACA` | `#991B1B` | Session ended due to violations |
| ⚫ **Idle / Inactive** | `#6B7280` | `#F3F4F6` | `#E5E7EB` | `#374151` | No activity detected (possible away) |
| 🔵 **Connecting** | `#2563EB` | `#EFF6FF` | `#BFDBFE` | `#1E40AF` | Reconnecting after network drop |

### 3.4 Violation Severity Color Mapping

| Severity | Color | Hex | Visual Treatment |
|----------|-------|-----|-------------------|
| **Low** | Blue | `#3B82F6` | Info icon, subtle left border, log-only |
| **Medium** | Amber | `#F59E0B` | Warning icon, amber background flash, popup required |
| **High** | Orange | `#EA580C` | Alert icon, orange border pulse, proctor notification |
| **Critical** | Red | `#DC2626` | Danger icon, red overlay flash, auto-action triggered |

---

## 4. Typography

### 4.1 Font Family Selection

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         TYPOGRAPHY SYSTEM                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   PRIMARY FONT: Inter                                                   │
│   ─────────────────────                                                  │
│   Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll Mm Nn Oo Pp Qq Rr Ss Tt Uu Vv    │
│      Ww Xx Yy Zz 0123456789 !@#$%&*()                                  │
│                                                                         │
│   Why Inter?                                                            │
│   • Excellent screen readability at all sizes                           │
│   • Optimized for web (variable font available)                         │
│   • Strong tabular figures for data tables                              │
│   • Open source (Google Fonts / self-hosted)                            │
│   • Wide language support                                               │
│                                                                         │
│   MONOSPACE FONT: JetBrains Mono                                        │
│   ────────────────────────────                                          │
│   AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz                │
│   0123456789 {}[]<>|/\~!@#$%^&*()_+-=                                   │
│                                                                         │
│   Usage: Code snippets, timestamps, IDs, technical data                 │
│                                                                         │
│   FALLBACK STACK:                                                        │
│   font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', │
│                 Roboto, 'Helvetica Neue', Arial, sans-serif;            │
│                                                                         │
│   mono-stack: 'JetBrains Mono', 'Fira Code', 'Cascadia Code',          │
│               Consolas, 'Courier New', monospace;                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Type Scale

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          TYPE SCALE                                     │
├────────────────┬──────────────┬────────┬────────────┬───────────────────┤
│ LEVEL          │ SIZE         │ WEIGHT │ LINE-HEIGHT│ USAGE             │
├────────────────┼──────────────┼────────┼────────────┼───────────────────┤
│ Display / Hero │ 36px (2.25rem)│ Bold   │ 1.2        │ Login page title, │
│ (4xl)          │              │ (700)  │            │ main headings     │
├────────────────┼──────────────┼────────┼────────────┼───────────────────┤
│ Page Title     │ 30px (1.875) │ Semi-  │ 1.25       │ Section headers,  │
│ (3xl)          │ rem          │ bold   │            │ page titles       │
│                │              │ (600)  │            │                   │
├────────────────┼──────────────┼────────┼────────────┼───────────────────┤
│ Section Header │ 24px (1.5rem)│ Semi-  │ 1.3        │ Card titles,      │
│ (2xl)          │              │ bold   │            │ panel headers     │
│                │              │ (600)  │            │                   │
├────────────────┼──────────────┼────────┼────────────┼───────────────────┤
│ Subsection     │ 20px (1.25re │ Semi-  │ 1.4        │ Sub-headers,      │
│ (xl)           │ m)           │ bold   │            │ important labels  │
│                │              │ (600)  │            │                   │
├────────────────┼──────────────┼────────┼────────────┼───────────────────┤
│ Body Large     │ 18px (1.125r │ Medium │ 1.5        │ Lead paragraphs,  │
│ (lg)           │ em)          │ (500)  │            │ important body    │
├────────────────┼──────────────┼────────┼────────────┼───────────────────┤
│ Body Regular   │ 16px (1rem)  │ Normal │ 1.5        │ Default body text, │
│ (base)         │              │ (400)  │            │ content, inputs    │
├────────────────┼──────────────┼────────┼────────────┼───────────────────┤
│ Body Small     │ 14px (0.875r │ Normal │ 1.5        │ Secondary text,   │
│ (sm)           │ em)          │ (400)  │            │ captions, hints   │
├────────────────┼──────────────┼────────┼────────────┼───────────────────┤
│ Caption        │ 12px (0.75re │ Medium │ 1.4        │ Labels, badges,   │
│ (xs)           │ m)           │ (500)  │            │ timestamps, meta  │
├────────────────┼──────────────┼────────┼────────────┼───────────────────┤
│ Mono / Code    │ 14px (0.875r │ Normal │ 1.5        │ IDs, timestamps,  │
│ (mono-sm)      │ em)          │ (400)  │            │ technical data    │
└────────────────┴──────────────┴────────┴────────────┴───────────────────┘
```

### 4.3 Typography Usage Rules

| Context | Style | Example |
|---------|-------|---------|
| **Page Title** | 3xl, semibold, gray-900 | "IELTS Academic Exam" |
| **Card Title** | 2xl, semibold, gray-900 | "Session Details" |
| **Section Label** | sm, uppercase, medium, gray-500, tracking-wide | "STUDENT INFORMATION" |
| **Body Text** | base, normal, gray-700 | "Your exam will begin shortly." |
| **Help/Hint Text** | sm, normal, gray-500 | "Make sure you are in a quiet location." |
| **Data Value** | lg, semibold, monospace, gray-900 | "02:34:15" |
| **Timestamp** | xs, monospace, gray-400 | "14:32:05.234" |
| **Button Text** | sm, semibold, uppercase (optional), letter-spacing |
| **Link Text** | sm, medium, blue-600, underline-on-hover | "View full report" |
| **Error Message** | sm, medium, red-700 | "Tab switching is not permitted." |
| **Status Badge** | xs, semibold, colored bg | "ACTIVE", "WARNED" |

---

## 5. Spacing & Layout Grid

### 5.1 Spacing Scale Usage

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       SPACING APPLICATION GUIDE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   space-0 (0px)     : Reset, collapse, adjacent items flush             │
│   space-1 (4px)     : Tight spacing between icon + text in button       │
│   space-2 (8px)     : Icon to label gap, compact list item padding      │
│   space-3 (12px)    : Related controls group gap, small card padding    │
│   space-4 (16px)    : Standard padding inside cards, form field gap     │
│   space-5 (20px)    : List item vertical spacing, section inner pad     │
│   space-6 (24px)    : Card grid gaps, panel section spacing             │
│   space-8 (32px)    : Major section separation, large card padding      │
│   space-10 (40px)   : Page section vertical rhythm                    │
│   space-12 (48px)   : Major content block separation                    │
│   space-16 (64px)   : Hero section padding, login page centering        │
│   space-20 (80px)   : Major page area separation                       │
│   space-24 (96px)   : Maximum vertical breathing room                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Layout Grid System

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         LAYOUT GRID                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   BASE UNIT: 4px                                                        │
│   COLUMN WIDTH: Variable (flexible / CSS Grid)                          │
│   GUTTER: 24px (space-6)                                                │
│   CONTAINER MAX-WIDTH: 1920px (for proctor dashboard)                   │
│   CONTAINER STANDARD: 1440px (for admin pages)                          │
│   CONTAINER STUDENT: 100vw (fullscreen exam mode)                       │
│   PAGE MARGIN: 24px                                                      │
│                                                                         │
│   ═══════════════════════════════════════════════════════════════════    │
│   PROCTOR DASHBOARD LAYOUT (1920px target):                             │
│   ═══════════════════════════════════════════════════════════════════    │
│                                                                         │
│   ┌─ 24px margin ──────────────────────────────────────────┐            │
│   │ ┌── HEADER BAR (full width, h: 64px) ──────────────┐  │            │
│   │ └──────────────────────────────────────────────────┘  │            │
│   │ ┌── STATS ROW (h: 80px) ───────────────────────────┐  │            │
│   │ └──────────────────────────────────────────────────┘  │            │
│   │ ┌────────────────┬─────────────────────────────────┐│            │
│   │ │ ALERT PANEL    │  STUDENT GRID (main area)       ││            │
│   │ │ (w: 360px)     │  (flex-grow, minmax 0 1fr)     ││            │
│   │ │ fixed          │                                 ││            │
│   │ │ scrollable     │  ┌────┐┌────┐┌────┐┌────┐┌────┐││            │
│   │ │                │  │    ││    ││    ││    ││    │││            │
│   │ │                │  └────┘└────┘└────┘└────┘└────┘││            │
│   │ │                │  ┌────┐┌────┐┌────┐┌────┐┌────┐││            │
│   │ │                │  │    ││    ││    ││    ││    │││            │
│   │ │                │  └────┘└────┘└────┘└────┘└────┘││            │
│   │ │                │  (grid: auto-fill, min 180px)  ││            │
│   │ ├────────────────┴─────────────────────────────────┤│            │
│   │ │ DETAIL PANEL (collapsible, h: 300px default)     ││            │
│   │ └──────────────────────────────────────────────────┘  │            │
│   └───────────────────────────────────────────────────────┘            │
│                                                                         │
│   ═══════════════════════════════════════════════════════════════════    │
│   ADMIN PAGE LAYOUT (1440px target):                                   │
│   ═══════════════════════════════════════════════════════════════════    │
│                                                                         │
│   ┌─ sidebar (240px) ─┐┌─ main content ─────────────────────────┐      │
│   │                    ││                                         │      │
│   │  Logo              ││  Page Header / Breadcrumb               │      │
│   │  ─────────────     ││  ─────────────────────────               │      │
│   │  ● Dashboard       ││                                         │      │
│   │  ○ Sessions        ││  Content Area:                          │      │
│   │  ○ Students        ││  ┌─────────────────────────────────┐    │      │
│   │  ○ Rules           ││  │                                 │    │      │
│   │  ○ Reports         ││  │   Card / Table / Form            │    │      │
│  │  ○ Settings        ││  │                                 │    │      │
│  │                    ││  └─────────────────────────────────┘    │      │
│  │  ─────────────     ││                                         │      │
│  │  Logout            ││                                         │      │
│  └────────────────────┘└─────────────────────────────────────────┘      │
│                                                                         │
│   ═══════════════════════════════════════════════════════════════════    │
│   STUDENT EXAM LAYOUT (fullscreen):                                    │
│   ═══════════════════════════════════════════════════════════════════    │
│                                                                         │
│   ┌───────────────────────────────────────────────────────────────┐     │
│   │  EXAM HEADER BAR (h: 56px, always visible)                    │     │
│   │  [Status]  Timer: 01:23:45  Section: Writing    [🆘 Help]    │     │
│   ├───────────────────────────────────────────────────────────────┤     │
│   │                                                               │     │
│   │                                                               │     │
│   │                    EXAM CONTENT AREA                         │     │
│   │                    (fills remaining viewport)                 │     │
│   │                                                               │     │
│   │                                                               │     │
│   │                                                               │     │
│   └───────────────────────────────────────────────────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Breakpoints

| Name | Width | Target | Notes |
|------|-------|--------|-------|
| `sm` | ≥640px | Large tablets (landscape) | Minimum supported |
| `md` | ≥768px | Small laptops | Admin sidebar collapses |
| `lg` | ≥1024px | Standard laptops | Standard layout |
| `xl` | ≥1440px | Desktop monitors | Optimal admin view |
| `2xl` | ≥1920px | Large monitors / external displays | Proctor dashboard optimal |

---

## 6. Component Library

### 6.1 Button System

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           BUTTONS                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   VARIANTS:                                                             │
│   ═════════                                                            │
│                                                                         │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│   │   ▶  PRIMARY     │  │  SECONDARY       │  │   ⚠  DANGER      │      │
│   │                  │  │                  │  │                  │      │
│   │  Background:     │  │  Background:     │  │  Background:     │      │
│   │  blue-600        │  │  white           │  │  red-600         │      │
│   │  Text: white     │  │  Border: gray-300│  │  Text: white     │      │
│   │  Hover: blue-700 │  │  Text: gray-700  │  │  Hover: red-700  │      │
│   └──────────────────┘  └──────────────────┘  └──────────────────┘      │
│                                                                         │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│   │   ○  GHOST       │  │   ⊕  OUTLINE     │  │   ↗  LINK        │      │
│   │                  │  │                  │  │                  │      │
│   │  Background:     │  │  Background:     │  │  No background   │      │
│   │  transparent     │  │  transparent     │  │  Text only       │      │
│   │  Text: blue-600  │  │  Border: blue-500│  │  Color: blue-600 │      │
│   │  Hover: blue-50  │  │  Text: blue-600  │  │  Hover: underlined│     │
│   └──────────────────┘  └──────────────────┘  └──────────────────┘      │
│                                                                         │
│   SIZES:                                                                │
│   ════════                                                              │
│                                                                         │
│   ┌─────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
│   │  SMALL (sm) │  │  MEDIUM (md)     │  │  LARGE (lg)              │   │
│   │             │  │                  │  │                          │   │
│   │ Height: 32px│  │ Height: 40px     │  │ Height: 48px             │   │
│   │ Padding:    │  │ Padding:         │  │ Padding:                 │   │
│   │  8px 16px   │  │  10px 20px       │  │  12px 24px               │   │
│   │ Font: xs    │  │ Font: sm         │  │ Font: base                │   │
│   │ [ Start ]   │  │ [  Start Exam  ] │  │ [  Begin Examination  ]  │   │
│   └─────────────┘  └──────────────────┘  └──────────────────────────┘   │
│                                                                         │
│   STATES:                                                               │
│   ════════                                                              │
│                                                                         │
│   Default  →  Hover  →  Active/Pressed  →  Focus  →  Disabled          │
│   ────────     ──────     ──────────────      ──────     ────────       │
│                                                                         │
│   [ Submit ]   [ Submit ]   [ Submit ]        [~~~~~~~]  [ Submit ]    │
│   (normal)     (slightly    (darker +         (ring      (grayed out,  │
│                 darker)      inset shadow)     outline)   no pointer)  │
│                                                                         │
│   WITH ICONS:                                                           │
│   ═══════════                                                          │
│                                                                         │
│   ┌────────────────────┐  ┌──────────────────────┐                      │
│   │  ➕  Add Student    │  │  Export  ↓           │                      │
│   │  (icon left)       │  │  (icon right+chevron)│                      │
│   └────────────────────┘  └──────────────────────┘                      │
│                                                                         │
│   Icon spacing: space-2 (8px) between icon and text                     │
│   Icon size: 16px for sm/md, 18px for lg                                │
│                                                                         │
│   SPECIFICATIONS TABLE:                                                 │
│   ┌─────────┬─────────┬──────────┬─────────┬────────┬────────────────┐  │
│   │ Size    │ Height  │ Padding-H│ Font    │ Radius │ Icon Size      │  │
│   ├─────────┼─────────┼──────────┼─────────┼────────┼────────────────┤  │
│   │ sm      │ 32px    │ 8px 16px │ xs(12px)│ md(6px)│ 14px           │  │
│   │ md      │ 40px    │ 10px 20px │ sm(14px)│ md(6px)│ 16px           │  │
│   │ lg      │ 48px    │ 12px 24px │ base(16px)│ lg(8px)│ 18px           │  │
│   └─────────┴─────────┴──────────┴─────────┴────────┴────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Input / Form Fields

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FORM INPUTS                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   TEXT INPUT:                                                           │
│   ════════════                                                          │
│                                                                         │
│   Label (sm, medium, gray-700)                                          │
│   ┌──────────────────────────────────────────────────────────────┐      │
│   │  👤  Enter your email address...                      │  ✕   │      │
│   └──────────────────────────────────────────────────────────────┘      │
│   Hint text (xs, gray-500)                                             │
│                                                                         │
│   Dimensions: Height 40px (md) / 36px (sm) / 48px (lg)                 │
│   Padding: 12px horizontal (left: 40px if has leading icon)            │
│   Border: 1px solid gray-200                                           │
│   Border radius: md (6px)                                              │
│   Font: base (16px) for accessibility (prevents zoom on iOS)           │
│                                                                         │
│   STATES:                                                               │
│   ┌──────────────────────────────────────────────────────────────┐      │
│   │ DEFAULT:  border-gray-200, bg-white                           │      │
│   │ HOVER:    border-gray-300                                     │      │
│   │ FOCUS:    border-blue-500, ring-2 ring-blue-100 (outline)     │      │
│   │ ERROR:    border-red-500, ring-2 ring-red-100                 │      │
│   │ DISABLED: border-gray-100, bg-gray-50, text-gray-400          │      │
│   │ SUCCESS:  border-green-500, ring-2 ring-green-100             │      │
│   └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
│   WITH ERROR STATE:                                                     │
│   Email Address                                                         │
│   ┌──────────────────────────────────────────────────────────────┐      │
│   │  invalid@email  ⚠                                        ✕   │      │
│   └──────────────────────────────────────────────────────────────┘      │
│   ⚠ Please enter a valid email address.                               │
│                                                                         │
│   SELECT / DROPDOWN:                                                    │
│   ═══════════════════                                                   │
│   Select Exam Session                                                  │
│   ┌──────────────────────────────────────────────────────────────┐      │
│   │  IELTS Academic - 15 June 2025 09:00                    ▼   │      │
│   └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
│   TEXTAREA:                                                             │
│   ══════════                                                            │
│   Review Notes                                                          │
│   ┌──────────────────────────────────────────────────────────────┐      │
│   │                                                              │      │
│   │  Enter your review notes and observations here...            │      │
│   │                                                              │      │
│   │                                                              │      │
│   │                                                              │      │
│   └──────────────────────────────────────────────────────────────┘      │
│   Min height: 120px; resizable vertically only                        │
│                                                                         │
│   TOGGLE / SWITCH:                                                      │
│   ════════════════                                                      │
│                                                                         │
│   Rule Active                                                           │
│   ┌─────────────────────────────────────────────┐  ┌───────┐           │
│   │ ○────────────────────────────────────●  ON  │  │ ●     │ OFF        │
│   └─────────────────────────────────────────────┘  └───────┘           │
│                                                                         │
│   CHECKBOX:                                                             │
│   ═════════                                                              │
│   ☐ Remember me for 30 days                                            │
│   ☑ I agree to the terms and conditions                                 │
│   ⚠ Error: You must accept the terms                                   │
│                                                                         │
│   RADIO GROUP:                                                          │
│   ═════════════                                                         │
│   Flag this session as:                                                 │
│   ◉ Clean (no issues detected)                                         │
│   ○ Suspicious (needs further review)                                   │
│   ○ Confirmed Misconduct                                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Cards

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            CARDS                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   BASIC CARD:                                                           │
│   ══════════                                                            │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  ┌─────────────────────────────────────────────────────────┐    │   │
│   │  │  CARD HEADER (optional)                                │    │   │
│   │  │  Title (2xl, semibold)              Actions →           │    │   │
│   │  └─────────────────────────────────────────────────────────┘    │   │
│   │                                                                 │   │
│   │  ┌─────────────────────────────────────────────────────────┐    │   │
│   │  │                                                         │    │   │
│   │  │  CARD BODY                                             │    │   │
│   │  │                                                         │    │   │
│   │  │  Content goes here...                                   │    │   │
│   │  │                                                         │    │   │
│   │  └─────────────────────────────────────────────────────────┘    │   │
│   │                                                                 │   │
│   │  ┌─────────────────────────────────────────────────────────┐    │   │
│   │  │  CARD FOOTER (optional)                                │    │   │
│   │  │  Secondary actions or metadata                          │    │   │
│   │  └─────────────────────────────────────────────────────────┘    │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   Specs:                                                                │
│   • Border: 1px solid gray-200                                         │
│   • Border-radius: xl (12px)                                           │
│   • Shadow: sm (default), md (on hover/elevated)                        │
│   • Padding: space-6 (24px)                                            │
│   • Background: white                                                  │
│                                                                         │
│   STUDENT CARD (Proctor Grid):                                          │
│   ═══════════════════════════                                           │
│   ┌────────────────────────────────────┐                               │
│   │  ┌──────────────────────────────┐  │  ← Status top border          │
│   │  │  🟢  (status dot)           │  │     (colored 3px top)         │
│   │  │                              │  │                               │
│   │  │  ┌──────┐                   │  │                               │
│   │  │  │ JD   │  Avatar (40px)    │  │                               │
│   │  │  └──────┘  circle, initials │  │                               │
│   │  │                              │  │                               │
│   │  │  John Doe                   │  │                               │
│   │  │  ID: STU-0042               │  │                               │
│   │  │                              │  │                               │
│   │  │  Section: Writing            │  │                               │
│   │  │  Timer: 45:23  ⏱            │  │                               │
│   │  │                              │  │                               │
│   │  │  Violations: 2  ⚠️           │  │                               │
│   │  └──────────────────────────────┘  │                               │
│   └────────────────────────────────────┘                               │
│                                                                         │
│   Card size: min-width 200px, flex-grow                                  │
│   Status border: 3px solid (status color) at top                        │
│   Clickable: cursor-pointer, shadow elevation on hover                  │
│   Selected state: ring-2 ring-blue-500 ring-offset-2                   │
│                                                                         │
│   STAT CARD (Dashboard Stats):                                          │
│   ════════════════════════════                                          │
│   ┌─────────────────────────────────────┐                               │
│   │  🟢                                │  ← Icon circle (left)        │
│   │                                     │                               │
│   │  94                                 │  ← Value (3xl, bold)        │
│   │  Active Students                   │  ← Label (sm, gray-500)      │
│   │                                     │                               │
│   │  ━━━━━━━━━━━━━━━  +5 from last hr  │  ← Optional trend line/info │
│   └─────────────────────────────────────┘                               │
│                                                                         │
│   Width: ~200px, compact padding, icon-left layout                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.4 Badges / Tags / Status Indicators

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      BADGES & STATUS INDICATORS                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   STATUS BADGE (Pill-shaped):                                           │
│   ═════════════════════════                                             │
│                                                                         │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│   │  🟢 ACTIVE│  │🟡 WARNED │  │🟠 PAUSED │  │🔴 TERM.  │  │⚫ IDLE │  │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘  └────────┘  │
│                                                                         │
│   Specs: Full rounded (radius-full), px-2 py-1, font-xs, semibold     │
│   Background: light tint of status color                                │
│   Text: dark shade of status color                                      │
│                                                                         │
│   SEVERITY BADGE:                                                       │
│   ═══════════════                                                       │
│                                                                         │
│   ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌───────────┐               │
│   │ 🔵 LOW  │  │ 🟡MEDIUM │  │ 🟠 HIGH │  │ 🔴CRITICAL│               │
│   └─────────┘  └──────────┘  └─────────┘  └───────────┘               │
│                                                                         │
│   COUNT BADGE (Notification):                                           │
│   ══════════════════════════                                            │
│                                                                         │
│   Icon (🔔) ┌───┐                                                       │
│            │ 3 │  ← Small circle, red bg, white text, absolute position │
│            └───┘                                                       │
│                                                                         │
│   DOT STATUS INDICATOR:                                                 │
│   ═══════════════════════                                               │
│                                                                         │
│   ● Green (online/active)    Diameter: 8px, solid fill                  │
│   ● Amber (warning)          Optional: pulse animation                  │
│   ● Red (error/critical)     Optional: pulse animation                  │
│   ● Gray (offline/idle)      No animation                               │
│                                                                         │
│   TAG / LABEL:                                                          │
│   ════════════                                                            │
│   ┌─────────────┐  ┌──────────────┐  ┌─────────────┐                   │
│   │  Reading     │  │  Tab Switch  │  │  Confirmed  │                   │
│   └─────────────┘  └──────────────┘  └─────────────┘                   │
│                                                                         │
│   Gray-100 bg, gray-700 text, radius-md, slightly rectangular           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.5 Tables

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              TABLES                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   STANDARD DATA TABLE:                                                  │
│   ════════════════════                                                  │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  Student        │ Date       │ Violations │ Status    │ Action  │   │
│   ├─────────────────┼────────────┼────────────┼───────────┼─────────┤   │
│   │  John Doe       │ 15 Jun '25 │ 5          │ ⚠️ Warn   │ [View]  │   │
│   │  Jane Smith     │ 15 Jun '25 │ 0          │ ✅ Clean  │ [View]  │   │
│   │  Ali Ahmed      │ 15 Jun '25 │ 12         │ 🔴 Term.  │ [View]  │   │
│   │  Maria Garcia   │ 15 Jun '25 │ 2          │ ⚠️ Susp.  │ [View]  │   │
│   │  Chen Wei       │ 15 Jun '25 │ 0          │ ✅ Clean  │ [View]  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   Showing 1-5 of 98 results              < 1 2 3 ... 20 >               │
│                                                                         │
│   SPECS:                                                                │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │ Header Row:                                                      │   │
│   │  • Background: gray-50                                          │   │
│   │  • Font: xs, uppercase, semibold, gray-500, tracking-wide       │   │
│   │  • Border-bottom: 2px solid gray-200                           │   │
│   │                                                                  │   │
│   │ Data Rows:                                                       │   │
│   │  • Height: 56px per row (comfortable click target)              │   │
│   │  • Border-bottom: 1px solid gray-100                           │   │
│   │  • Hover: bg-gray-50 highlight                                 │   │
│   │  • Selected: bg-blue-50 with blue-100 left border (3px)        │   │
│   │  • Font: sm, normal, gray-700 for data                          │   │
│   │                                                                  │   │
│   │ Cell Padding: space-3 (12px) horizontal, space-2 (8px) vert    │   │
│   │ Striped: Optional (odd rows: white, even: gray-50)             │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   COMPACT TABLE (for dense data):                                       │
│   ════════════════════════════                                          │
│   Row height: 40px, padding: space-2, font: xs                          │
│                                                                         │
│   TABLE WITH EXPANDABLE ROWS:                                            │
│   ════════════════════════════════                                      │
│   ▶ John Doe  │ 15 Jun  │ 5  │ ⚠️  │ [View]                            │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │ Expanded detail row (spans all columns):                        │   │
│   │ • Violation breakdown by type                                  │   │
│   │ • Timeline preview                                            │   │
│   │ • Quick actions                                                │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.6 Modals / Dialogs

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          MODALS / DIALOGS                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   STRUCTURE:                                                            │
│   ══════════                                                            │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  BACKDROP (overlay)                                            │   │
│   │  • Color: black/50 opacity                                     │   │
│   │  • Blur: backdrop-blur-sm (optional)                           │   │
│   │  • Click outside to close (configurable)                       │   │
│   │  │                                                             │   │
│   │  │  ┌─────────────────────────────────────────────────────┐    │   │
│   │  │  │  MODAL CONTAINER                                     │    │   │
│   │  │  │                                                      │    │   │
│   │  │  │  ┌──────────────────────────────────────────────┐   │    │   │
│   │  │  │  │  HEADER (drag handle optional)               │   │    │   │
│   │  │  │  │  Modal Title (xl, semibold)        [✕ Close] │   │    │   │
│   │  │  │  └──────────────────────────────────────────────┘   │    │   │
│   │  │  │                                                      │    │   │
│   │  │  │  ┌──────────────────────────────────────────────┐   │    │   │
│   │  │  │  │  BODY                                         │   │    │   │
│   │  │  │  │                                              │   │    │   │
│   │  │  │  │  Content, form fields, message, etc.         │   │    │   │
│   │  │  │  │                                              │   │    │   │
│   │  │  │  └──────────────────────────────────────────────┘   │    │   │
│   │  │  │                                                      │    │   │
│   │  │  │  ┌──────────────────────────────────────────────┐   │    │   │
│   │  │  │  │  FOOTER                                       │   │    │   │
│   │  │  │  │  [Cancel]                    [Confirm] [Save] │   │    │   │
│   │  │  │  └──────────────────────────────────────────────┘   │    │   │
│   │  │  │                                                      │    │   │
│   │  │  └─────────────────────────────────────────────────────┘    │   │
│   │  │                                                             │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   SIZES:                                                                │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  Small (sm):   max-width 400px   → Confirmations, alerts       │   │
│   │  Medium (md):  max-width 560px   → Forms, standard dialogs     │   │
│   │  Large (lg):   max-width 720px   → Detail views, complex forms │   │
│   │  XL:          max-width 900px   → Session review, reports     │   │
│   │  Fullscreen:  95vw x 95vh       → Mobile, immersive content   │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   MODAL VARIANTS:                                                       │
│   ═══════════════                                                       │
│                                                                         │
│   ┌────────────────────────────────────────┐                           │
│   │  ⚠️ WARNING MODAL (Student receives)  │                           │
│   │                                        │                           │
│   │         ⚠️ (large amber icon)          │                           │
│   │                                        │                           │
│   │  Attention: Tab Switch Detected        │                           │
│   │                                        │                           │
│   │  You have attempted to switch browser  │                           │
│   │  tabs. This is your 2nd warning.       │                           │
│   │  Continued violations may result in    │                           │
│   │  exam suspension.                      │                           │
│   │                                        │                           │
│   │  ┌──────────────────────────────┐      │                           │
│   │  │      I Understand            │      │  ← Single CTA, prominent  │
│   │  └──────────────────────────────┘      │                           │
│   │                                        │                           │
│   │  Auto-dismiss in: 30 seconds           │  ← Countdown timer        │
│   └────────────────────────────────────────┘                           │
│                                                                         │
│   ┌────────────────────────────────────────┐                           │
│   │  🔴 CONFIRMATION MODAL (Proctor uses) │                           │
│   │                                        │                           │
│   │  Terminate Session?                   │                           │
│   │                                        │                           │
│   │  Are you sure you want to terminate    │                           │
│   │  John Doe's exam session?              │                           │
│   │                                        │                           │
│   │  Student: John Doe (STU-0042)          │                           │
│   │  Reason: [____________________]        │                           │
│   │                                        │                           │
│   │  This action cannot be undone.         │                           │
│   │                                        │                           │
│   │  [Cancel]        [Terminate Session]   │  ← Danger button          │
│   └────────────────────────────────────────┘                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.7 Alerts / Toast Notifications

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     ALERTS & TOAST NOTIFICATIONS                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   INLINE ALERT (in-page):                                               │
│   ═══════════════════                                                   │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │  ℹ️  Information: Your exam session will begin at 09:00 AM.     │  │
│   │  [Dismiss ✕]                                                    │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│   (blue-50 bg, blue-700 text, blue-500 left border 4px)                │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │  ⚠️  Warning: Multiple tab switch attempts detected.             │  │
│   │  [Dismiss ✕]                                                    │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│   (amber-50 bg, amber-700 text, amber-500 left border 4px)              │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │  ❌  Error: Unable to connect to server. Retrying...             │  │
│   │  [Retry] [Dismiss ✕]                                            │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│   (red-50 bg, red-700 text, red-500 left border 4px)                    │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │  ✅  Success: Exam submitted successfully. Session ID: XXXX.    │  │
│   │  [Dismiss ✕]                                                    │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│   (green-50 bg, green-700 text, green-500 left border 4px)              │
│                                                                         │
│   TOAST NOTIFICATION (floating):                                        │
│   ═══════════════════════════                                          │
│                                                                         │
│                    ┌──────────────────────────────────┐                  │
│                    │ ✅  Warning sent to John Doe     │                  │
│                    └──────────────────────────────────┘                  │
│                              ↑ appears top-right, auto-dismisses 3s     │
│                                                                         │
│   Position options: top-right (default), top-center, bottom-right       │
│   Animation: slide-in from right + fade, slide-out on dismiss          │
│   Duration: 3s (info/success), 5s (warning), persistent (error)       │
│   Stacking: multiple toasts stack vertically                            │
│                                                                         │
│   PROCTOR ALERT BANNER (persistent until acknowledged):                 │
│   ═══════════════════════════════════════════════════                  │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │  🔴 CRITICAL: Screen capture attempt by Jane Smith (STU-0017)   │  │
│   │  [View Session] [Acknowledge]                                    │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│   Appears at top of dashboard, pulses red border, requires action      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.8 Navigation Components

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       NAVIGATION COMPONENTS                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   SIDEBAR NAVIGATION (Admin):                                           │
│   ═════════════════════════                                             │
│                                                                         │
│   ┌──────────────────┐                                                  │
│   │  🎓 IELTS Proctor │  ← Logo area (h: 64px)                        │
│   │  ──────────────── │                                                  │
│   │                  │                                                  │
│   │  📊 Dashboard    │  ← Active: blue-50 bg + blue-600 text + left bar│
│   │  📋 Sessions     │                                                  │
│   │  👥 Students     │                                                  │
│   │  ⚙️  Rules       │                                                  │
│   │  📈 Reports      │                                                  │
│   │  🔧 Settings     │                                                  │
│   │                  │                                                  │
│   │  ──────────────── │                                                  │
│   │  🚪 Logout       │                                                  │
│   └──────────────────┘                                                  │
│                                                                         │
│   Width: 240px; Item height: 44px; Icon (20px) + Label (sm);           │
│   Hover: gray-100 bg; Active: blue-50 bg, blue-600, left accent bar    │
│                                                                         │
│   TAB NAVIGATION:                                                       │
│   ════════════════                                                      │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  ┌─────────┬──────────┬─────────┬──────────┬─────────┐          │   │
│   │  │ All     │ Active   │ Paused  │ Terminated│ Flagged │          │   │
│   │  └─────────┴──────────┴─────────┴──────────┴─────────┘          │   │
│   │  ───────────────────────────────── blue-500 ─────────────────    │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   Active tab: blue-600 text, blue-500 bottom border (2px)              │
│   Inactive: gray-500 text, transparent border, hover: gray-700         │
│                                                                         │
│   BREADCRUMBS:                                                         │
│   ═════════════                                                         │
│   Dashboard / Sessions / STU-0042-John-Doe                             │
│                                                                         │
│   Font: sm, gray-500; Current page: gray-900; Separator: "/"           │
│   Links on ancestor pages                                              │
│                                                                         │
│   PAGINATION:                                                          │
│   ════════════                                                          │
│   <  1  2  3  4  5  ...  20  >                                         │
│                                                                         │
│   Active: blue-600 bg, white text, radius-md                           │
│   Inactive: white bg, gray-600 text, gray-200 border, hover: gray-50  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.9 Empty States & Loading States

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   EMPTY STATES & LOADING STATES                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   EMPTY STATE (No Data):                                                │
│   ═════════════════════                                                 │
│                                                                         │
│            ┌──────────────────────┐                                     │
│            │                      │                                     │
│            │    📭 (illustration)  │  ← 80px illustration/icon          │
│            │                      │                                     │
│            │  No sessions found   │                                     │
│            │                      │                                     │
│            │  There are no exam   │                                     │
│            │  sessions matching   │                                     │
│            │  your criteria.      │                                     │
│            │                      │                                     │
│            │  [Create Session]    │  ← Primary CTA                     │
│            │                      │                                     │
│            └──────────────────────┘                                     │
│                                                                         │
│   EMPTY STATE (Search No Results):                                      │
│   ════════════════════════════════                                     │
│                                                                         │
│            🔍 No results found for "xyz"                                │
│            Try adjusting your search or filter terms.                   │
│            [Clear Search]                                               │
│                                                                         │
│   LOADING SKELETON:                                                     │
│   ═════════════════                                                     │
│                                                                         │
│   Student Grid Loading:                                                 │
│   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐              │
│   │▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒│              │
│   │▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒│              │
│   │▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒│              │
│   └────────┘ └────────┘ └────────┘ └────────┘ └────────┘              │
│                                                                         │
│   Skeleton animation: shimmer/pulse effect (gray-200 ↔ gray-100)       │
│   Duration: 1.5s infinite                                             │
│                                                                         │
│   SPINNER:                                                              │
│   ════════                                                              │
│                                                                         │
│            ⟨ loading spinner ⟩  ← SVG/CSS spinner, blue-500, 32px     │
│                                                                         │
│            Loading sessions...  ← Text below, gray-500                 │
│                                                                         │
│   PROGRESS BAR:                                                         │
│   ═════════════                                                         │
│                                                                         │
│   Pre-check progress:                                                   │
│   Running system checks...  ████████░░░░ 80%                            │
│                                                                         │
│   Bar height: 8px, radius-full, blue-500 fill, gray-200 track          │
│   Animated fill transition                                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Icon System

### 7.1 Icon Library Choice

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ICON SYSTEM                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   RECOMMENDED: Lucide Icons (or Heroicons / Phosphor)                   │
│   ─────────────────────────────────────────────────                     │
│                                                                         │
│   Why Lucide?                                                           │
│   • Consistent stroke-based design (2px stroke weight)                  │
│   • 1400+ icons covering all needed use cases                           │
│   • Lightweight (SVG, tree-shakeable)                                   │
│   • Open source (MIT license)                                           │
│   • Customizable: stroke width, size, color via CSS                    │
│   • Active community and maintenance                                    │
│                                                                         │
│   ICON SPECS:                                                           │
│   • Grid: 24×24 viewBox                                                │
│   • Stroke width: 2 (default), 1.5 for smaller icons                    │
│   • Stroke linecap: round                                               │
│   • Stroke linejoin: round                                              │
│   • Sizes used: 16px (compact), 20px (standard), 24px (large)          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Icon Map by Feature Area

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      ICON ASSIGNMENT MAP                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ═══════════════════════════════════════════════════════════════════    │
│   GENERAL / NAVIGATION                                                  │
│   ═══════════════════════════════════════════════════════════════════    │
│                                                                         │
│   home/dashboard    →  LayoutDashboard    📊                             │
│   settings          →  Settings            ⚙️                             │
│   search            →  Search               🔍                             │
│   user/profile      →  User                👤                             │
│   users/group       →  Users                👥                             │
│   logout            →  LogOut               🚪                             │
│   menu/hamburger    →  Menu                 ☰                             │
│   close             →  X                    ✕                             │
│   chevron-right     →  ChevronRight         ›                             │
│   chevron-down      →  ChevronDown          ⌄                             │
│   external-link     →  ExternalLink         ↗                             │
│   filter            →  Filter               ⚲                             │
│   more-options      →  MoreHorizontal       ⋯                             │
│                                                                         │
│   ═══════════════════════════════════════════════════════════════════    │
│   SESSION / EXAM                                                         │
│   ═══════════════════════════════════════════════════════════════════    │
│                                                                         │
│   exam/session      →  FileText             📄                             │
│   clock/timer       →  Clock                🕐                             │
│   calendar          →  Calendar             📅                             │
│   play/start        →  Play                 ▶                             │
│   pause             →  Pause                ⏸                             │
│   stop/terminate    →  Square               ⏹                             │
│   submit            →  Send                 📤                             │
│   section           →  Layers               📚                             │
│   question          ->  HelpCircle            ❓                             │
│   answer            ->  CheckCircle           ✓                             │
│                                                                         │
│   ═══════════════════════════════════════════════════════════════════    │
│   STATUS INDICATORS                                                     │
│   ═══════════════════════════════════════════════════════════════════    │
│                                                                         │
│   active/green      →  CheckCircle2          ✅                             │
│   warning/amber     →  AlertTriangle         ⚠️                             │
│   danger/red        →  AlertOctagon          ⛔                             │
│   paused/orange     →  PauseCircle           ⏸                             │
│   idle/gray         →  Moon                  🌙                             │
│   info/blue         →  Info                  ℹ️                             │
│   success           →  Check                ✔                              │
│   error             →  XCircle              ✖                              │
│                                                                         │
│   ═══════════════════════════════════════════════════════════════════    │
│   VIOLATIONS / SECURITY                                                 │
│   ═══════════════════════════════════════════════════════════════════    │
│                                                                         │
│   tab-switch        →  Square                (custom or use monitor)      │
│   copy              →  Copy                 📋                             │
│   paste             →  Clipboard             📋                             │
│   screen-capture    →  Camera               📷                             │
│   devtools          →  Code                  </>                            │
│   fullscreen        →  Maximize2             ⛶                             │
│   focus-loss        →  EyeOff                👁                             │
│   keyboard          →  Keyboard             ⌨                             │
│   mouse             →  MousePointer2         🖱                             │
│   shield/security   →  Shield               🛡                             │
│   lock              →  Lock                  🔒                             │
│   unlock            →  Unlock                🔓                             │
│   flag              →  Flag                  🚩                             │
│                                                                         │
│   ═══════════════════════════════════════════════════════════════════    │
│   ACTIONS                                                               │
│   ═══════════════════════════════════════════════════════════════════    │
│                                                                         │
│   warn              →  AlertTriangle         ⚠️                             │
│   pause-session     →  Pause                ⏸                             │
│   resume            →  Play                 ▶                             │
│   terminate         →  Square               ⏹                             │
│   add               →  Plus                 ➕                             │
│   edit              →  Pencil               ✏                             │
│   delete            →  Trash2               🗑                             │
│   download/export   →  Download             ⬇                             │
│   upload            →  Upload               ⬆                             │
│   refresh           →  RefreshCw            🔄                             │
│   expand            →  Expand               ⤢                             │
│   collapse          →  Shrink               ⤡                             │
│   note/comment      →  MessageSquare        💬                             │
│   help              →  LifeBuoy             🆘                             │
│   extend-time       →  Timer                ⏱                             │
│                                                                         │
│   ═══════════════════════════════════════════════════════════════════    │
│   REPORTING / ANALYTICS                                                 │
│   ═══════════════════════════════════════════════════════════════════    │
│                                                                         │
│   report            →  FileBarChart         📊                             │
│   chart/bar         →  BarChart3            📊                             │
│   chart/line        →  TrendingUp          📈                             │
│   chart/pie         →  PieChart             🥧                             │
│   timeline          →  GitBranch            ⏳                             │
│   history/log       →  History              📜                             │
│   print             →  Printer              🖨                             │
│   pdf               →  FileText             📄                             │
│   csv               →  Table                📋                             │
│   archive           →  Archive              📦                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Screen Specifications — Student Flow

### 8.1 Login Page

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: S-001 — STUDENT LOGIN PAGE                                     │
│  Route: /student/login                                                 │
│  Audience: Student taking IELTS exam                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                                 │    │
│  │                                                                 │    │
│  │                                                                 │    │
│  │                    ┌─────────────────────┐                       │    │
│  │                    │                     │                       │    │
│  │                    │   🎓  IELTS         │  ← Logo (48px)        │    │
│  │                    │   Online Exam       │                       │    │
│  │                    │                     │                       │    │
│  │                    └─────────────────────┘                       │    │
│  │                                                                 │    │
│  │              ┌───────────────────────────────┐                   │    │
│  │              │  Sign in to your exam account │                   │    │
│  │              └───────────────────────────────┘                   │    │
│  │                                                                 │    │
│  │              ┌─────────────────────────────┐                    │    │
│  │              │  📧 Email                   │                    │    │
│  │              │  ┌───────────────────────┐  │                    │    │
│  │              │  │ student@ielts.com     │  │                    │    │
│  │              │  └───────────────────────┘  │                    │    │
│  │              │                             │                    │    │
│  │              │  🔒 Password                │                    │    │
│  │              │  ┌───────────────────────┐  │                    │    │
│  │              │  │ •••••••••             │  │  [👁 Show]        │    │
│  │              │  └───────────────────────┘  │                    │    │
│  │              │                             │                    │    │
│  │              │  ☑ Remember me             │                    │    │
│  │              │                             │                    │    │
│  │              │  ┌─────────────────────┐   │                    │    │
│  │              │  │    Sign In    →    │   │  ← Primary btn, full │    │
│  │              │  └─────────────────────┘   │                     │    │
│  │              │                             │                    │    │
│  │              │  Forgot password?          │  ← Link, sm, blue   │    │
│  │              └─────────────────────────────┘                    │    │
│  │                                                                 │    │
│  │              ─────────────────────────────                       │    │
│  │              Having technical difficulties?                      │    │
│  │              Contact Support →                                   │    │
│  │                                                                 │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  LAYOUT: Centered card (max-width: 420px), centered vertically          │
│  BACKGROUND: Gray-50 with subtle gradient pattern                      │
│  CARD: White, shadow-lg, radius-2xl, p-8                               │
│  LOGO: Centered, mb-8                                                  │
│  TITLE: "Sign in to your exam account" (xl, semibold, center)         │
│  FORM: Vertical stack, input fields full-width                         │
│  BUTTON: Full-width, primary variant, lg size                          │
│  FOOTER LINKS: Centered, sm, gray-500                                  │
│                                                                         │
│  VALIDATION ERRORS:                                                    │
│  ┌─────────────────────────────┐                                       │
│  │ 📧 Email                      │  ← Red border, error msg below    │
│  │ ┌─────────────────────────┐  │                                       │
│  │ │ invalid@email            │  │                                       │
│  │ └─────────────────────────┘  │                                       │
│  │ ⚠ Please enter a valid email address.                              │
│  └─────────────────────────────┘                                       │
│                                                                         │
│  LOADING STATE: Button shows spinner, disabled, "Signing in..."        │
│                                                                         │
│  RESPONSIVE:                                                           │
│  • Mobile (< 640px): Card fills screen, reduced padding (p-6)          │
│  • Tablet+: As shown above                                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Pre-Exam System Check Page

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: S-002 — PRE-EXAM SYSTEM CHECK                                 │
│  Route: /student/exam/:id/check                                        │
│  Audience: Student before starting exam                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ┌───────────────────────────────────────────────────────────┐  │    │
│  │  │  ← Back          System Compatibility Check    Step 1/2  │  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │                                                         │   │    │
│  │  │   Before starting your exam, we need to verify your     │   │    │
│  │  │   system meets the requirements.                        │   │    │
│  │  │                                                         │   │    │
│  │  │   This process takes approximately 30 seconds.          │   │    │
│  │  │                                                         │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  SYSTEM CHECK RESULTS                                  │   │    │
│  │  │                                                         │   │    │
│  │  │  ┌───────────────────────────────────────────────────┐ │   │    │
│  │  │  │ ✅  Browser Compatibility                          │ │ │   │    │
│  │  │  │     Google Chrome 120.0.6099 (Supported)          │ │   │    │
│  │  │  └───────────────────────────────────────────────────┘ │   │    │
│  │  │                                                         │   │    │
│  │  │  ┌───────────────────────────────────────────────────┐ │   │    │
│  │  │  │ ✅  JavaScript                                     │ │ │   │    │
│  │  │  │     Enabled and working correctly                 │ │   │    │
│  │  │  └───────────────────────────────────────────────────┘ │   │    │
│  │  │                                                         │   │    │
│  │  │  ┌───────────────────────────────────────────────────┐ │   │    │
│  │  │  │ ✅  Cookies & Local Storage                       │ │ │   │    │
│  │  │  │     Available                                     │ │   │    │
│  │  │  └───────────────────────────────────────────────────┘ │   │    │
│  │  │                                                         │   │    │
│  │  │  ┌───────────────────────────────────────────────────┐ │   │    │
│  │  │  │ ✅  Fullscreen Mode                                │ │ │   │    │
│  │  │  │     Supported                                     │ │ │   │    │
│  │  │  └───────────────────────────────────────────────────┘ │   │    │
│  │  │                                                         │   │    │
│  │  │  ┌───────────────────────────────────────────────────┐ │   │    │
│  │  │  │ ✅  Screen Resolution                              │ │ │   │    │
│  │  │  │     1920 × 1080 (Recommended: 1024×768 minimum)   │ │   │    │
│  │  │  └───────────────────────────────────────────────────┘ │   │    │
│  │  │                                                         │   │    │
│  │  │  ┌───────────────────────────────────────────────────┐ │   │    │
│  │  │  │ ⚠️  Browser Extensions                            │ │ │   │    │
│  │  │  │     2 extensions detected (review recommended)    │ │ │   │    │
│  │  │  │     [View Extensions]                              │ │ │   │    │
│  │  │  └───────────────────────────────────────────────────┘ │   │    │
│  │  │                                                         │   │    │
│  │  │  ┌───────────────────────────────────────────────────┐ │   │    │
│  │  │  │ ✅  Monitors                                      │ │ │   │    │
│  │  │  │     1 monitor detected                             │ │ │   │    │
│  │  │  └───────────────────────────────────────────────────┘ │   │    │
│  │  │                                                         │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  Progress: ████████████████████░░░░  7/8 checks passed  │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────┐  ┌──────────┐ │   │
│  │  │  [Retry Checks]                              │  │[Continue]│ │   │
│  │  └─────────────────────────────────────────────┘  └──────────┘ │   │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  CHECK ITEM COMPONENT:                                                  │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  ✅ / ⚠️ / ❌  |  Check Name           |  Detail text        │      │
│  │  (status icon)  |  (lg, semibold)       |  (sm, gray-500)    │      │
│  └──────────────────────────────────────────────────────────────┘      │
│  • Pass: green icon, normal appearance                                │
│  • Warning: amber icon, amber bg tint, optional action link           │
│  • Fail: red icon, red bg tint, error message below, retry option     │
│  • Loading: Spinner animation instead of icon                         │
│                                                                         │
│  IN-PROGRESS STATE (checks running):                                   │
│  Each check shows spinner while running, then resolves to icon        │
│  Progress bar updates as each check completes                          │
│                                                                         │
│  FAILURE STATE:                                                         │
│  "Continue" button disabled when any critical check fails              │
│  Failed items show red styling with troubleshooting guidance           │
│  "Retry Checks" re-runs only failed items                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Exam Lobby / Ready Screen

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: S-003 — EXAM LOBBY / READY SCREEN                             │
│  Route: /student/exam/:id/lobby                                        │
│  Audience: Student waiting to start exam                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                                 │    │
│  │                    ┌─────────────────────┐                       │    │
│  │                    │                     │                       │    │
│  │                    │  ✅  All Systems Go │  ← Large success icon │    │
│  │                    │                     │    (64px, green)      │    │
│  │                    └─────────────────────┘                       │    │
│  │                                                                 │    │
│  │              ┌───────────────────────────────┐                   │    │
│  │              │  You're ready to begin!       │                   │    │
│  │              └───────────────────────────────┘                   │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  EXAM DETAILS                                          │   │    │
│  │  │                                                         │   │    │
│  │  │  ┌────────────────────┬──────────────────────────────┐ │   │    │
│  │  │  │ Exam               │ IELTS Academic Test          │ │   │    │
│  │  │  ├────────────────────┼──────────────────────────────┤ │   │    │
│  │  │  │ Date & Time        │ Sunday, 15 June 2025         │ │   │    │
│  │  │  │                    │ 09:00 AM - 11:45 AM (Local)  │ │   │    │
│  │  │  ├────────────────────┼──────────────────────────────┤ │   │    │
│  │  │  │ Duration           │ 2 hours 45 minutes           │ │   │    │
│  │  │  ├────────────────────┼──────────────────────────────┤ │   │    │
│  │  │  │ Sections           │ Listening, Reading, Writing  │ │   │    │
│  │  │  ├────────────────────┼──────────────────────────────┤ │   │    │
│  │  │  │ Candidate ID       │ IELTS-2025-0042             │ │   │    │
│  │  │  └────────────────────┴──────────────────────────────┘ │   │    │
│  │  │                                                         │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  ⚠️ IMPORTANT REMINDERS BEFORE YOU START               │   │    │
│  │  │                                                         │   │    │
│  │  │  • Ensure you are in a quiet, well-lit room            │   │    │
│  │  │  • Close all other applications and browser tabs       │   │    │
│  │  │  • Have your identification document nearby            │   │    │
│  │  │  • The exam runs in fullscreen mode                   │   │    │
│  │  │  • Once started, you cannot pause without proctor      │   │    │
│  │  │    authorization                                       │   │    │
│  │  │                                                         │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  ┌───────────────────────────────────────────────────┐ │   │    │
│  │  │  │  ▶  START MY EXAM                                 │ │   │    │
│  │  │  └───────────────────────────────────────────────────┘ │   │    │
│  │  │                                                         │   │    │
│  │  │  By clicking Start, you agree to the exam rules and    │   │    │
│  │  │  proctoring terms.                                     │   │    │
│  │  │                                                         │   │    │
│  │  │  [View Full Terms →]                                   │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  START BUTTON:                                                          │
│  • Large (lg size), primary variant, full-width in card                │
│  • Icon: Play (▶)                                                      │
│  • On click: triggers fullscreen request → transitions to exam        │
│  • Countdown tooltip if exam hasn't started yet: "Starts in XX:XX"    │
│                                                                         │
│  EXAM DETAILS TABLE:                                                    │
│  • Alternating row backgrounds (white / gray-50)                       │
│  • Labels: sm, medium, gray-500                                        │
│  • Values: base, semibold, gray-900                                   │
│  • Left column: 40% width, Right column: 60% width                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.4 Active Exam Interface (Main)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: S-004 — ACTIVE EXAM INTERFACE                                  │
│  Route: /student/exam/:id/take (FULLSCREEN LOCKED)                     │
│  Audience: Student actively taking exam                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  FULLSCREEN MODE — NO BROWSER CHROME VISIBLE                            │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  EXAM HEADER BAR  (fixed top, h: 56px, z-index: sticky)        │    │
│  │  ┌───────────────────────────────────────────────────────────┐ │    │
│  │  │  🟢 Connected    IELTS Academic    ⏱ 01:23:45    W: 45m  │ │    │
│  │  │  (status dot)     (exam name)      (timer)     (section) │ │    │
│  │  │                                                    [🆘]   │ │    │
│  │  └───────────────────────────────────────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                                 │    │
│  │                                                                 │    │
│  │                                                                 │    │
│  │                    ┌───────────────────────────┐                │    │
│  │                    │      EXAM CONTENT AREA    │                │    │
│  │                    │                           │                │    │
│  │                    │  (Renders actual IELTS     │                │    │
│  │  │   exam questions and answers) │                │    │
│  │                    │                           │                │    │
│  │                    │                           │                │    │
│  │                    │  Question 23 of 40         │                │    │
│  │                    │  ─────────────────────    │                │    │
│  │                    │                           │                │    │
│  │                    │  [Reading passage here...] │                │    │
│  │                    │                           │                │    │
│  │                    │                           │                │    │
│  │                    │  Answer: [____________]   │                │    │
│  │                    │                           │                │    │
│  │                    │  [← Previous]  [Next →]   │                │    │
│  │                    │                           │                │
│  │                    └───────────────────────────┘                │    │
│  │                                                                 │    │
│  │                                                                 │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  HEADER BAR DETAILS:                                                    │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  LEFT SECTION:                                                    │   │
│  │  • Connection Status: Animated dot (green=pulse, red=static)     │   │
│  │    Text: "Connected" / "Reconnecting..." / "Disconnected"       │   │
│  │  • Exam Name: Sm, medium, gray-700                               │   │
│  │                                                                    │   │
│  │  CENTER SECTION:                                                  │   │
│  │  • Timer: Mono font (JetBrains Mono), xl (20px), bold            │   │
│  │    Color: Normal = gray-900, < 10min = amber-600, < 5min = red   │   │
│  │    Format: HH:MM:SS                                              │   │
│  │                                                                    │   │
│  │  RIGHT SECTION:                                                   │   │
│  │  • Current Section: Badge showing "L" / "R" / "W"                │   │
│  │    (Listening / Reading / Writing)                               │   │
│  │  • Help Button: Circle button, icon only (LifeBuoy)             │   │
│  │    Opens help request modal                                      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  CONTENT AREA:                                                         │
│  • Max-width: 900px, centered horizontally                           │
│  • Padding: space-8 (32px)                                            │
│  • Background: white (or very light gray-50)                          │
│  • Question navigation at bottom of content                          │
│  • All text rendered at base (16px) minimum for readability          │
│                                                                         │
│  TIMER BEHAVIOR:                                                       │
│  • Last 10 minutes: timer turns amber, subtle pulse animation         │
│  • Last 5 minutes: timer turns red, faster pulse                      │
│  • Time up: auto-submit confirmation dialog                           │
│                                                                         │
│  HELP BUTTON MODAL:                                                    │
│  ┌────────────────────────────────────────┐                           │
│  │  Request Assistance                    │                           │
│  │                                        │                           │
│  │  What do you need help with?           │                           │
│  │                                        │                           │
│  │  ○ Technical Issue                    │                           │
│  │  ○ Bathroom Break                      │                           │
│  │  ○ Other (emergency)                   │                           │
│  │                                        │                           │
│  │  [Send Request]  [Cancel]              │                           │
│  └────────────────────────────────────────┘                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.5 Warning Modal (During Exam)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: S-005 — VIOLATION WARNING MODAL (OVERLAY)                     │
│  Trigger: Rule engine detects violation (medium severity+)             │
│  Blocks exam interaction until acknowledged                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  OVERLAY: Black/60 backdrop, blur backdrop-blur-sm                     │
│  Dismiss: NOT allowed by clicking outside or pressing ESC              │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                                 │    │
│  │                                                                 │    │
│  │              ⚠️                                                  │    │
│  │         (large amber warning icon, 48px)                         │    │
│  │                                                                 │    │
│  │              ATTENTION                                          │    │
│  │         (xl, semibold, gray-900, center)                        │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │                                                         │   │    │
│  │  │  You have attempted to switch browser tabs. This is     │   │    │
│  │  │  not permitted during the examination.                   │   │    │
│  │  │                                                         │   │    │
│  │  │  This is your warning #2 of 3 before further action     │   │    │
│  │  │  is taken.                                              │   │    │
│  │  │                                                         │   │    │
│  │  │  Please remain focused on your exam and avoid any      │   │    │
│  │  │  prohibited actions.                                    │   │    │
│  │  │                                                         │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  Rule: TAB_SWITCH_MEDIUM                                │   │    │
│  │  │  Severity: Medium ⚠️                                    │   │    │
│  │  │  Time: 14:32:05                                         │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │  (collapsed details, sm, gray-500, mono for time)              │    │
│  │                                                                 │    │
│  │              ┌─────────────────────────────────┐             │    │
│  │              │     I UNDERSTAND               │             │    │
│  │              └─────────────────────────────────┘             │    │
│  │                                                                 │    │
│  │              This modal will auto-dismiss in: 30 seconds      │    │
│  │              (countdown timer, amber, sm)                      │    │
│  │                                                                 │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  SEVERITY VARIATIONS:                                                   │
│                                                                         │
│  MEDIUM (shown above):                                                  │
│  • Icon: ⚠️ AlertTriangle (amber, 48px)                               │
│  • Title: "ATTENTION"                                                  │
│  • Border accent: amber-500 (4px left)                                 │
│  • Button: "I UNDERSTAND" (primary)                                    │
│  • Auto-dismiss: 30 seconds countdown                                 │
│                                                                         │
│  HIGH:                                                                  │
│  • Icon: 🔴 AlertOctagon (red, 48px) with pulse animation              │
│  • Title: "⚠️ WARNING — FINAL NOTICE"                                 │
│  • Border accent: red-500 (4px left) + red glow shadow                 │
│  • Additional text: "Next violation may result in exam pause"         │
│  • Button: "I UNDERSTAND" (warning/amber bg)                          │
│  • Auto-dismiss: 15 seconds (shorter — more urgent)                   │
│  • Background: subtle red tint (red-50)                               │
│                                                                         │
│  CRITICAL (if auto-pause triggered):                                   │
│  • Icon: ⛔ Shield-off (dark red, 56px)                               │
│  • Title: "EXAM PAUSED"                                               │
│  • Main message: "Your exam has been temporarily paused..."           │
│  • No acknowledge button needed                                       │
│  • Shows: "Waiting for proctor to resume..." with spinner             │
│  • Timer frozen visibly                                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.6 Exam Completion Screen

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: S-006 — EXAM COMPLETION / SUBMIT CONFIRMATION                 │
│  Trigger: Student clicks Submit or time expires                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                                 │    │
│  │                    ┌─────────────────────┐                       │    │
│  │                    │                     │                       │    │
│  │                    │  📤  (submit icon)  │  ← 56px, blue-500     │    │
│  │                    │                     │                       │    │
│  │                    └─────────────────────┘                       │    │
│  │                                                                 │    │
│  │              ┌───────────────────────────────┐                   │    │
│  │              │  Confirm Exam Submission     │                   │    │
│  │              └───────────────────────────────┘                   │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │                                                         │   │    │
│  │  │  Are you sure you want to submit your exam?             │   │    │
│  │  │                                                         │   │    │
│  │  │  Please review the following before confirming:         │   │    │
│  │  │                                                         │   │    │
│  │  │  ┌─────────────────────────────────────────────────┐   │   │    │
│  │  │  │ Questions Answered:     38 of 40                 │   │   │    │
│  │  │  │ Unanswered:            2                         │   │   │    │
│  │  │  │ Time Remaining:        12:34                     │   │   │    │
│  │  │  │ Section:               Writing                   │   │   │    │
│  │  │  └─────────────────────────────────────────────────┘   │   │    │
│  │  │                                                         │   │    │
│  │  │  ⚠ Once submitted, you cannot return to your exam.    │   │    │
│  │  │                                                         │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  ┌──────────────────────┐  ┌──────────────────────────────┐   │    │
│  │  │  ← Back to Exam       │  │  ✅  Confirm Submission      │   │    │
│  │  │  (secondary/ghost)    │  │  (primary, emphasized)      │   │    │
│  │  └──────────────────────┘  └──────────────────────────────┘   │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  AFTER SUBMISSION (SUCCESS):                                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                                 │    │
│  │                    ┌─────────────────────┐                       │    │
│  │                    │  ✅ (check circle)   │  ← 64px, green-500   │    │
│  │                    └─────────────────────┘                       │    │
│  │                                                                 │    │
│  │              ┌───────────────────────────────┐                   │    │
│  │              │  Exam Submitted Successfully! │                   │    │
│  │              └───────────────────────────────┘                   │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │                                                         │   │    │
│  │  │  Thank you for completing your IELTS examination.       │   │    │
│  │  │                                                         │   │    │
│  │  │  Your session has been recorded. You may now close      │   │    │
│  │  │  this window safely.                                   │   │    │
│  │  │                                                         │   │    │
│  │  │  ┌─────────────────────────────────────────────────┐   │   │    │
│  │  │  │  Session Reference: IELTS-2025-0042-A7F3        │   │   │    │
│  │  │  │  Submitted At: 15 Jun 2025, 11:42:17 AM        │   │   │    │
│  │  │  └─────────────────────────────────────────────────┘   │   │    │
│  │  │                                                         │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │              ┌─────────────────────────────────┐               │    │
│  │              │  🚪 Close Window / Exit Exam    │  ← Only action │    │
│  │              └─────────────────────────────────┘               │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  Note: After submission, fullscreen lock releases, browser returns     │
│  to normal mode. Student can close tab/window freely.                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Screen Specifications — Proctor Dashboard

### 9.1 Exam Selection / Dashboard Home

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: P-001 — PROCTOR LOGIN / EXAM SELECTION                        │
│  Route: /proctor                                                      │
│  Audience: Proctor/Admin starting monitoring shift                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ┌───────────────────────────────────────────────────────────┐  │    │
│  │  │  🎓 IELTS Proctor Dashboard     Welcome, Sarah K.  [Logout]│  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  Select Exam Session to Monitor                         │   │    │
│  │  │  (xl, semibold)                                         │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  🔍 Search exams... [Filter ▼]  [Date Range ▼]         │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────────┐│   │
│  │  │  TODAY'S EXAMS (June 15, 2025)                             ││   │
│  │  ├─────────────────────────────────────────────────────────────┤│   │
│  │  │                                                             ││   │
│  │  │  ┌─────────────────────────────────────────────────────┐   ││   │
│  │  │  │  🟢  IELTS Academic - Morning Session               │   ││   │
│  │  │  │                                                     │   ││   │
│  │  │  │  09:00 AM - 11:45 AM  |  85 students enrolled      │   ││   │
│  │  │  │  Status: IN PROGRESS    |  Started 45 min ago       │   ││   │
│  │  │  │                                                     │   ││   │
│  │  │  │  [Monitor Dashboard →]                              │   ││   │
│  │  │  └─────────────────────────────────────────────────────┘   ││   │
│  │  │                                                             ││   │
│  │  │  ┌─────────────────────────────────────────────────────┐   ││   │
│  │  │  │  ⏳  IELTS General - Afternoon Session              │   ││   │
│  │  │  │                                                     │   ││   │
│  │  │  │  02:00 PM - 04:45 PM  |  62 students enrolled      │   ││   │
│  │  │  │  Status: SCHEDULED     |  Starts in 3h 15min       │   ││   │
│  │  │  │                                                     │   ││   │
│  │  │  │  [View Details →]                                   │   ││   │
│  │  │  └─────────────────────────────────────────────────────┘   ││   │
│  │  │                                                             ││   │
│  │  │  ┌─────────────────────────────────────────────────────┐   ││   │
│  │  │  │  ✅  IELTS Academic - Make-up Exam (Completed)       │   ││   │
│  │  │  │                                                     │   ││   │
│  │  │  │  10:00 AM - 12:45 PM  |  3 students                │   ││   │
│  │  │  │  Status: COMPLETED    |  Ended 2h ago              │   ││   │
│  │  │  │                                                     │   ││   │
│  │  │  │  [Review Results →]                                │   ││   │
│  │  │  └─────────────────────────────────────────────────────┘   ││   │
│  │  │                                                             ││   │
│  │  └─────────────────────────────────────────────────────────────┘│   │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────────┐│   │
│  │  │  RECENT ACTIVITY                                          ││   │
│  │  │  ┌───────────────────────────────────────────────────────┐││   │
│  │  │  │ 14:32  🔴 Screen capture attempted - J. Smith (S-17) │││   │
│  │  │  │ 14:28  🟠 Tab switch warning escalated - A. Ahmed   │││   │
│  │  │  │ 14:15  🟡 Idle timeout - M. Garcia (paused)         │││   │
│  │  │  │ 14:00  ✅ Session completed - T. Brown               │││   │
│  │  │  └───────────────────────────────────────────────────────┘││   │
│  │  └─────────────────────────────────────────────────────────────┘│   │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  EXAM CARD COMPONENT:                                                  │
│  • White card, shadow-sm, radius-lg, p-6                               │
│  • Left border accent: 4px (green=active, gray=scheduled, blue=done)   │
│  • Status badge in header area                                         │
│  • CTA button: primary for active, secondary for others               │
│  • Hover: shadow-md elevation                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Live Monitoring Dashboard (Main)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: P-002 — LIVE MONITORING DASHBOARD                             │
│  Route: /proctor/exam/:id/dashboard                                    │
│  Target Resolution: 1920×1080 minimum                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ═════════════════════════════════════════════════════════════  │    │
│  │  HEADER BAR (h: 60px, fixed, blue-900 bg, white text)           │    │
│  │  ═════════════════════════════════════════════════════════════  │    │
│  │  ┌───────────────────────────────────────────────────────────┐  │    │
│  │  │ ← Back   IELTS Academic - 15 Jun 2025    🟢 LIVE    [⚙] │  │    │
│  │  │          94/100 Active    Elapsed: 47m                 │  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ═════════════════════════════════════════════════════════════  │    │
│  │  STATISTICS BAR (h: 88px, gray-50 bg)                         │    │
│  │  ═════════════════════════════════════════════════════════════  │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐│    │
│  │  │  🟢      │ │  🟡      │ │  🟠      │ │  🔴      │ │ ⚠️    ││    │
│  │  │          │ │          │ │          │ │          │ │       ││    │
│  │  │   94     │ │   3      │ │   2      │ │   1      │ │  12   ││    │
│  │  │  Active  │ │  Warned  │ │  Paused  │ │ Termin.  │ │Alerts ││    │
│  │  │  +5 ↑    │ │  -1 ↓    │ │   same   │ │  +1 ↑    │ │ +2 ↑  ││    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └───────┘│    │
│  └─────────────────────────────────────────────────────────────────┘    │
│  ┌───────────────────────────────────────────┬─────────────────────────┐  │
│  │  ALERT PANEL (w: 340px, scrollable)      │  STUDENT GRID AREA      │  │
│  │  ══════════════════════════════════════  │  ═════════════════════  │  │
│  │  ┌───────────────────────────────────┐  │                         │  │
│  │  │  🔔 ALERT FEED        [Clear All] │  │  View: [Grid ▼][List ▼] │  │
│  │  │  Filter: [▼All] [🔴Crit] [🟠High]│  │  Sort:  [Violations ▼]   │  │
│  │  ├───────────────────────────────────┤  │  Search: [___________]   │  │
│  │  │                                   │  │  ┌────┐┌────┐┌────┐┌────┐│  │
│  │  │  🔴 14:32:05                    │  │  │ 🟢 ││ 🟡 ││ 🟢 ││ 🟢 ││  │
│  │  │  Screen capture by J.Smith       │  │  │JD  ││JS  ││AA  ││MG  ││  │
│  │  │  (STU-0017)  [View→] [Ack]       │  │  │0v  ││2w  ││0v  ││0v  ││  │
│  │  │                                   │  │  ├────┤├────┤├────┤├────┤│  │
│  │  │  🟠 14:31:58                    │  │  │ 🟢 ││ 🔴 ││ 🟢 ││ 🟢 ││  │
│  │  │  Tab switch #3 - A.Ahmed         │  │  │CW  │||SK  ||TB  ||HL  ││  │
│  │  │  (STU-0023)  [View→]             │  │  │0v  │||T   ||0v  ||0v  ││  │
│  │  │                                   │  │  ├────┤├────┤├────┤├────┤│  │
│  │  │  🟡 14:31:45                    │  │  │ 🟢 ││ 🟠 ││ 🟢 ││ 🟡 ││  │
│  │  │  Idle 5min - M.Garcia (paused)   │  │  │RK  │||JL  ||PW  ||NK  ││  │
│  │  │  (STU-0031)  [View→]             │  │  │0v  │||P   ||0v  ||1w  ││  │
│  │  │                                   │  │  ├────┤├────┤├────┤├────┤│  │
│  │  │  🟡 14:31:30                    │  │  │ 🟢 ││ 🟢 ││ 🟢 ││ 🟢 ││  │
│  │  │  Copy attempt - M.Garcia          │  │  │AS  │||DZ  ||EF  ||GH  ││  │
│  │  │  (STU-0031)  [View→]             │  │  │0v  |||0v  ||0v  ||0v  ││  │
│  │  │                                   │  │  ... (up to 100 cards)    │  │
│  │  │  🟡 14:31:15                    │  │                         │  │
│  │  │  Focus loss - T.Brown             │  │                         │  │
│  │  │  (STU-0008)  [View→]             │  │                         │  │
│  │  │                                   │  │                         │  │
│  │  │  ...scrollable...                │  │                         │  │
│  │  └───────────────────────────────────┘  │                         │  │
│  │                                         │                         │  │
│  └───────────────────────────────────────────┴─────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │  STUDENT DETAIL PANEL (collapsible, h: 320px default, slides up)   │  │
│  │  ┌─────────────────────────────────────────────────────────────┐   │  │
│  │  │  John Doe (STU-0042)  ✕ Close                    [⚠][⏸][✕]│   │  │
│  │  ├─────────────────────────────────────────────────────────────┤   │  │
│  │  │  STATUS        │  SECTION    │  TIMER    │  VIOLATIONS      │   │  │
│  │  │  🟡 Warned     │  Writing    │  45:23    │  2 warn, 0 crit  │   │  │
│  │  ├─────────────────────────────────────────────────────────────┤   │  │
│  │  │  RECENT ACTIVITY (last 20 events)                           │   │  │
│  │  │  14:32:05  Mouse click (512, 340)                           │   │  │
│  │  │  14:32:01  Key pressed: 'a'                                 │   │  │
│  │  │  14:31:58  Scroll down 3px                                  │   │  │
│  │  │  14:31:55  ⚠ Tab switch attempt (warn #2)                   │   │  │
│  │  │  14:31:50  Key pressed: 't'                                 │   │  │
│  │  │  14:31:45  ⚠ Copy attempt blocked                          │   │  │
│  │  │  ...                                                          │   │  │
│  │  ├─────────────────────────────────────────────────────────────┤   │  │
│  │  │  QUICK ACTIONS:                                            │   │  │
│  │  │  [⚠ Warn] [⏸ Pause] [▶ Resume] [✕ Terminate] [📝 Note]   │   │  │
│  │  └─────────────────────────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  STUDENT CARD GRID DETAILS:                                             │
│  ┌────────────────────────────────────────┐                             │
│  │  ┌──────────────────────────────────┐  │  ← Top border: 3px status  │
│  │  │  🟡  (status dot, top-left)     │  │     color                    │
│  │  │                                 │  │                             │
│  │  │  ┌────┐                         │  │                             │
│  │  │  │ JD │  Avatar circle (40px)  │  │                             │
│  │  │  └────┘  Initials, random       │  │                             │
│  │  │      color based on student ID  │  │                             │
│  │  │                                 │  │                             │
│  │  │  John Doe                      │  │  ← name (sm, semibold)      │
│  │  │  STU-0042                      │  │  ← ID (xs, mono, gray)     │
│  │  │                                 │  │                             │
│  │  │  Writing    ⏱ 45:23           │  │  ← section + timer          │
│  │  │  ─────────────────────         │  │  ← divider                  │
│  │  │  ⚠️ 2 warnings                │  │  ← violation count          │
│  │  └──────────────────────────────────┘  │                             │
│  │                                     │                             │
│  │  Card: w-min 200px, p-3, radius-lg  │                             │
│  │

# 🎨 IELTS Proctoring System — UI/UX Design Specification Document (Continued)

---

## 9. Screen Specifications — Proctor Dashboard (Continued)

### 9.3 Student Detail Panel (Expanded View)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: P-003 — STUDENT DETAIL PANEL (EXPANDED)                       │
│  Trigger: Click on student card in grid                                 │
│  Location: Bottom slide-up panel, overlays grid bottom portion          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  PANEL: Height 400px (expandable to 60vh), slides up from bottom       │
│  Background: white, shadow-xl, border-top: 3px blue-500               │
│  Z-index: overlay (300)                                                │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ┌───────────────────────────────────────────────────────────┐  │    │
│  │  │  👤 John Doe                           ✕ Close  [⏵ Full]│  │    │
│  │  │  STU-0042 | john.doe@email.com                          │  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  │                                                                 │    │
│  │  ┌────────────┐ ┌──────────────┐ ┌────────────┐ ┌───────────┐  │    │
│  │  │  STATUS    │ │  SECTION     │ │  TIMER     │ │ VIOLATIONS│  │    │
│  │  │            │ │              │ │            │ │           │  │    │
│  │  │  🟡 Warned │ │  Writing     │ │  ⏱ 45:23  │ │   5 total │  │    │
│  │  │  since 14:31│ │ Q28/40      │ │  -12:34 left│ │ 2 Med 1 Hi│  │    │
│  │  └────────────┘ └──────────────┘ └────────────┘ └───────────┘  │    │
│  │                                                                 │    │
│  │  ═════════════════════════════════════════════════════════════  │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────┬─────────────────────────────┐  │    │
│  │  │  ACTIVITY TIMELINE          │  VIOLATION BREAKDOWN        │  │    │
│  │  │                             │                             │  │    │
│  │  │  14:32:05  → Mouse click    │  ┌─────────────────────┐   │  │    │
│  │  │            (512, 340)       │  │ Tab Switch      ████ │   │  │    │
│  │  │  14:32:01  ↓ Key 'a'       │  │ Copy Attempt    ██   │   │  │    │
│  │  │  14:31:58  ↓ Scroll -3px    │  │ Focus Loss     █    │   │  │    │
│  │  │  14:31:55  ⚠ Tab switch    │  │ Idle           █    │   │  │    │
│  │  │            (Warning #2)     │  │                     │   │  │    │
│  │  │  14:31:50  ↓ Key 't'       │  │  Total: 5 events     │   │  │    │
│  │  │  14:31:45  ⚠ Copy attempt  │  └─────────────────────┘   │  │    │
│  │  │  14:31:30  ↓ Mouse click    │                             │  │    │
│  │  │  14:31:22  ↓ Key 'shift'    │  SEVERITY DISTRIBUTION:    │  │    │
│  │  │  14:31:15  ↓ Answer sel. Q27│  🔵 Low: 1                 │  │    │
│  │  │  14:30:58  ↓ Scroll +20px   │  🟡 Medium: 3              │  │    │
│  │  │  14:30:44  ⚠ Tab switch    │  🟠 High: 1                │  │    │
│  │  │            (Warning #1)     │  🔴 Critical: 0            │  │    │
│  │  │  ...                        │                             │  │    │
│  │  │                             │                             │  │    │
│  │  │  [Show All Events →]        │                             │  │    │
│  │  └─────────────────────────────┴─────────────────────────────┘  │    │
│  │                                                                 │    │
│  │  ═════════════════════════════════════════════════════════════  │    │
│  │  QUICK ACTION BAR:                                               │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐ │    │
│  │  │  ⚠ Warn  │ │  ⏸ Pause │ │  ▶ Resume│ │  ✕ Term. │ │📝Note│ │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────┘ │    │
│  │  ┌──────────┐ ┌──────────┐                                          │    │
│  │  │  ⏰ Extend│ │  🚩 Flag │                                          │    │
│  │  └──────────┘ └──────────┘                                          │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  TAB LAYOUT ALTERNATIVE (if panel width allows):                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  [Timeline]  [Violations]  [Session Info]  [Admin Actions]      │    │
│  │  ═════════════════════════════════════════════════════════════  │    │
│  │  (tab content area)                                             │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ACTION BUTTON SPECIFICATIONS:                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Button      │ Icon    │ Variant   │ Size │ Confirm?             │   │
│  ├─────────────┼─────────┼───────────┼──────┼──────────────────────┤   │
│  │ Warn        │ ⚠️      │ Warning   │ sm   │ No (template modal) │   │
│  │ Pause       │ ⏸       │ Amber     │ sm   │ Yes (reason)       │   │
│  │ Resume      │ ▶       │ Success   │ sm   │ No                  │   │
│  │ Terminate   │ ✕       │ Danger    │ sm   │ Yes (full confirm) │   │
│  │ Note        │ 📝       │ Ghost     │ sm   │ No (note modal)    │   │
│  │ Extend Time │ ⏰       │ Primary   │ sm   │ Yes (minutes)      │   │
│  │ Flag        │ 🚩       │ Outline   │ sm   │ Yes (flag type)    │   │
│  └─────────────┴─────────┴───────────┴──────┴──────────────────────┘   │
│                                                                         │
│  FULL SCREEN MODE:                                                      │
│  • "⏵ Full" button expands panel to cover entire viewport              │
│  • Shows full event timeline, charts, all session data                 │
│  • Useful for deep-dive investigation of suspicious sessions           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 9.4 Send Warning Modal (Proctor Action)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: P-004 — SEND WARNING MODAL                                    │
│  Trigger: Proctor clicks "Warn" button on student detail                │
│  Purpose: Compose and send warning message to student                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                            ▽     │    │
│  │  ┌──────────────────────────────────────────────────────┐   │    │    │
│  │  │  Send Warning to Student                            │   │    │    │
│  │  │                                              [✕ Close]│   │    │    │
│  │  ├──────────────────────────────────────────────────────┤   │    │    │
│  │  │                                                      │   │    │    │
│  │  │  Target: John Doe (STU-0042)                        │   │    │    │
│  │  │  Current Warnings: 2                                │   │    │    │
│  │  │                                                      │   │    │    │
│  │  │  ┌────────────────────────────────────────────────┐ │   │    │    │
│  │  │  │  Select Warning Template (optional):          │ │   │    │    │
│  │  │  │  ┌──────────────────────────────────────────┐ │ │   │    │    │
│  │  │  │  │ ▼ General Warning                        │ │ │   │    │    │
│  │  │  │  │   ┌────────────────────────────────────┐ │ │ │   │    │    │
│  │  │  │  │   │ Please focus on your exam. Avoid  │ │ │ │   │    │    │
│  │  │  │  │   │ any actions that may be flagged   │ │ │ │   │    │    │
│  │  │  │  │   │ as suspicious behavior.           │ │ │ │   │    │    │
│  │  │  │  │  └────────────────────────────────────┘ │ │ │   │    │    │
│  │  │  │  │                                        │ │ │   │    │    │
│  │  │  │  │ ○ Tab Switch Warning                    │ │ │   │    │    │
│  │  │  │  │   Stop switching browser tabs...         │ │ │   │    │    │
│  │  │  │  │                                        │ │ │   │    │    │
│  │  │  │  │ ○ Final Warning                         │ │ │   │    │    │
│  │  │  │  │   This is your final notice before...    │ │ │   │    │    │
│  │  │  │  │                                        │ │ │   │    │    │
│  │  │  │  │ ○ Custom Message                        │ │ │   │    │    │
│  │  │  │  └──────────────────────────────────────────┘ │ │   │    │    │
│  │  │  └────────────────────────────────────────────────┘ │   │    │    │
│  │  │                                                      │   │    │    │
│  │  │  ┌────────────────────────────────────────────────┐ │   │    │    │
│  │  │  │  Or write custom message:                      │ │   │    │    │
│  │  │  │  ┌──────────────────────────────────────────┐ │ │   │    │    │
│  │  │  │  │                                          │ │ │   │    │    │
│  │  │  │  │  (Editable text area, pre-filled from    │ │ │   │    │    │
│  │  │  │  │   template if selected)                  │ │ │   │    │    │
│  │  │  │  │                                          │ │ │   │    │    │
│  │  │  │  │                                          │ │ │   │    │    │
│  │  │  │  └──────────────────────────────────────────┘ │ │   │    │    │
│  │  │  │  Characters: 127/500                           │ │   │    │    │
│  │  │  └────────────────────────────────────────────────┘ │   │    │    │
│  │  │                                                      │   │    │    │
│  │  │  ☑ Also log as official violation record           │   │    │    │
│  │  │                                                      │   │    │    │
│  │  ├──────────────────────────────────────────────────────┤   │    │    │
│  │  │  [Cancel]                      [⚠ Send Warning]     │   │    │    │
│  │  └──────────────────────────────────────────────────────┘   │    │
│  │                                                            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  TEMPLATE DROPDOWN ITEMS:                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Template Name          | Preview Text (truncated)              │   │
│  │────────────────────────|──────────────────────────────────────│   │
│  │ General Warning        | "Please focus on your exam..."       │   │
│  │ Tab Switch Warning     | "Tab switching has been detected..." │   │
│  │ Copy/Paste Warning     | "Copy/paste operations are not..."    │   │
│  │ Idle Warning           | "We noticed you have been inactive.." │   │
│  │ Final Warning          | "This is your FINAL warning..."       │   │
│  │ Custom Message         | (blank, user writes own)              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ON SEND:                                                               │
│  1. Button shows loading spinner                                       │
│  2. Modal closes after success                                         │
│  3. Toast notification appears: "✅ Warning sent to John Doe"          │
│  4. Alert feed updates with new entry                                  │
│  5. Student card shows updated warning count                           │
│  6. If logged as violation: violation count increments                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 9.5 Session Termination Confirmation

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: P-005 — TERMINATE SESSION CONFIRMATION                         │
│  Trigger: Proctor clicks "Terminate" on student                         │
│  Severity: Destructive action — requires explicit confirmation         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                            ▽     │    │
│  │  ┌──────────────────────────────────────────────────────┐   │    │    │
│  │  │  ⚠️  TERMINATE SESSION                              │   │    │    │
│  │  │                                              [✕ Close]│   │    │    │
│  │  ├──────────────────────────────────────────────────────┤   │    │    │
│  │  │                                                      │   │    │    │
│  │  │           ⛔ (red shield icon, 48px)                 │   │    │    │
│  │  │                                                      │   │    │    │
│  │  │      Are you sure you want to terminate              │   │    │    │
│  │  │      this exam session?                             │   │    │    │
│  │  │                                                      │   │    │    │
│  │  │  This action cannot be undone. The student will      │   │    │    │
│  │  │  lose access to their exam immediately.             │   │    │    │
│  │  │                                                      │   │    │    │
│  │  │  ┌────────────────────────────────────────────────┐ │   │    │    │
│  │  │  │  STUDENT INFORMATION                           │ │   │    │    │
│  │  │  │  ┌──────────────────────────────────────────┐ │ │   │    │    │
│  │  │  │  │ Name:     John Doe                        │ │ │   │    │    │
│  │  │  │  │ ID:       STU-0042                        │ │ │   │    │    │
│  │  │  │  │ Exam:     IELTS Academic - 15 Jun 2025    │ │ │   │    │    │
│  │  │  │  │ Started:  09:00:03 AM                     │ │ │   │    │    │
│  │  │  │  │ Elapsed:  2h 34m 12s                      │ │ │   │    │    │
│  │  │  │  │ Progress: Writing section, Q28/40          │ │ │   │    │    │
│  │  │  │  │ Violations: 5 (2 Medium, 1 High)          │ │ │   │    │    │
│  │  │  │  └──────────────────────────────────────────┘ │ │   │    │    │
│  │  │  └────────────────────────────────────────────────┘ │   │    │    │
│  │  │                                                      │   │    │    │
│  │  │  ┌────────────────────────────────────────────────┐ │   │    │    │
│  │  │  │  Termination Reason (required):                │ │   │    │    │
│  │  │  │  ┌──────────────────────────────────────────┐ │ │   │    │    │
│  │  │  │  │ ▼ Select or enter reason...             │ │ │   │    │    │
│  │  │  │  │ ┌──────────────────────────────────────┐│ │ │   │    │    │
│  │  │  │  │ │ Repeated tab switching violations   ││ │ │   │    │    │
│  │  │  │  │ │ Suspected use of external resources ││ │ │   │    │    │
│  │  │  │  │ │ Screen capture attempt detected     ││ │ │   │    │    │
│  │  │  │  │ │ Multiple copy/paste attempts        ││ │ │   │    │    │
│  │  │  │  │ │ Extended idle / unresponsive        ││ │ │   │    │    │
│  │  │  │  │ │ Other (please specify below)        ││ │ │   │    │    │
│  │  │  │  │ └──────────────────────────────────────┘│ │ │   │    │    │
│  │  │  │  └──────────────────────────────────────────┘ │ │   │    │    │
│  │  │  │                                              │ │   │    │    │
│  │  │  │  Additional notes (optional):                 │ │   │    │    │
│  │  │  │  ┌──────────────────────────────────────────┐ │ │   │    │    │
│  │  │  │  │                                          │ │ │   │    │    │
│  │  │  │  └──────────────────────────────────────────┘ │ │   │    │    │
│  │  │  └────────────────────────────────────────────────┘ │   │    │    │
│  │  │                                                      │   │    │    │
│  │  │  ☑ I understand this action is permanent and        │   │    │    │
│  │  │    will be recorded in the audit log.               │   │    │    │
│  │  │                                                      │   │    │    │
│  │  ├──────────────────────────────────────────────────────┤   │    │    │
│  │  │  [Cancel]                    [✕ Terminate Session]  │   │    │    │
│  │  └──────────────────────────────────────────────────────┘   │    │
│  │                                                            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  DANGER BUTTON STATE MACHINE:                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ State 1: Disabled (initial)                                     │   │
│  │   • Button present but grayed out                               │   │
│  │   • Requires: reason selected + checkbox checked                │   │
│  │                                                                  │   │
│  │ State 2: Enabled (requirements met)                             │   │
│  │   • Button turns red (danger variant)                           │   │
│  │   • Hover: darker red                                           │   │
│  │                                                                  │   │
│  │ State 3: Confirm countdown (after click)                        │   │
│  │   • Button text changes: "Confirm (3)" → "Confirm (2)" → ...   │   │
│  │   • 3-second countdown prevents accidental click               │   │
│  │                                                                  │   │
│  │ State 4: Executing                                             │   │
│  │   • Spinner + "Terminating..."                                 │   │
│  │   • All other UI disabled                                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  POST-TERMINATION FEEDBACK:                                            │
│  • Modal closes                                                       │
│  • Dashboard shows student card with 🔴 Terminated status            │
│  • Stats bar updates (terminated count +1)                            │
│  • Alert feed logs: "Session terminated by proctor"                   │
│  • Toast: "Session terminated for John Doe"                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 9.6 Proctor Alert Settings / Quick Configuration

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: P-006 — ALERT SETTINGS POPOVER / PANEL                         │
│  Trigger: Click gear icon (⚙) in header bar                            │
│  Purpose: Configure real-time alert preferences during monitoring       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │  ⚙ Alert Preferences                              [✕ Close] │     │
│  ├───────────────────────────────────────────────────────────────┤     │
│  │                                                               │     │
│  │  SOUND NOTIFICATIONS                                         │     │
│  │  ┌─────────────────────────────────────────────────────┐     │     │
│  │  │ 🔊 Enable Sound Alerts                        [ON/OFF]│     │     │
│  │  │                                                     │     │     │
│  │  │  Critical violations:  🔊 Alert Sound 1  [▶ Play]  │     │     │
│  │  │  High violations:      🔊 Alert Sound 2  [▶ Play]  │     │     │
│  │  │  Medium violations:    🔊 Alert Sound 3  [▶ Play]  │     │     │
│  │  │  Low violations:       (no sound)                   │     │     │
│  │  │  Volume:  ───●─────── 75%                         │     │     │
│  │  └─────────────────────────────────────────────────────┘     │     │
│  │                                                               │     │
│  │  VISUAL ALERTS                                               │     │
│  │  ┌─────────────────────────────────────────────────────┐     │     │
│  │  │ Flash browser tab title on critical alert    [✓]    │     │     │
│  │  │ Highlight student card with pulse animation  [✓]    │     │     │
│  │  │ Show desktop notification (browser)         [ ]     │     │     │
│  │  │ Auto-scroll alert feed on new alert         [✓]    │     │     │
│  │  └─────────────────────────────────────────────────────┘     │     │
│  │                                                               │     │
│  │  FILTERS (during this session)                                │     │
│  │  ┌─────────────────────────────────────────────────────┐     │     │
│  │  │ Show in alert feed:                                   │     │     │
│  │  │ ☑ Critical    ☑ High    ☑ Medium    ☑ Low         │     │     │
│  │  │                                                     │     │     │
│  │  │ Suppress alerts for:                                 │     │     │
│  │  │ ☐ Idle warnings (show only in card)                 │     │     │
│  │  │ ☐ Low-severity tab switches (log only)              │     │     │
│  │  └─────────────────────────────────────────────────────┘     │     │
│  │                                                               │     │
│  │  GRID DISPLAY                                                │     │
│  │  ┌─────────────────────────────────────────────────────┐     │     │
│  │  │ Cards per row:  [ 5 ▼ ]  (4, 5, 6, auto)           │     │     │
│  │  │ Sort by: [Violation Count ▼]                        │     │     │
│  │  │ Show avatars: [✓]  Show IDs: [✓]  Show timers: [✓] │     │     │
│  │  │ Compact mode: [ ]  (reduces card info shown)        │     │     │
│  │  └─────────────────────────────────────────────────────┘     │     │
│  │                                                               │     │
│  │                    [Reset Defaults]  [Save & Close]          │     │
│  └───────────────────────────────────────────────────────────────┘     │
│                                                                         │
│  POSITIONING:                                                          │
│  • Default: Popover/dropdown from header gear icon                     │
│  • Alternative: Slide-in panel from right side (w: 360px)            │
│  • Dismissible: Click outside, ESC key, or close button               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Screen Specifications — Admin Panel

### 10.1 Admin Layout Shell (Sidebar Navigation)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: A-001 — ADMIN LAYOUT SHELL                                     │
│  Route: /admin/*                                                       │
│  Audience: System administrators                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌────────┬──────────────────────────────────────────────────────────┐  │
│  │        │  TOP BAR (h: 56px, white bg, border-bottom)             │  │
│  │        │  ┌────────────────────────────────────────────────────┐  │  │
│  │ SIDEBAR │  │ 🎓 IELTS Proctor Admin    🔍 Search...  [🔔][👤] │  │  │
│  │ (240px) │  └────────────────────────────────────────────────────┘  │  │
│  │        ├──────────────────────────────────────────────────────────┤  │
│  │        │                                                           │  │
│  │        │  BREADCRUMB: Dashboard > Sessions > Active Sessions      │  │
│  │        │                                                           │  │
│  │  ┌─────┴─────────────────────────────────────────────────────────┐ │  │
│  │  │  PAGE HEADER                                                  │ │  │
│  │  │  Session Management                                           │ │  │
│  │  │  Manage and monitor all exam sessions                         │ │  │
│  │  └───────────────────────────────────────────────────────────────┘ │  │
│  │        │                                                           │  │
│  │        │  ┌─────────────────────────────────────────────────────┐ │  │
│  │        │  │                                                     │ │  │
│  │        │  │      (PAGE CONTENT AREA)                           │ │  │
│  │        │  │      Fills remaining viewport height               │ │  │
│  │        │  │                                                     │ │  │
│  │        │  │                                                     │ │  │
│  │        │  └─────────────────────────────────────────────────────┘ │  │
│  │        │                                                           │  │
│  └────────┴──────────────────────────────────────────────────────────┘  │
│                                                                         │
│  SIDEBAR DETAILS:                                                       │
│  ┌────────────────────┐                                                  │
│  │  ┌────────────────┐│  ← Logo area (h: 64px, blue-900 bg)           │
│  │  │  🎓            ││                                                  │
│  │  │  IELTS Proctor ││                                                  │
│  │  └────────────────┘│                                                  │
│  │  ─────────────────│                                                  │
│  │                  │                                                  │
│  │  📊 Dashboard   │  ← Active: blue-100 bg, blue-700 text,           │
│  │                  │     left accent bar (3px blue-500)               │
│  │  📋 Sessions    │                                                  │
│  │  👥 Students    │                                                  │
│  │  ⚙️ Rules       │                                                  │
│  │  📈 Reports     │                                                  │
│  │  ─────────────────│                                                  │
│  │  🔧 Settings    │                                                  │
│  │  📜 Audit Log   │                                                  │
│  │  ─────────────────│                                                  │
│  │  🚪 Logout      │                                                  │
│  │                  │                                                  │
│  │  Version 1.0.0  │  ← Footer, xs, gray-400                          │
│  └────────────────────┘                                                  │
│                                                                         │
│  NAV ITEM STATES:                                                        │
│  • Default: gray-600 text, hover: gray-100 bg                           │
│  • Active: blue-700 text, blue-50 bg, blue-500 left bar (3px)         │
│  • Icon size: 20px, spacing icon-to-text: space-3 (12px)               │
│  • Item height: 44px, padding-left: space-6 (24px)                     │
│                                                                         │
│  SIDEBAR COLLAPSED STATE (64px width):                                  │
│  • Only icons visible (centered)                                       │
│  • Tooltip on hover shows label name                                   │
│  • Expand/collapse toggle in top bar                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Rule Management Page

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: A-002 — RULE MANAGEMENT PAGE                                   │
│  Route: /admin/rules                                                    │
│  Purpose: CRUD operations on violation detection rules                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ┌───────────────────────────────────────────────────────────┐  │    │
│  │  │  Violation Detection Rules                    [+ New Rule]│  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  🔍 Search rules...  Filter: [All Severities ▼]        │   │    │
│  │  │  [Active Only] [Sort: Created Date ▼]                   │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────────┐│   │
│  │  │  RULE CARDS (grid layout, 2 columns)                        ││   │
│  │  │                                                             ││   │
│  │  │  ┌─────────────────────────────┐  ┌───────────────────────┐││   │
│  │  │  │ TAB_SWITCH_HIGH            │  │ COPY_ATTEMPT          │││   │
│  │  │  │ ─────────────────────────  │  │ ─────────────────────  │││   │
│  │  │  │ Detects frequent tab        │  │ Any copy attempt       ││   │
│  │  │  │ switching attempts          │  │ triggers immediate     ││   │
│  │  │  │                             │  │ warning                ││   │
│  │  │  │ Severity: 🟠 HIGH           │  │ Severity: 🟡 MEDIUM   │││   │
│  │  │  │ Status:   ● Active          │  │ Status:   ● Active     │││   │
│  │  │  │ Triggers:  23 today         │  │ Triggers:  8 today     │││   │
│  │  │  │                             │  │                        │││   │
│  │  │  │ Threshold: ≥5 in 5min       │  │ Threshold: ≥1 always   │││   │
│  │  │  │ Action: Warn + Notify       │  │ Action: Warn student   │││   │
│  │  │  │ Escalate: Pause session     │  │ Escalate: Notify proctor│││   │
│  │  │  │                             │  │                        │││   │
│  │  │  │ [Edit] [Duplicate] [Toggle] │  │ [Edit] [Duplicate]     │││   │
│  │  │  │ [▼ Test Rule]              │  │ [Toggle] [▼ Test Rule]  │││   │
│  │  │  └─────────────────────────────┘  └───────────────────────┘││   │
│  │  │                                                             ││   │
│  │  │  ┌─────────────────────────────┐  ┌───────────────────────┐││   │
│  │  │  │ SCREEN_CAPTURE             │  │ IDLE_WARNING           │││   │
│  │  │  │ ...                         │  │ ...                     │││   │
│  │  │  └─────────────────────────────┘  └───────────────────────┘││   │
│  │  │                                                             ││   │
│  │  └─────────────────────────────────────────────────────────────┘│   │
│  │                                                                 │    │
│  │  Showing 12 of 12 rules          < 1 2 >                        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  RULE CARD DESIGN:                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Border-left: 4px colored by severity (🟠=high, 🟡=med, 🔵=low)│   │
│  │  Header: Rule name (lg, semibold) + Status toggle (right)       │   │
│  │  Body: Description (sm, gray-600)                               │   │
│  │  Meta Grid:                                                     │   │
│  │  ┌──────────────────┬──────────────────┐                        │   │
│  │  │ Severity: badge  │ Threshold: text  │                        │   │
│  │  │ Action: text     │ Escalation: text │                        │   │
│  │  │ Trigger count:   │ Last triggered:  │                        │   │
│  │  └──────────────────┴──────────────────┘                        │   │
│  │  Footer: Action buttons row                                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  CREATE/EDIT RULE MODAL:                                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Create New Rule (or Edit: TAB_SWITCH_HIGH)          [✕ Close] │    │
│  │  ────────────────────────────────────────────────────────────    │
│  │  Basic Information                                             │    │
│  │  Rule Name: [_________________________]                        │    │
│  │  Description: [___________________________________]           │    │
│  │  Severity: (○ Low  ○ Medium  ○ High  ○ Critical)              │    │
│  │                                                                  │    │
│  │  Trigger Conditions                                             │    │
│  │  Event Types: [☑ Tab Switch] [☑ Focus Loss] [☐ Copy] ...      │    │
│  │  Condition: [Count threshold ▼]                                 │    │
│  │  Count: [__] within [____] seconds                              │    │
│  │                                                                  │    │
│  │  Actions                                                         │    │
│  │  Primary Action: [Log Only ▼]                                   │    │
│  │  On Repeat: [Escalate to ▼]                                    │    │
│  │  Cooldown: [____] seconds between triggers                      │    │
│  │                                                                  │    │
│  │  [Cancel]  [Save Rule]  [Test with Sample Data]                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 10.3 Session Management Page (Admin)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: A-003 — SESSION MANAGEMENT (ADMIN LIST VIEW)                   │
│  Route: /admin/sessions                                                │
│  Purpose: Browse, search, filter all past and active exam sessions      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Exam Sessions                              [+ Create Session] │    │
│  │  ─────────────────────────────────────────────────────────────  │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  ┌───────────────────────────────────────────────────┐ │   │    │
│  │  │  │ 🔍 Search students, sessions, IDs...             │ │   │    │
│  │  │  └───────────────────────────────────────────────────┘ │   │    │
│  │  │                                                             │   │    │
│  │  │  Filters:                                                   │   │    │
│  │  │  ┌──────────────┐ ┌────────────┐ ┌──────────┐ ┌────────┐ │   │    │
│  │  │  │ Date Range   │ │ Exam       │ │ Status   │ │ Flag   │ │   │    │
│  │  │  │ [📅 - 📅]   │ │ [All ▼]    │ │ [All ▼]  │ │[All ▼] │ │   │    │
│  │  │  └──────────────┘ └────────────┘ └──────────┘ └────────┘ │   │    │
│  │  │  [Clear Filters]  [Save Filter Preset]                       │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────────┐│   │
│  │  │  SESSIONS TABLE                                            ││   │
│  │  │  ┌─────┬──────────┬────────┬──────┬───────┬──────┬────────┐││   │
│  │  │  │ □   │ Student   │ Exam   │Date  │Status │Viols  │Action │││   │
│  │  │  ├─────┼──────────┼────────┼──────┼───────┼──────┼────────┤││   │
│  │  │  │ ☐   │ John Doe  │ IELTS  │15 Jun│🟢Act. │  5    │[View] │││   │
│  │  │  │ ☐   │ Jane Smith│ IELTS  │15 Jun│🟠Pause│ 12    │[View] │││   │
│  │  │  │ ☑   │ Ali Ahmed │ IELTS  │15 Jun│🔴Term. │ 18    │[View] │││   │
│  │  │  │ ☐   │ Maria G.  │ IELTS  │15 Jun│🟢Comp. │  0    │[View] │││   │
│  │  │  │ ☐   │ Chen Wei  │ IELTS  │14 Jun│🟢Comp. │  1    │[View] │││   │
│  │  │  │ ... │ ...       │ ...    │ ...  │ ...   │ ...   │ ...   │││   │
│  │  │  └─────┴──────────┴────────┴──────┴───────┴──────┴────────┘││   │
│  │  │                                                             ││   │
│  │  │  Showing 1-25 of 1,247    < 1 2 3 ... 50 >    Per page: 25││   │
│  │  │                                                             ││   │
│  │  │  Bulk Actions: [Flag Selected] [Export Selected] [Delete]   │││   │
│  │  └─────────────────────────────────────────────────────────────┘│   │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  TABLE ROW EXPANSION (click row or [View]):                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  ▸ John Doe  │ IELTS Acad  │ 15 Jun │ 🟢 Active │ 5  │ [View]  │   │
│  │  ├─────────────────────────────────────────────────────────────┤   │
│  │  │  EXPANDED DETAIL ROW (spans all columns)                    │   │
│  │  │  ┌───────────────────┬─────────────────────────────────────┐│   │
│  │  │  │ Session Summary   │  Violation Preview                 ││   │
│  │  │  │ ID: SES-2025-0042  │  • Tab Switch x3 (Med)           ││   │
│  │  │  │ Duration: 2h 34m   │  • Copy Attempt x1 (Med)         ││   │
│  │  │  │ IP: 203.0.113.42   │  • Focus Loss x1 (Low)           ││   │
│  │  │  │ Browser: Chrome 120 │  • Idle Warning x1 (Med)         ││   │
│  │  │  │                   │                                     ││   │
│  │  │  │ Quick Actions:     │  [Full Report] [Timeline] [Notes] ││   │
│  │  │  │ [⚠][⏸][✕][🚩]   │                                     ││   │
│  │  │  └───────────────────┴─────────────────────────────────────┘│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  CREATE SESSION MODAL:                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Schedule New Exam Session                          [✕ Close]  │    │
│  │  ────────────────────────────────────────────────────────────    │
│  │  Exam Title: [IELTS Academic - June Batch 3_________]           │    │
│  │  Description: [_____________________________________]          │    │
│  │                                                                  │    │
│  │  Date & Time:                                                    │    │
│  │  [📅 15/06/2025]  [⏰ 09:00 AM]  Duration: [165 min]            │    │
│  │                                                                  │    │
│  │  Assign Proctor(s):                                             │    │
│  │  [Sarah K. ✕] [Mike R. ✕]  [+ Add Proctor]                    │    │
│  │                                                                  │    │
│  │  Max Students: [100]  Expected: [85]                            │    │
│  │                                                                  │    │
│  │  Rule Preset: [Standard IELTS ▼]  (or customize later)         │    │
│  │                                                                  │    │
│  │  [Cancel]  [Create Session]                                      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 10.4 User Management Page

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: A-004 — USER MANAGEMENT                                       │
│  Route: /admin/users                                                   │
│  Purpose: Manage student and proctor/admin accounts                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  User Management                              [+ Add User]     │    │
│  │  ─────────────────────────────────────────────────────────────  │    │
│  │                                                                 │    │
│  │  [Students (1,247)]  [Proctors (12)]  [Admins (3)]  ← Tabs    │    │
│  │  ════════════════════════════════════════════════════════════  │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  🔍 Search by name, email, ID...    Role: [All ▼]      │   │    │
│  │  │  Status: [Active ▼]  Sort: [Newest First ▼]            │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────────┐│   │
│  │  │  USER CARDS (card grid layout, 3 per row)                   ││   │
│  │  │                                                             ││   │
│  │  │  ┌──────────────────┐  ┌──────────────────┐                ││   │
│  │  │  │  ┌────┐          │  │  ┌────┐          │                ││   │
│  │  │  │  │ JD │ John Doe │  │  │ JS │ Jane Smith│               ││   │
│  │  │  │  └────┘          │  │  └────┘          │                ││   │
│  │  │  │                  │  │                  │                ││   │
│  │  │  │  john@ielts.com  │  │  jane@ielts.com  │                ││   │
│  │  │  │  STU-0042        │  │  STU-0017        │                ││   │
│  │  │  │                  │  │                  │                ││   │
│  │  │  │  🟢 Active       │  │  🟢 Active       │                ││   │
│  │  │  │  Last login:     │  │  Last login:     │                ││   │
│  │  │  │  15 Jun 2025     │  │  15 Jun 2025     │                ││   │
│  │  │  │                  │  │                  │                ││   │
│  │  │  │  Sessions: 3     │  │  Sessions: 1     │                ││   │
│  │  │  │  Violations: 5   │  │  Violations: 12  │                ││   │
│  │  │  │                  │  │                  │                ││   │
│  │  │  │  [Edit] [Reset PW]│  │  [Edit] [Reset PW]│               ││   │
│  │  │  │  [Disable] [Login As]│ [Disable] [Del]  │                ││   │
│  │  │  └──────────────────┘  └──────────────────┘                ││   │
│  │  │                                                             ││   │
│  │  │  ┌──────────────────┐  ┌──────────────────┐                ││   │
│  │  │  │ (more cards...)  │  │ (more cards...)  │                ││   │
│  │  │  └──────────────────┘  └──────────────────┘                ││   │
│  │  │                                                             ││   │
│  │  └─────────────────────────────────────────────────────────────┘│   │
│  │                                                                 │    │
│  │  Showing 1-9 of 1,247 students    < 1 2 3 ... 139 >           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  USER CARD STATES:                                                      │
│  • Active: Normal appearance, green dot                               │
│  • Disabled: Grayed out, red dot, "Disabled" badge                   │
│  • Suspended: Amber tint, amber dot, "Suspended" badge                │
│                                                                         │
│  ADD/EDIT USER MODAL:                                                   │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Add New User (or Edit: John Doe)                    [✕ Close]  │    │
│  │  ────────────────────────────────────────────────────────────    │
│  │  Role: (○ Student  ○ Proctor  ● Admin)                         │    │
│  │                                                                  │    │
│  │  First Name: [John____________]  Last Name: [Doe__________]    │    │
│  │  Email: [john.doe@email.com____]                                │    │
│  │                                                                  │    │
│  │  Password: [•••••••••]  (leave blank to keep current)           │    │
│  │  Generate Random [🔄]                                          │    │
│  │                                                                  │    │
│  │  Status: ● Active  ○ Disabled                                   │    │
│  │                                                                  │    │
│  │  [Cancel]  [Create User]                                        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Screen Specifications — Post-Exam Review

### 11.1 Session Review Main Report

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: R-001 — SESSION REVIEW / DETAIL REPORT                        │
│  Route: /admin/reviews/sessions/:id                                    │
│  Purpose: Complete post-exam analysis of a single student session      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ← Back to Sessions    Session Review              [Export ▼]  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  SESSION HEADER                                       │   │    │
│  │  │                                                         │   │    │
│  │  │  ┌────────────────┐  ┌──────────────────────────────┐  │   │    │
│  │  │  │  🟡 WARNED     │  │  John Doe (STU-0042)         │  │   │    │
│  │  │  │  Review Status │  │  john.doe@email.com           │  │   │    │
│  │  │  │                │  │  IELTS Academic - 15 Jun 2025 │  │   │    │
│  │  │  │  [Change ▼]    │  │  Session: SES-2025-A7F3       │  │   │    │
│  │  │  └────────────────┘  └──────────────────────────────┘  │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  ┌────────────────────┬──────────────────────────────────────┐  │    │
│  │  │ SESSION TIMELINE   │  SUMMARY STATISTICS                 │  │    │
│  │  │                    │                                      │  │    │
│  │  │  ┌──────────────┐  │  ┌────────────────────────────┐    │  │    │
│  │  │  │ 09:00:03 START│  │  │  TOTAL DURATION           │    │  │    │
│  │  │  │ 09:05:22 Q1   │  │  │  2h 34m 12s              │    │  │    │
│  │  │  │ 09:12:44 SEC→W │  │  ├────────────────────────────┤    │  │    │
│  │  │  │ 14:31:45 ⚠TAB │  │  │  EVENTS LOGGED   12,456   │    │  │    │
│  │  │  │ 14:32:05 ⚠CPY │  │  │  VIOLATIONS      5        │    │  │    │
│  │  │  │ 14:33:11 ⚠TAB │  │  │  WARNINGS ISSUED 3        │    │  │    │
│  │  │  │ 14:34:22 PAUSE │  │  │  PAUSES          1        │    │  │    │
│  │  │  │ 14:35:00 RESUM │  │  │  PAUSED DURATION 2m 38s   │    │  │    │
│  │  │  │ 11:41:23 SUBMIT│  │  │  PROCTOR ACTIONS 2        │    │  │    │
│  │  │  │ 11:41:23 END   │  │  └────────────────────────────┘    │  │    │
│  │  │  └──────────────┘  │                                      │  │    │
│  │  │                    │  ┌────────────────────────────┐    │  │    │
│  │  │  Timeline controls:│  │  VIOLATION BREAKDOWN       │    │  │    │
│  │  │  [▶ Play] [⏸]    │  │                              │    │  │    │
│  │  │  Speed: 1x [▼]    │  │  Tab Switch    ████████ 60%  │    │  │    │
│  │  │  Filter: [All ▼]  │  │  Copy          ██ 20%        │    │  │    │
│  │  │                    │  │  Focus Loss    █ 10%        │    │  │    │
│  │  │                    │  │  Idle          █ 10%        │    │  │    │
│  │  │                    │  │                              │    │  │    │
│  │  │                    │  │  SEVERITY:                   │    │  │    │
│  │  │                    │  │  🔵 Low: 1                   │    │  │    │
│  │  │                    │  │  🟡 Medium: 3                │    │  │    │
│  │  │                    │  │  🟠 High: 1                  │    │  │    │
│  │  │                    │  │  🔴 Critical: 0              │    │  │    │
│  │  │                    │  └────────────────────────────┘    │  │    │
│  │  └────────────────────┴──────────────────────────────────────┘  │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  TIMELINE COMPONENT DETAILS:                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Each timeline item:                                            │   │
│  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │ 14:32:05  │  ⚠  │  COPY_ATTEMPT  │  Medium  │  [i] [→] │  │   │
│  │  │ timestamp │icon │  event type    │severity  │info/detail│  │   │
│  │  └──────────────────────────────────────────────────────────┘  │   │
│  │                                                                  │   │
│  │  Color coding:                                                   │   │
│  │  • Normal events: gray background, no left border               │   │
│  │  • Low severity: blue left border (2px)                         │   │
│  │  • Medium: amber left border                                     │   │
│  │  • High: orange left border                                      │   │
│  │  • Critical: red left border + red highlight background         │   │
│  │                                                                  │   │
│  │  Playback feature:                                               │   │
│  │  • Click "Play" to auto-scroll through timeline                 │   │
│  │  • Adjustable speed: 0.5x, 1x, 2x, 5x                          │   │
│  │  • Current position indicator (highlighted item)               │   │
│  │  • Jump to specific time via time input                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  REVIEW ACTIONS BAR:                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  FINAL REVIEW DECISION:                                          │    │
│  │  [✅ Mark Clean]  [⚠️ Mark Suspicious]  [❌ Confirm Misconduct] │    │
│  │                                                                 │    │
│  │  Reviewer Notes:                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │ Enter your review observations and conclusions here...   │   │    │
│  │  │                                                         │   │    │
│  │  │                                                         │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │  [Add Note]                                                     │    │
│  │                                                                 │    │
│  │  Reviewed By: Sarah K.  Date: 15 Jun 2025 14:50               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 11.2 Export Options Modal

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCREEN: R-002 — EXPORT REPORT MODAL                                    │
│  Trigger: Click "Export ▼" in report header                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Export Report                                    [✕ Close]    │    │
│  │  ────────────────────────────────────────────────────────────    │
│  │                                                                  │    │
│  │  Select Export Format:                                           │    │
│  │                                                                  │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │    │
│  │  │              │  │              │  │              │          │    │
│  │  │   📄 PDF     │  │   📊 CSV     │  │   { } JSON   │          │    │
│  │  │              │  │              │  │              │          │    │
│  │  │  Formatted    │  │  Raw data    │  │  Machine-    │          │    │
│  │  │  report       │  │  export      │  │  readable    │          │    │
│  │  │  suitable    │  │  spreadsheet │  │  for APIs    │          │    │
│  │  │  for printing│  │  analysis    │  │  integration │          │    │
│  │  │              │  │              │  │              │          │    │
│  │  │  ● Selected  │  │              │  │              │          │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │    │
│  │                                                                  │    │
│  │  Include Sections:                                               │    │
│  │  ☑ Session Summary                                              │    │
│  │  ☑ Violation Details                                            │    │
│  │  ☑ Activity Timeline                                           │    │
│  │  ☑ Admin Action Log                                             │    │
│  │  ☐ Statistical Analysis (charts/graphs)                        │    │
│  │  ☐ Raw Event Log (may be large)                                │    │
│  │                                                                  │    │
│  │  PDF Options (when PDF selected):                                │    │
│  │  Paper Size: [A4 ▼]                                             │    │
│  │  Orientation: [Portrait ▼]                                      │    │
│  │  Include Cover Page: [✓]                                        │    │
│  │  Include Page Numbers: [✓]                                      │    │
│  │  Watermark: [________________] (optional)                       │    │
│  │                                                                  │    │
│  │  ┌──────────────────────────────────────────────────────────┐   │    │
│  │  │  📥 Generate Download                                   │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  │                                                                  │    │
│  │  Estimated file size: ~2.4 MB (PDF) / ~890 KB (CSV)           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  EXPORT IN PROGRESS:                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Generating report...                                           │    │
│  │  ████████████████████████░░░░░░░  67%                          │    │
│  │  Compiling violation data...                                    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  EXPORT COMPLETE:                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ✅ Report ready!                                               │    │
│  │  File: IELTS_Session_STU-0042_2025-06-15.pdf                   │    │
│  │  Size: 2.4 MB                                                  │    │
│  │  [Download File]  [Copy Link]  [Close]                          │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 12. Interaction Patterns & Animations

### 12.1 Animation Principles

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ANIMATION GUIDELINES                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  CORE PRINCIPLES:                                                       │
│  ════════════════                                                       │
│                                                                         │
│  1. PURPOSEFUL                                                          │
│     Every animation must communicate something useful:                  │
│     • Where did this element come from?                                 │
│     • Where did it go?                                                 │
│     • What state changed?                                               │
│     • What should I pay attention to?                                   │
│                                                                         │
│  2. PERFORMANT                                                         │
│     • Use GPU-accelerated properties only (transform, opacity)         │
│     • Avoid layout-triggering properties (width, height, top, left)   │
│     • Target 60fps, never drop below 30fps                             │
│     • Respect `prefers-reduced-motion` media query                     │
│                                                                         │
│  3. BRIEF                                                              │
│     • Duration: 150-300ms for most transitions                        │
│     • Complex animations: max 500ms                                    │
│     • Loops/infinite: NEVER (except subtle loading states)             │
│                                                                         │
│  4. NATURAL                                                            │
│     • Ease-out for entering elements (decelerate)                     │
│     • Ease-in for exiting elements (accelerate away)                  │
│     • Ease-in-out for state changes (smooth transition)               │
│     • Use spring physics for playful interactions (rarely)            │
│                                                                         │
│  EASING CURVES:                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Token Name     │ CSS Value              │ Usage                │   │
│  │────────────────┼────────────────────────┼──────────────────────│   │
│  │ ease-out       │ cubic-bezier(0.16, 1, 0.3, 1) │ Enter, open   │   │
│  │ ease-in        │ cubic-bezier(0.7, 0, 0.84, 0)   │ Exit, close   │   │
│  │ ease-in-out    │ cubic-bezier(0.4, 0, 0.2, 1)   │ State change  │   │
│  │ spring         │ cubic-bezier(0.34, 1.56, 0.64, 1) │ Playful/bounce│  │
│  │ linear         │ linear                 │ Progress bars    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 12.2 Animation Library

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ANIMATION REFERENCE LIBRARY                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  1. FADE IN/OUT                                                        │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
/* Fade In */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
/* Duration: 200ms, Easing: ease-out */
/* Usage: Tooltips, toasts, modals appearing, status messages */
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  2. SLIDE UP (Panel/Sheet)                                             │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
/* Slide Up Panel (Student Detail) */
@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
/* Duration: 300ms, Easing: cubic-bezier(0.32, 0.72, 0, 1) */
/* Usage: Bottom detail panels, modals from bottom */
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  3. SCALE IN (Modal/Card)                                               │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
/* Scale In (Modal) */
@keyframes scaleIn {
  from { 
    opacity: 0;
    transform: scale(0.95);
  }
  to { 
    opacity: 1;
    transform: scale(1);
  }
}
/* Duration: 200ms, Easing: ease-out */
/* Usage: Modal dialogs, dropdown menus, popovers */
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  4. EXPAND/COLLAPSE (Accordion/Accordian)                               │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
/* Expand (Accordion, Table Row) */
@keyframes expand {
  from { 
    opacity: 0;
    max-height: 0;
    grid-template-rows: 0fr;
  }
  to { 
    opacity: 1;
    max-height: 500px; /* or calculated value */
    grid-template-rows: 1fr;
  }
}
/* Duration: 250ms, Easing: ease-out */
/* Usage: Table row expansion, accordion sections, collapsible panels */
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  5. PULSE (Alert/Attention)                                              │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
/* Pulse (Critical Alert, New Notification) */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
/* Duration: 1s, Iterations: 3, then stop */
/* Usage: Critical alert banner, new alert dot, connection lost */
│                                                                         │
/* Pulse Ring (Student Card on Violation) */
@keyframes pulseRing {
  0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
  70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
  100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
}
/* Duration: 1.5s, Iterations: 2 */
/* Usage: Student card that just had critical violation */
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  6. SHIMMER/SKELETON LOADING                                            │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
/* Shimmer (Loading Skeleton) */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
/* Background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%) */
/* Background-size: 200% 100% */
/* Duration: 1.5s, Iterations: infinite */
/* Usage: Content loading placeholders, card skeletons */
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  7. SHAKE (Error/Input Validation)                                       │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
/* Shake (Error State) */
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
  20%, 40%, 60%, 80% { transform: translateX(4px); }
}
/* Duration: 400ms, Iterations: 1 */
/* Usage: Invalid form submission, failed action, wrong password */
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  8. COUNTDOWN TIMER ANIMATION                                           │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
/* Timer Pulse (Last 10 minutes, Last 5 minutes) */
@keyframes timerUrgent {
  0%, 100% { color: var(--color-danger); }
  50% { color: var(--color-red-400); }
}
/* Duration: 1s, Iterations: until resolved */
/* Usage: Exam timer when < 5 min remaining */
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  9. SPINNER (Loading Indicator)                                          │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
/* Spinner (Border Rotation) */
@keyframes spin {
  to { transform: rotate(360deg); }
}
/* Element: border with 1 transparent side, border-radius: 50% */
/* Duration: 800ms, linear, infinite */
/* Size: 20px (inline), 32px (modal/page), 48px (hero) */
/* Border: 3px solid gray-200, border-top-color: blue-500 */
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 12.3 Micro-interactions Catalog

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  MICRO-INTERACTIONS CATALOG                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  INTERACTION: Button Press                                              │
│  ─────────────────────────────────────────────────                      │
│  State Flow: Default → Hover (scale 1.02, shadow-md, 150ms)           │
│            → Active/Press (scale 0.98, shadow-sm inset, 50ms)         │
│            → Release → Loading (spinner replaces text)                  │
│            → Success (checkmark flash, green tint, revert)             │
│                                                                         │
│  INTERACTION: Card Selection (Student Grid)                             │
│  ─────────────────────────────────────────────────                      │
│  State Flow: Default → Hover (shadow-lg lift, translateY(-2px), 150ms)│
│            → Click (ring-2 ring-blue-500 ring-offset-2, 100ms)        │
│            → Selected (blue-50 bg, ring persists, check icon appears)  │
│                                                                         │
│  INTERACTION: Alert Feed Item Appears                                   │
│  ─────────────────────────────────────────────────                      │
│  Animation: Slide in from right (translateX(20px) → 0) + fadeIn       │
│  Duration: 250ms, easing: ease-out                                     │
│  New item briefly flashes background (amber-50, 300ms fade)            │
│                                                                         │
│  INTERACTION: Status Badge Change                                        │
│  ─────────────────────────────────────────────────                      │
│  Old badge: scale down to 0 (100ms, ease-in)                           │
│  New badge: scale up from 0 (100ms, ease-out)                          │
│  Color transition: crossfade during swap                               │
│                                                                         │
│  INTERACTION: Stat Counter Update (Dashboard Stats Bar)                 │
│  ─────────────────────────────────────────────────                      │
│  Number rolls up/down: CSS counter animation or JS tween                │
│  Duration: 400ms, easing: ease-out                                     │
│  Optional: brief color flash (green for increase, red for decrease)    │
│                                                                         │
│  INTERACTION: Tab Switch                                                 │
│  ─────────────────────────────────────────────────                      │
│  Indicator: Underline slides from old tab to new tab (200ms, ease-out) │
│  Content: Crossfade old content → new content (200ms)                  │
│  Content entrance: slight translateY(8px) → 0 (fade + slide up)        │
│                                                                         │
│  INTERACTION: Toggle Switch                                             │
│  ─────────────────────────────────────────────────                      │
│  Thumb: Slides left ↔ right (200ms, cubic-bezier(0.4, 0, 0.2, 1))    │
│  Track: Background color transitions (green ↔ gray, 200ms)            │
│  Optional: Subtle "pop" at end of travel (spring, 150ms)              │
│                                                                         │
│  INTERACTION: Dropdown Menu                                              │
│  ─────────────────────────────────────────────────                      │
│  Container: Scale from 0.95 + fade in (150ms, ease-out)                │
│  Items: Staggered entrance (each item +30ms delay, translateY(-4px))   │
│  Dismiss: Fade out + scale to 0.95 (100ms, ease-in)                   │
│                                                                         │
│  INTERACTION: Toast Notification                                        │
│  ─────────────────────────────────────────────────                      │
│  Entrance: Slide in from top-right + fade (200ms, ease-out)            │
│  Exit: Auto-dismiss: slide right + fade (200ms, ease-in)               │
│  Manual dismiss: fade out (150ms)                                       │
│  Progress bar: Shrinks from full to empty over duration                 │
│                                                                         │
│  INTERACTION: Modal Overlay                                             │
│  ─────────────────────────────────────────────────                      │
│  Backdrop: Fade black/0 → black/50 (200ms)                             │
│  Modal: Scale 0.95→1 + fade in (200ms, ease-out)                       │
│  Dismiss: Reverse (backdrop first 100ms, then modal 100ms)             │
│                                                                         │
│  INTERACTION: Pagination Number Change                                   │
│  ─────────────────────────────────────────────────                      │
│  Old number: fade out + translateY(-8px) (100ms)                        │
│  New number: fade in + translateY(8px→0) (100ms, slight delay)        │
│                                                                         │
│  INTERACTION: Search Input Focus                                         │
│  ─────────────────────────────────────────────────                      │
│  On focus: Width expands slightly (+40px, 200ms, ease-out)             │
│  Icon rotates 90° if it's a search icon that becomes close (×)         │
│  Results appear: staggered fade-in (each +30ms)                        │
│                                                                         │
│  INTERACTION: Connection Status Change (Student Header)                 │
│  ─────────────────────────────────────────────────                      │
│  Green → Yellow: Dot pulses yellow 3x, text fades "Connected→Reconnect"│
│  Yellow → Red: Dot turns solid red, text "Disconnected", shake effect  │
│  Red → Green: Smooth transition, dot pulses green 2x (success feel)   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 12.4 Reduced Motion / Accessibility Mode

```css
/* REDUCED MOTION: Respect user preference */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }

  /* Replace animations with instant state changes */
  .modal-enter { opacity: 1; transform: none; }
  .panel-slide { transform: none; }
  .card-hover:hover { transform: none; }
  
  /* Keep essential feedback but make it instant */
  .error-shake { /* disabled */ }
  .pulse-alert { /* disabled - use static color instead */ }
}

/* For users who prefer reduced motion, provide static alternatives:
 * - Modals appear instantly (no scale/fade)
 * - Panels slide instantly (no animation)
 * - Spinners become static progress indicators
 * - Alerts appear without slide-in
 * - Hover effects are limited to color change only
 */
```

---

## 13. Responsive Design Guidelines

### 13.1 Breakpoint Behavior Matrix

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  RESPONSIVE BEHAVIOR MATRIX                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┬───────────┬───────────┬───────────┬───────────┐  │
│  │ Component       │ Mobile    │ Tablet    │ Desktop   │ Large    │  │
│  │                 │ (<640px)  │ (768px)   │ (1024px)  │ (≥1440px)│  │
│  ├─────────────────┼───────────┼───────────┼───────────┼───────────┤  │
│  │ Student Exam    │ Fullscreen│ Fullscreen│ Fullscreen│ Fullscreen│  │
│  │ Interface       │ locked    │ locked    │ locked    │ locked   │  │
│  │                 │           │           │           │           │  │
│  │ Proctor Grid    │ Single    │ 2-column  │ 4-5 col   │ 5-6 col  │  │
│  │                 │ column    │ list view │ grid      │ grid     │  │
│  │                 │ list      │           │           │           │  │
│  │ Alert Panel     │ Bottom    │ Right     │ Right     │ Right    │  │
│  │                 │ sheet     │ panel     │ panel     │ panel    │  │
│  │                 │ (overlay) │ (340px)   │ (340px)   │ (400px)  │  │
│  │                 │           │           │           │           │  │
│  │ Detail Panel    │ Fullscreen│ Fullscreen│ Bottom    │ Bottom   │  │
│  │                 │ page      │ page      │ sheet     │ sheet    │  │
│  │                 │           │           │ (40vh)    │ (40vh)   │  │
│  │                 │           │           │           │           │  │
│  │ Admin Sidebar   │ Hidden    │ Collapsed │ Visible   │ Visible  │  │
│  │                 │ (hamburger│ (icons    │ (240px)   │ (240px)  │  │
│  │                 │  menu)    │ only)     │           │           │  │
│  │ Data Tables     │ Horizontal│ Horizontal│ Standard  │ Standard │  │
│  │                 │ scroll    │ scroll    │           │ w/ more  │  │
│  │                 │ cards alt │ cards alt │           │ columns  │  │
│  │ Forms           │ Stacked   │ Stacked   │ Side-by-  │ Side-by- │  │
│  │                 │ fields    │ fields    │ side      │ side     │  │
│  │                 │           │           │ labels     │ labels   │  │
│  │ Modals          │ Fullscreen│ 95vw      │ 560px     │ 720px    │  │
│  │                 │           │ centered   │ centered  │ centered │  │
│  │ Stats Bar       │ Vertical  │ Wrap      │ Horizontal│ Horiz.  │  │
│  │                 │ stack     │ (2 per    │ row       │ row      │  │
│  │                 │           │ row)      │           │           │  │
│  │ Navigation     │ Bottom    │ Top +     │ Top horiz │ Top horiz│  │
│  │ (Student post- │ sheet     │ hamburger │ + sidebar  │ + sidebar│  │
│  │  exam)          │           │           │           │           │  │
│  └─────────────────┴───────────┴───────────┴───────────┴───────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 13.2 Mobile Considerations (Tablet Minimum)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  MOBILE / TABLET ADAPTATIONS                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  IMPORTANT NOTE:                                                        │
│  ════════════════                                                       │
│  The STUDENT EXAM INTERFACE is DESKTOP/LAPTOP ONLY.                     │
│  Tablets and mobile devices are NOT supported for taking exams due to:   │
│  • Security concerns (touch gestures harder to monitor)                 │
│  • Screen size requirements (need to see full question + answer)       │
│  • Keyboard requirement (essay writing sections)                        │
│  • Browser compatibility (need full desktop Chrome/Firefox)             │
│                                                                         │
│  However, PROCTOR DASHBOARD should be usable on tablets for:            │
│  • Emergency remote monitoring scenarios                                 │
│  • Admin tasks on-the-go                                                │
│                                                                         │
│  TABLET PROCTOR DASHBOARD (< 1024px):                                   │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ┌───────────────────────────────────────────────────────────┐  │    │
│  │  │ ≡  IELTS Proctor  [🔔]  [≡ Filter]              [Logout] │  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  │  ┌───────────────────────────────────────────────────────────┐  │    │
│  │  │  STATS (horizontal scroll or wrap)                        │  │    │
│  │  │  [🟢94] [🟡3] [🟠2] [🔴1]                               │  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  │  ┌───────────────────────────────────────────────────────────┐  │    │
│  │  │  SEARCH & FILTER BAR                                      │  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  │  ┌───────────────────────────────────────────────────────────┐  │    │
│  │  │  STUDENT LIST (list view, not grid)                      │  │    │
│  │  │                                                         │  │    │
│  │  │  ┌─────────────────────────────────────────────────┐   │  │    │
│  │  │  │ 🟡 John Doe (STU-0042)                    [>]   │   │  │    │
│  │  │  │ Writing · 45:23 · 2 warnings                      │   │  │    │
│  │  │  ├─────────────────────────────────────────────────┤   │  │    │
│  │  │  │ 🟢 Jane Smith (STU-0017)                   [>]   │   │  │    │
│  │  │  │ Reading · 1:12:05 · 0 violations                   │   │  │    │
│  │  │  ├─────────────────────────────────────────────────┤   │  │    │
│  │  │  │ 🔴 Ali Ahmed (STU-0023)                     [>]   │   │  │    │
│  │  │  │ TERMINATED · 12 violations                           │   │  │    │
│  │  │  └─────────────────────────────────────────────────┘   │  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  │  ┌───────────────────────────────────────────────────────────┐  │    │
│  │  │  ALERTS (tappable to expand)                             │  │    │
│  │  │  🔴 14:32 J.Smith screen capture              [Ack]    │  │    │
│  │  │  🟠 14:31 A.Ahmed tab switch #3               [Ack]    │  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  LIST ITEM (Tablet):                                                     │
│  • Height: 72px (larger touch target)                                   │
│  • Tap anywhere to expand detail (not just small arrow)                  │
│  • Swipe left for quick actions (warn/pause) - optional gesture          │
│  • Detail expands inline (accordion style) rather than bottom panel      │
│                                                                         │
│  TOUCH TARGET SIZES:                                                     │
│  • Minimum touch target: 44px × 44px (Apple HIG / Material guideline)   │
│  • Buttons: min height 44px on tablet                                   │
│  • List items: min height 56px                                          │
│  • Icons in toolbars: 44px tap area (icon can be smaller within padding) │
│  • Spacing between tappable items: min 8px gap                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 14. Accessibility (WCAG) Compliance

### 14.1 WCAG 2.1 AA Compliance Checklist

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  WCAG 2.1 AA COMPLIANCE CHECKLIST                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  PERCEIVABLE                                                          │
│  ═════════════                                                         │
│                                                                         │
│  1.1.1 Non-text Content                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓ All images have meaningful alt text                           │   │
│  │ ✓ Icons have aria-label or visually hidden text alternative     │   │
│  │ ✓ Status indicators (dots) have sr-only text labels             │   │
│  │ ✓ Charts/graphs have text-based data table alternatives         │   │
│  │ ✓ Decorative images have alt="" or role="presentation"          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  1.3.4 Orientation                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓ Content works in portrait AND landscape (student exam except)│   │
│  │ ✓ No horizontal scrolling required at 320px viewport width      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  1.4.3 Contrast (Minimum)                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓ Normal text: minimum 4.5:1 contrast ratio                    │   │
│  │ ✓ Large text (18pt+ / 14pt bold): minimum 3:1 ratio           │   │
│  │ ✓ UI components: 3:1 against adjacent background              │   │
│  │ ✓ Status colors tested: each color meets ratio on its bg        │   │
│  │ ✓ Gray text on white: #595959 minimum (4.54:1)                │   │
│  │ ✓ Blue links on white: #1a0dab minimum (4.53:1)                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  1.4.11 Non-text Contrast                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓ UI icons/buttons: 3:1 contrast against background           │   │
│  │ ✓ Form field borders: 3:1 against background fill              │   │
│  │ ✓ Focus indicators: 3:1 against adjacent colors               │   │
│  │ ✓ Status dots: meet 3:1 minimum (green/amber/red on white)     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  1.4.12 Text Spacing                                                   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓ No loss of content when user overrides:                       │   │
│  │   - Line height to 1.5x font size                              │   │
│  │   - Paragraph spacing to 2x font size                           │   │
│  │   - Letter spacing to 0.12x font size                          │   │
│  │   - Word spacing to 0.16x font size                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  OPERABLE                                                            │
│  ═══════════                                                           │
│                                                                         │
│  2.1.1 Keyboard                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓ All interactive elements reachable via Tab/Shift+Tab         │   │
│  │ ✓ Logical tab order follows visual reading order               │   │
│  │ ✓ No keyboard traps (modal has clear Escape dismiss)            │   │
│  │ ✓ Skip navigation link provided ("Skip to main content")        │   │
│  │ ✓ Custom components support keyboard operation                  │   │
│  │ NOTE: Student exam blocks most shortcuts intentionally          │   │
│  │       (this is a security feature, not an accessibility issue)  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  2.1.2 No Keyboard Trap                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓ Modals: focus trapped inside, Escape releases                 │   │
│  │ ✓ Dropdowns: Escape closes, focus returns to trigger            │   │
│  │ ✓ Dialogs: clear mechanism to dismiss and return focus           │   │
│  │ ✓ Student warning modal: focus on "I Understand" button         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  2.4.3 Focus Order                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓ Focus order matches visual/layout order                       │   │
│  │ ✓ In forms: left-to-right, top-to-bottom                        │   │
│  │ ✓ In modals: first focusable element receives focus on open     │   │
│  │ ✓ After modal close: focus returns to triggering element        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  2.4.7 Focus Visible                                                   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓ Focus indicator clearly visible (never outline: none)         │   │
│  │ ✓ Default: 2px solid offset, blue-500 color, radius-sm          │   │
│  │ ✓ Custom focus rings match component design language            │   │
│  │ ✓ Focus indicator has 3:1 contrast against background          │   │
│  │                                                                   │   │
│  │ EXAMPLE FOCUS STYLES:                                            │   │
│  │ ┌─────────────────────────────────────────────────────────────┐ │   │
│  │ │ Button:   ring-2 ring-blue-500 ring-offset-2              │ │   │
│  │ │ Input:    ring-2 ring-blue-500 (default browser enhanced)  │ │   │
│  │ │ Card:     ring-2 ring-blue-500 ring-offset-2              │ │   │
│  │ │ Row:      bg-blue-50 + left border blue-500 (3px)         │ │   │
│  │ │ Menu item:bg-gray-100 + left accent bar                    │ │   │
│  │ │ Tab:      bottom border blue-500 (2px, thick)             │ │   │
│  │ └─────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  2.5.1 Pointer Gestures                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓ All multi-touch gestures have single-pointer alternative      │   │
│  │ ✓ Swipe actions also available as buttons                       │   │
│  │ ✓ Pinch-zoom not required (font-size controls available)        │   │
│  │ ✓ Drag-and-drop has keyboard/text alternative                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  UNDERSTANDABLE                                                      │
│  ═══════════════                                                       │
│                                                                         │
│  3.1.1 Language of Page                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓ <html lang="en"> attribute set                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  3.2.2 On Input                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓ No unexpected context change on input                          │   │
│  │ ✓ Submitting form doesn't navigate away without confirmation     │   │
│  │ ✓ Selecting dropdown doesn't auto-submit form                    │   │
│  │ ✓ Student exam: warnings appear as modals, not context switches  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  3.3.1 Error Identification                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓ Form errors identified in text (not just color/shape)          │   │
│  │ ✓ Error message associated with the problematic field            │   │
│  │ ✓ Error suggestions provided when possible                       │   │
│  │ ✓ Invalid fields receive aria-invalid="true"                    │   │
│  │ ✓ Error summary available at form top (for complex forms)        │   │
│  │                                                                   │   │
│  │ ERROR MESSAGE PATTERN:                                            │   │
│  │ ┌─────────────────────────────────────────────────────────────┐ │   │
│  │ │ ⚠ Email Address                                             │ │   │
│  │ │ ┌─────────────────────────────────────────────────────────┐│ │   │
│  │ │ │ invalid@email                                           ││ │   │
│  │ │ │ ━━━━━━━━━━━━━━━━ (red underline)                       ││ │   │
│  │ │ └─────────────────────────────────────────────────────────┘│ │   │
│  │ │ ⚠ Please enter a valid email address (e.g., name@domain.com)│ │   │
│  │ └─────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ROBUST                                                               │
│  ════════                                                              │
│                                                                         │
│  4.1.2 Name, Role, Value                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓ All custom UI components expose correct ARIA roles            │   │
│  │ ✓ Custom buttons: role="button", tabindex="0"                   │   │
│  │ ✓ Custom checkboxes: role="checkbox", aria-checked              │   │
│  │ ✓ Status badges: role="status", aria-live="polite"              │   │
│  │ ✓ Live dashboard stats: aria-live="polite" for updates          │   │
│  │ ✓ Alert feed: aria-live="assertive" for new critical alerts     │   │
│  │ ✓ Timer: role="timer", aria-atomic="true"                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ARIA IMPLEMENTATION EXAMPLES:                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ <!-- Student Status Badge -->                                    │   │
│  │ <span role="status"                                            │   │
│  │       class="badge badge-warning"                               │   │
│  │       aria-label="Student status: Warned">                     │   │
│  │   🟡 Warned                                                    │   │
│  │ </span>                                                         │   │
│  │                                                                  │   │
│  │ <!-- Proctor Alert Feed Item -->                                │   │
│  │ <div role="article"                                             │   │
│  │      aria-live="assertive"                                      │   │
│  │      aria-atomic="true"                                        │   │
│  │      aria-label="Critical alert: Screen capture by J Smith">   │   │
│  │   ...                                                            │   │
│  │ </div>                                                          │   │
│  │                                                                  │   │
│  │ <!-- Exam Timer -->                                             │   │
│  │ <div role="timer" aria-atomic="true" aria-label="Time remaining: │   │
│  │      1 hour 23 minutes 45 seconds">                             │   │
│  │   01:23:45                                                      │   │
│  │ </div>                                                          │   │
│  │                                                                  │   │
│  │ <!-- Violation Counter -->                                      │   │
│  │ <div role="meter" aria-valuemin="0" aria-valuemax="10"           │   │
│  │      aria-valuenow="3" aria-label="3 of 10 allowed violations">│   │
│  │   3 / 10                                                         │   │
│  │ </div>                                                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 14.2 Screen Reader Experience

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  SCREEN READER OPTIMIZATION                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  LIVE REGION STRATEGY:                                                  │
│  ══════════════════════                                                  │
│                                                                         │
│  Region Type     │ Use Case                          │ Update Frequency│
│  ────────────────┼───────────────────────────────────┼─────────────────│
│  aria-live=off   │ Static content, rarely changes    │ Never           │
│  aria-live=polite│ Stats counters, timer, status     │ When convenient│
│  aria-live=assertive│ New alerts, urgent messages   │ Immediately     │
│                                                                         │
│  IMPLEMENTATIONS:                                                        │
│                                                                         │
│  1. PROCTOR DASHBOARD - NEW ALERT                                       │
│     <div id="alert-feed" aria-live="assertive" aria-relevant="additions">
│       <!-- New alert inserted here, announced immediately -->           │
│     </div>                                                              │
│                                                                         │
│  2. STUDENT EXAM - TIMER UPDATE                                        │
│     <div id="exam-timer" role="timer" aria-live="polite">              │
│       01:23:45                                                           │
│     </div>                                                              │
│     (Updates every second, polite so it doesn't interrupt reading)       │
│                                                                         │
│  3. WARNING MODAL APPEARANCE                                           │
│     <div role="alertdialog" aria-modal="true" aria-labelledby="warn-title"│
│          aria-describedby="warn-message">                               │
│       <h2 id="warn-title">Attention</h2>                                │
│       <p id="warn-message">You have attempted to switch tabs...</p>      │
│       <button>I Understand</button>                                     │
│     </div>                                                              │
│                                                                         │
│  SKIP NAVIGATION:                                                        │
│  ══════════════════                                                      │
│  <a href="#main-content" class="sr-only sr-only-focusable">             │
│     Skip to main content                                                │
│  </a>                                                                  │
│  (Visible on focus only, positioned absolute top-left)                  │
│                                                                         │
│  LANDMARKS:                                                             │
│  ══════════                                                             │
│  <header role="banner">     → Site/app header                           │
│  <nav role="navigation">   → Sidebar nav, breadcrumb                   │
│  <main role="main" id="main-content"> → Primary content area           │
│  <aside role="complementary"> → Alert panel, stats sidebar             │
│  <form role="search">        → Search inputs                            │
│  <footer role="contentinfo"> → Page footer                             │
│                                                                         │
│  VISUALLY HIDDEN (SCREEN READER ONLY) TEXT:                             │
│  ═══════════════════════════════════════════════════════════════════     │
│  .sr-only {                                                            │
│    position: absolute;                                                  │
│    width: 1px; height: 1px; padding: 0; margin: -1px;                  │
│    overflow: hidden;                                                   │
│    clip: rect(0, 0, 0, 0);                                            │
│    white-space: nowrap;                                                │
│    border: 0;                                                          │
│  }                                                                     │
│                                                                         │
│  Usage examples:                                                        │
│  • Status dot: <span class="sr-only">Status: Active</span> 🟢         │
│  • Icon button: <span class="sr-only">Send warning</span> ⚠           │
│  • Badge: <span class="sr-only">5 new alerts</span> (5)               │
│  • Progress: <span class="sr-only">Progress: 80%</span> ████████░░   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 15. Error States & Edge Cases

### 15.1 Error State Specifications

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      ERROR STATE CATALOG                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  E-01: NETWORK DISCONNECTED (Student During Exam)                        │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  EXAM HEADER BAR:                                               │    │
│  │  🔴 Disconnected    IELTS Academic    ⏱ --:--:--    W: --:-- │    │
│  │  (pulsing red dot)   (exam name frozen) (timer paused)          │    │
│  │                                              [🆘] [Retry]     │    │
│  ├─────────────────────────────────────────────────────────────────┤    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  ⚠️ CONNECTION LOST                                      │   │    │
│  │  │                                                         │   │    │
│  │  │  Your internet connection has been interrupted.        │   │    │
│  │  │                                                         │   │    │
│  │  │  Your work is being saved locally. When your             │   │    │
│  │  │  connection returns, everything will sync.             │   │    │
│  │  │                                                         │   │    │
│  │  │  Retrying automatically... (attempt 3 of 10)           │   │    │
│  │  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 30%                 │   │    │
│  │  │                                                         │   │    │
│  │  │  [Retry Now]  [Troubleshoot]                            │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  Behavior:                                                              │
│  • Timer freezes (does not count down during disconnect)                │
│  • Security guard continues running locally (events queued)             │
│  • Auto-retry every 5 seconds (up to 10 attempts = 50 sec)            │
│  • After 10 failures: show extended troubleshooting options             │
│  • Events buffered in IndexedDB/localStorage, batch-send on reconnect  │
│  • If reconnect after > 5 min: require proctor re-authentication       │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  E-02: SERVER ERROR (500) During Exam Start                              │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                                 │    │
│  │            ⚠️ (large amber triangle icon, 64px)                │    │
│  │                                                                 │    │
│  │         Unable to Start Exam                                    │    │
│  │                                                                 │    │
│  │  We're experiencing technical difficulties starting your         │    │
│  │  exam session. This is not your fault.                          │    │
│  │                                                                 │    │
│  │  Error Code: SRV-500-EXAMSTART-0042                             │    │
│  │  Time: 2025-06-15T09:00:12Z                                   │    │
│  │                                                                 │    │
│  │  What you can do:                                               │    │
│  │  1. Wait 30 seconds and try again below                          │    │
│  │  2. Refresh your browser page                                   │    │
│  │  3. Contact support if the problem persists                     │    │
│  │                                                                 │    │
│  │  Reference ID: ERR-ABCD-1234 (provide this to support)          │    │
│  │                                                                 │    │
│  │  [Try Again (29s)]  [Refresh Page]  [Contact Support]           │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  • Auto-countdown retry button (counts down from 30s)                  │
│  • Error code visible for support reference                            │
│  • Retry uses exponential backoff (30s, 60s, 120s)                    │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  E-03: BROWSER INCOMPATIBLE                                            │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                                 │    │
│  │            🚫 (prohibited icon, 64px, red)                     │    │
│  │                                                                 │    │
│  │         Browser Not Supported                                  │    │
│  │                                                                 │    │
│  │  Your current browser (Internet Explorer 11) does not meet       │    │
│  │  the security requirements for this examination.               │    │
│  │                                                                 │    │
│  │  Required: Google Chrome 90+, Mozilla Firefox 88+,              │    │
│  │            Microsoft Edge 90+, Safari 14+ (macOS only)          │    │
│  │                                                                 │    │
│  │  Your browser: Internet Explorer 11.0                           │    │
│  │  Detected issues:                                              │    │
│  │  ✗ JavaScript ES6 not supported                                │    │
│  │  ✗ Fullscreen API not available                                 │    │
│  │  ✗ Clipboard API blocked                                       │    │
│  │  ✗ Modern security features missing                             │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  Download Chrome    Download Firefox    Download Edge    │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  After installing a supported browser, return to this page:    │    │
│  │  ielts.example.com/exam/start                                 │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  E-04: SESSION EXPIRED / EXAM ALREADY SUBMITTED                          │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                                 │    │
│  │            ℹ️ (info icon, 64px, blue)                         │    │
│  │                                                                 │    │
│  │         Session No Longer Available                             │    │
│  │                                                                 │    │
│  │  This exam session has already been completed or expired.        │    │
│  │                                                                 │    │
│  │  Session Status: COMPLETED                                      │    │
│  │  Completed At: June 15, 2025 at 11:42:17 AM                    │    │
│  │                                                                 │    │
│  │  If you believe this is an error, contact your exam             │    │
│  │  administrator with your candidate ID.                          │    │
│  │                                                                 │    │
│  │  [Return to Home]  [Contact Support]                             │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  E-05: PROCTOR DASHBOARD - WEBSOCKET DISCONNECT                          │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  HEADER BAR CHANGES:                                             │    │
│  │  🟢 LIVE → 🔴 DISCONNECTED (flashing, pulsing red)              │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐   │    │
│  │  │  ⚠️ Real-time Connection Lost                             │   │    │
│  │  │                                                         │   │    │
│  │  │  You are viewing stale data. Student statuses may not     │   │    │
│  │  │  reflect their current state.                             │   │    │
│  │  │                                                         │   │    │
│  │  │  Last update: 14:32:05 (45 seconds ago)                 │   │    │
│  │  │  Attempting to reconnect... (attempt 2 of ∞)            │   │    │
│  │  │                                                         │   │    │
│  │  │  [Reconnect Now]                                         │   │    │
│  │  └─────────────────────────────────────────────────────────┘   │    │
│  │                                                                 │    │
│  │  GRID OVERLAY: Semi-transparent wash + "Connection Lost" stamp  │    │
│  │  Student cards show last-known state with faded appearance       │    │
│  │  Action buttons disabled (cannot send commands while offline)     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  E-06: CONCURRENT LOGIN DETECTED                                        │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ⚠️ (shield icon, amber)                                        │    │
│  │                                                                 │    │
│  │  Multiple Sessions Detected                                     │    │
│  │                                                                 │    │
│  │  This account is currently active in another browser or device.  │    │
│  │  For exam security, only one session is permitted at a time.     │    │
│  │                                                                 │    │
│  │  Other session details:                                         │    │
│  │  • IP Address: 198.51.100.23                                    │    │
│  │  • Browser: Chrome 120 on Windows                               │    │
│  │  • Started at: 09:00:03 AM                                     │    │
│  │                                                                 │    │
│  │  What would you like to do?                                     │    │
│  │  [Terminate Other Session & Continue Here]  (danger button)      │    │
│  │  [End This Session]  (secondary)                                │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  E-07: EXAM TIME EXPIRED (Auto-Submit Triggered)                        │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  (Fullscreen overlay, cannot be dismissed)                       │    │
│  │                                                                 │    │
│  │  ⏰ (clock icon, large, 80px)                                  │    │
│  │                                                                 │    │
│  │  Time's Up!                                                     │    │
│  │                                                                 │    │
│  │  Your exam time has expired. Your answers are being submitted    │    │
│  │  automatically.                                                 │    │
│  │                                                                 │    │
│  │  Submitting your exam...                                        │    │
│  │  ████████████████████░░░░░░  73%                               │    │
│  │                                                                 │    │
│  │  Please do not close this window.                               │    │
│  │                                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  Then transitions to success screen (S-006) after submission completes  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 15.2 Empty State Designs

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      EMPTY STATE DESIGNS                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ES-01: NO ACTIVE EXAMS (Proctor Home)                                  │
│  ────────────────────────────────────────────────────                   │
│                                                                         │
│            ┌──────────────────────┐                                     │
│            │                      │                                     │
│            │   📋 (illustration)  │  → 80px, gray-300                  │
│            │                      │                                     │
│            └──────────────────────┘                                     │
│                                                                         │
│         No Active Exam Sessions                                         │
│                                                                         │
│      There are no exam sessions currently scheduled                    │
│      for monitoring. Check back later or create a new                  │
│      exam session.                                                     │
│                                                                         │
│      [Create Exam Session]  [Refresh]                                  │
│                                                                         │
│  ES-02: NO SEARCH RESULTS                                              │
│  ─────────────────────────────                                         │
│                                                                         │
│            🔍 (search icon, 64px, gray-300)                            │
│                                                                         │
│         No Results Found                                               │
│                                                                         │
│      No sessions match your search criteria "xyz".                     │
│                                                                         │
│      Suggestions:                                                       │
│      • Check your spelling for typos                                  │
│      • Try fewer or different search terms                             │
│      • Clear all filters and try again                                 │
│                                                                         │
│      [Clear Search]  [Clear Filters]                                   │
│                                                                         │
│  ES-03: NO VIOLATIONS (Clean Session Review)                            │
│  ─────────────────────────────────────────────                           │
│                                                                         │
│            ✅ (check-circle, 64px, green-400)                           │
│                                                                         │
│         Clean Session Record                                            │
│                                                                         │
│      This session completed with zero recorded violations.              │
│      The student followed all exam protocols correctly.                │
│                                                                         │
│      Session Summary:                                                   │
│      • Duration: 2h 41m 12s                                           │
│      • Questions answered: 39/40                                       │
│      • Warnings received: 0                                            │
│      • Pauses: 0                                                       │
│                                                                         │
│      [Mark as Clean & Close]  [Export Report]                           │
│                                                                         │
│  ES-04: NO ALERTS (Quiet Monitoring Session)                            │
│  ─────────────────────────────────────────────                           │
│                                                                         │
│            🎉 (party popper? No — too casual)                           │
│            ✅ (check-circle, 48px, green-400)                           │
│                                                                         │
│         All Clear!                                                     │
│                                                                         │
│      No alerts in the past 30 minutes. All students                   │
│      are actively engaged in their exams without issues.              │
│                                                                         │
│      Keep up the good work!                                            │
│                                                                         │
│  (Subtle, non-distracting — proctor shouldn't need to act)             │
│                                                                         │
│  ES-05: NO STUDENTS ASSIGNED TO EXAM                                    │
│  ─────────────────────────────────────────────                           │
│                                                                         │
│            👥 (users icon, 64px, gray-300)                              │
│                                                                         │
│         No Students Enrolled                                           │
│                                                                         │
│      This exam session has no students assigned yet.                   │
│      Students will appear here once they are enrolled.                │
│                                                                         │
│      [Enroll Students]  [Import from CSV]  [Manage Enrollment]         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 16. Design Asset Deliverables

### 16.1 Design File Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DESIGN ASSET DELIVERABLES                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  FILE ORGANIZATION (Figma / Design Tool)                                │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  📁 IELTS-Proctor-System/                                             │
│  ├── 📁 00-Design-System/                                             │
│  │   ├── 📄 Tokens.json          (design tokens export)                │
│  │   ├── 📁 Colors/              (all color swatches)                  │
│  │   ├── 📁 Typography/          (text styles)                         │
│  │   ├── 📁 Spacing/             (spacing scale visual)                │
│  │   ├── 📁 Shadows/             (shadow presets)                      │
│  │   ├── 📁 Radius/              (border radius values)                │
│  │   └── 📁 Icons/               (all SVG icons, Lucide library)       │
│  │                                                                │
│  ├── 📁 01-Components/                                                │
│  │   ├── 📁 Buttons/            (all variants × sizes × states)      │
│  │   ├── 📁 Inputs/             (text, select, textarea, toggle)       │
│  │   ├── 📁 Cards/              (student card, stat card, rule card)  │
│  │   ├── 📁 Badges/             (status, severity, tags)              │
│  │   ├── 📁 Tables/             (data table, compact, expanded)        │
│  │   ├── 📁 Modals/             (warning, confirm, create, edit)       │
│  │   ├── 📁 Alerts/             (toast, inline, banner)                │
│  │   ├── 📁 Navigation/         (sidebar, tabs, breadcrumbs, pagin.)  │
│  │   ├── 📁 Charts/             (bar, pie, line - if using)           │
│  │   └── 📁 Loaders/            (spinner, skeleton, shimmer)           │
│  │                                                                │
│  ├── 📁 02-Student-Flows/                                            │
│  │   ├── 📄 S-001-Login.figma                                         │
│  │   ├── 📄 S-002-PreCheck.figma                                      │
│  │   ├── 📄 S-003-Lobby.figma                                         │
│  │   ├── 📄 S-004-ExamInterface.figma                                 │
│  │   ├── 📄 S-005-WarningModal.figma                                  │
│  │   └── 📄 S-006-Completion.figma                                    │
│  │                                                                │
│  ├── 📁 03-Proctor-Dashboard/                                        │
│  │   ├── 📄 P-001-ExamSelection.figma                                │
│  │   ├── 📄 P-002-LiveDashboard.figma                                 │
│  │   ├── 📄 P-003-StudentDetail.figma                                │
│  │   ├── 📄 P-004-SendWarning.figma                                   │
│  │   ├── 📄 P-005-TerminateConfirm.figma                              │
│  │   └── 📄 P-006-AlertSettings.figma                                 │
│  │                                                                │
│  ├── 📁 04-Admin-Panel/                                              │
│  │   ├── 📄 A-001-LayoutShell.figma                                  │
│  │   ├── 📄 A-002-RuleManagement.figma                               │
│  │   ├── 📄 A-003-SessionManagement.figma                             │
│  │   └── 📄 A-004-UserManagement.figma                               │
│  │                                                                │
│  ├── 📁 05-Review-Reports/                                           │
│  │   ├── 📄 R-001-SessionReport.figma                                │
│  │   └── 📄 R-002-ExportModal.figma                                  │
│  │                                                                │
│  ├── 📁 06-States-&-Edge-Cases/                                      │
│  │   ├── 📄 Error-States.figma                                       │
│  │   ├── 📁 Empty-States/                                           │
│  │   ├── 📁 Loading-States/                                         │
│  │   └── 📁 Success-States/                                         │
│  │                                                                │
│  └── 📁 07-Assets/                                                    │
│      ├── 📁 Illustrations/      (empty states, error illustrations)   │
│      ├── 📁 Avatars/            (placeholder avatar set)              │
│      ├── 📁 Logos/              (IELTS Proctor logo variants)        │
│      └── 📁 Backgrounds/        (patterns, gradients)                │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  NAMING CONVENTIONS                                                 │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  Components: {Component}_{Variant}_{Size}_{State}                       │
│  Example: Button_Primary_md_Hover, Card_Student_Warned_Selected        │
│                                                                         │
│  Screens: {PageID}-{ScreenName}-{Variant}                              │
│  Example: S-004-ExamInterface-Fullscreen, P-002-LiveDashboard-Alert   │
│                                                                         │
│  Tokens: {Category}-{Property}-{Variant}                               │
│  Example: color-primary-500, font-size-base, space-4                  │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  VERSION CONTROL                                                      │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  Major version changes: Breaking component/API changes                  │
│  Minor version changes: New components, screen additions                │
│  Patch version changes: Bug fixes, minor tweaks                        │
│                                                                         │
│  Current Version: v1.0.0                                               │
│                                                                         │
│  Changelog maintained in /CHANGELOG.md within design files             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 16.2 Developer Handoff Checklist

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DEVELOPER HANDOFF CHECKLIST                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  DESIGN TOKENS (for Tailwind / Styled Components / CSS Variables):       │
│  ─────────────────────────────────────────────────────                  │
│  ☐ Colors: All hex values with semantic names exported                  │
│  ☐ Typography: Font families, sizes, weights, line heights             │
│  ☐ Spacing: 4px-based scale (0-24)                                    │
│  ☐ Border radii: Named values (sm, md, lg, xl, 2xl, full)            │
│  ☐ Shadows: Named presets (xs, sm, md, lg, xl, inner)                 │
│  ☐ Transitions: Duration and easing function tokens                    │
│  ☐ Z-index: Named scale (dropdown through tooltip)                     │
│                                                                         │
│  COMPONENT SPECS:                                                       │
│  ────────────────────                                                   │
│  ☐ Button: All 5 variants × 3 sizes × 5 states = 75 specs            │
│  ☐ Input: Default, error, success, disabled, with-icon states          │
│  ☐ Card: Student card (6 status states), stat card, rule card          │
│  ☐ Modal: Sizes (sm/md/lg/xl/full), types (confirm/warning/form)       │
│  ☐ Table: Standard, compact, with expansion, with selection           │
│  ☐ Badge: Status (6), severity (4), tag (default)                     │
│  ☐ Toast: 4 severity levels, with/without action button               │
│                                                                         │
│  ICON ASSETS:                                                           │
│  ─────────────                                                           │
│  ☐ SVG sprite sheet or individual SVG files                            │
│  ☐ Optimized (SVGO minified)                                          │
│  ☐ Named consistently with design system                               │
│  ☐ 16px, 20px, 24px variants where applicable                        │
│                                                                         │
│  SCREEN MOCKUPS:                                                        │
│  ────────────────                                                       │
│  ☐ All screens listed in Sections 8-11 designed at target resolution    │
│  ☐ Responsive breakpoints shown (mobile/tablet/desktop/large)          │
│  ☐ Interactive prototypes linked (Figma prototype / Principle)          │
│  ☐ Annotation layer with:                                             
# 🎨 IELTS Proctoring System — UI/UX Design Specification Document (Continued)

---

## 16. Design Asset Deliverables (Continued)

### 16.2 Developer Handoff Checklist (Continued)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DEVELOPER HANDOFF CHECKLIST (CONT.)                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SCREEN MOCKUPS (continued):                                           │
│  ────────────────────────────                                          │
│  ☐ Student flow: S-001 through S-006 (6 screens)                      │
│  ☐ Proctor dashboard: P-001 through P-006 (6 screens)                  │
│  ☐ Admin panel: A-001 through A-004 (4 screens)                       │
│  │ Review & reports: R-001, R-002 (2 screens)                        │
│  ☐ Error states: E-01 through E-07 (7 screens)                       │
│  ☐ Empty states: ES-01 through ES-05 (5 screens)                     │
│                                                                         │
│  INTERACTION SPECS:                                                     │
│  ─────────────────                                                      │
│  ☐ Hover states documented for all interactive elements               │
│  ☐ Focus states with ring specifications                              │
│  ☐ Loading/skeleton states for each component type                    │
│  ☐ Disabled state appearance                                          │
│  ☐ Animation timing and easing functions (from Section 12)           │
│  ☐ Micro-interaction catalog reference                                │
│                                                                         │
│  RESPONSIVE SPECIFICATIONS:                                            │
│  ──────────────────────────────                                        │
│  ☐ Breakpoint behavior matrix (Section 13.1)                           │
│  ☐ Tablet adaptation layouts for proctor dashboard                    │
│  ☐ Mobile admin panel (sidebar collapse, table scroll)                │
│  ☐ Touch target sizes (minimum 44px)                                  │
│                                                                         │
│  ACCESSIBILITY EXPORTS:                                                │
│  ───────────────────────                                               │
│  ☐ Contrast ratio report (all text/background combos pass WCAG AA)   │
│  ☐ ARIA attribute annotations on key components                      │
│  ☐ Screen reader testing notes / expected behaviors                   │
│  ☐ Keyboard navigation order diagrams                                 │
│  ☐ Focus indicator style guide                                        │
│  ☐ Reduced-motion fallback specifications                             │
│                                                                         │
│  ASSET PACKAGE:                                                         │
│  ───────────────                                                        │
│  ☐ Exported SVG icons (individual files + sprite)                     │
│  ☐ Logo files (SVG, PNG @1x, @2x, @3x)                               │
│  ☐ Illustration assets (empty states, errors) in PNG/SVG             │
│  ☐ Placeholder avatar images (various colors/initials)               │
│  ☐ Favicon and touch icon set                                         │
│  ☐ Web font files (Inter, JetBrains Mono - woff2 format)              │
│                                                                         │
│  DOCUMENTATION:                                                         │
│  ─────────────                                                          │
│  ☐ This design spec document (PDF + living doc link)                  │
│  ☐ Component usage guidelines (do's and don'ts)                       │
│  ☐ Content strategy (copy tone, message hierarchy)                    │
│  ☐ Brand guidelines (if separate from this system)                    │
│  ☐ Changelog from any previous version                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 16.3 Annotation Guide for Design Files

```
┌─────────────────────────────────────────────────────────────────────────┐
│                 DESIGN FILE ANNOTATION STANDARDS                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ANNOTATION LAYER STRUCTURE:                                            │
│  ══════════════════════════                                             │
│                                                                         │
│  Each screen/frame should have an annotation layer containing:          │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  ┌───────────────────────────────────────────────────────────┐ │   │
│  │  │  FRAME INFO (top-left corner of every frame)            │ │   │
│  │  │                                                           │ │   │
│  │  │  Frame: S-004-ExamInterface                            │ │   │
│  │  │  Size: 1920 × 1080 px                                   │ │   │
│  │  │  Background: #FFFFFF                                    │ │   │
│  │  │  Status: Ready for Development ✅                        │ │   │
│  │  └───────────────────────────────────────────────────────────┘ │   │
│  │                                                                 │   │
│  │  ┌───────────────────────────────────────────────────────────┐ │   │
│  │  │  COMPONENT CALLouts (pointing to specific elements)       │ │   │
│  │  │                                                           │ │   │
│  │  │  ┌─────┐                                                   │ │   │
│  │  │  │ [A] │←── Button_Primary_lg_Default                   │ │   │
│  │  │  └─────┘                                                   │ │   │
│  │  │         Spec: See Component Library → Buttons             │ │   │
│  │  │                                                           │ │   │
│  │  │  ┌─────┐                                                   │ │   │
│  │  │  │ [B] │←── Card_Student_Warned                          │ │   │
│  │  │  └─────┘                                                   │ │   │
│  │  │         Data: Dynamic from API /sessions/:id              │ │   │
│  │  │         States: Active/Warned/Paused/Terminated/Idle      │ │   │
│  │  │                                                           │ │   │
│  │  │  ┌─────┐                                                   │ │   │
│  │  │  │ [C] │←── Text_Timer_Mono_xl                             │ │   │
│  │  │  └─────┘                                                   │ │   │
│  │  │         Font: JetBrains Mono, 20px, bold                   │ │   │
│  │  │         Color: gray-900 → amber-600 (<10min) → red-600    │ │   │
│  │  │                                                           │ │   │
│  │  └───────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ANNOTATION COLOR CODING:                                              │
│  ════════════════════════                                              │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Type           │ Line Color     │ Usage                        │   │
│  │  ───────────────┼────────────────┼─────────────────────────────│   │
│  │  Component Ref  │ Blue (#2066B0) │ Points to reusable comp     │   │
│  │  Data Source    │ Green (#169E58)│ Indicates dynamic data      │   │
│  │  Interaction    │ Amber (#E69100)│ Hover/click/state change    │   │
│  │  Note/Comment   │ Gray (#6B7280) │ General implementation note│   │
│  │  Warning        │ Red (#DC2626)  │ Important caveat/gotcha    │   │
│  │  Accessibility  │ Purple (#7C3AED)│ ARIA/keyboard/a11y note    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  MEASUREMENT ANNOTATIONS:                                               │
│  ══════════════════════════                                             │
│                                                                         │
│  • Show dimensions for non-standard spacing                             │
│  • Animate padding/margin when different from design token values       │
│  • Note max/min widths for responsive containers                        │
│  • Call out fixed vs fluid dimensions                                   │
│                                                                         │
│  EXAMPLE ANNOTATION:                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │  ┌─────────────────────────────────┐                             │   │
│  │  │         Student Grid Area        │ ← min-width: 900px       │   │
│  │  │         (flex-grow: 1)          │   gap: 16px               │   │
│  │  │                                 │   grid-template-columns:  │   │
│  │  │  ┌─────┐ ┌─────┐ ┌─────┐      │   repeat(auto-fill,       │   │
│  │  │  │Card │ │Card │ │Card │      │   minmax(200px, 1fr))    │   │
│  │  │  │w:200│ │w:200│ │w:200│      │                             │   │
│  │  │  └─────┘ └─────┘ └─────┘      │                             │   │
│  │  └─────────────────────────────────┘                             │   │
│  │                                                                  │   │
│  │  ↑ Scrollable vertically if overflow                             │   │
│  │  max-height: calc(100vh - 280px)                               │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 17. Implementation Notes for Developers

### 17.1 CSS Architecture Recommendation

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  CSS ARCHITECTURE RECOMMENDATION                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  RECOMMENDED APPROACH: Utility-First (Tailwind CSS) + Component Layer   │
│  ══════════════════════════════════════════════════════════════════════  │
│                                                                         │
│  WHY TAILWIND?                                                          │
│  • Design tokens map directly to Tailwind config                         │
│  • Rapid prototyping matches design system tokens exactly               │
│  • Built-in responsive, hover, focus, dark mode variants               │
│  • Tree-shaking removes unused styles in production                    │
│  • Consistent with modern React/Vue component development              │
│                                                                         │
│  PROJECT STRUCTURE:                                                     │
│  ══════════════════                                                     │
│                                                                         │
│  src/                                                                   │
│  ├── styles/                                                            │
│  │   ├── globals.css              /* CSS custom properties */          │
│  │   ├── tailwind.config.js        /* Design token config */           │
│  │   └── animations.css           /* Keyframe definitions */          │
│  │                                                                   │
│  ├── components/                                                        │
│  │   ├── ui/                     /* Base UI components */              │
│  │   │   ├── Button/                                                  │
│  │   │   ├── Input/                                                   │
│  │   │   ├── Card/                                                    │
│  │   │   ├── Modal/                                                   │
│  │   │   ├── Badge/                                                   │
│  │   │   ├── Table/                                                   │
│  │   │   ├── Alert/                                                   │
│  │   │   └── Toast/                                                   │
│  │   │                                                               │
│  │   ├── layout/                 /* Layout components */              │
│  │   │   ├── Sidebar/                                                 │
│  │   │   ├── HeaderBar/                                               │
│  │   │   ├── StatsBar/                                                │
│  │   │   └── DetailPanel/                                             │
│  │   │                                                               │
│  │   └── domain/                 /* Domain-specific components */     │
│  │       ├── StudentCard/                                             │
│  │       ├── ViolationBadge/                                          │
│  │       ├── ExamTimer/                                               │
│  │       ├── ActivityTimeline/                                        │
│  │       ├── AlertFeedItem/                                           │
│  │       └── SessionStatusIndicator/                                  │
│  │                                                                   │
│  └── pages/                                                            │
│      ├── student/                                                       │
│      │   ├── LoginPage.tsx                                              │
│      │   ├── PreCheckPage.tsx                                          │
│      │   ├── LobbyPage.tsx                                             │
│      │   └── ExamPage.tsx                                              │
│      │                                                                │
│      ├── proctor/                                                       │
│      │   ├── ExamSelectPage.tsx                                        │
│      │   └── DashboardPage.tsx                                         │
│      │                                                                │
│      └── admin/                                                        │
│          ├── SessionsPage.tsx                                          │
│          ├── RulesPage.tsx                                             │
│          ├── UsersPage.tsx                                             │
│          └── ReviewPage.tsx                                            │
│                                                                         │
│  TAILWIND CONFIG (key sections):                                        │
│  ═══════════════════════════════                                       │
│                                                                         │
│  // tailwind.config.js (excerpt)                                        │
│  module.exports = {                                                      │
│    theme: {                                                             │
│      colors: {                                                           │
│        // Map directly to design token colors                            │
│        primary: {                                                       │
│          50: '#E8F2FC',                                                 │
│          500: '#1A508B',                                                │
│          600: '#2066B0',                                                │
│          700: '#143A66',                                                │
│        },                                                              │
│        success: { 50: '#E0F9EC', 500: '#169E58', 600: '#117A44' },     │
│        warning: { 50: '#FFF8E1', 500: '#E69100', 600: '#B36B00' },     │
│        danger:  { 50: '#FFEBEE', 500: '#E53935', 600: '#C42020' },     │
│        // ... full palette                                               │
│      },                                                                │
│                                                                         │
│      fontFamily: {                                                       │
│        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont',           │
│                 'Segoe UI', 'Roboto', 'sans-serif'],                    │
│        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code',           │
│                'Consolas', 'monospace'],                                │
│      },                                                                │
│                                                                         │
│      fontSize: {                                                         │
│        xs: ['0.75rem', { lineHeight: '1rem' }],     // 12px           │
│        sm: ['0.875rem', { lineHeight: '1.5' }],    // 14px           │
│        base: ['1rem', { lineHeight: '1.5' }],       // 16px           │
│        lg: ['1.125rem', { lineHeight: '1.5' }],     // 18px           │
│        xl: ['1.25rem', { lineHeight: '1.4' }],      // 20px           │
│        '2xl': ['1.5rem', { lineHeight: '1.3' }],     // 24px           │
│        '3xl': ['1.875rem', { lineHeight: '1.25' }],  // 30px           │
│        '4xl': ['2.25rem', { lineHeight: '1.2' }],     // 36px           │
│      },                                                                │
│                                                                         │
│      spacing: {                                                          │
│        '0': '0', 'px': '1px',                                         │
│        '0.5': '0.125rem',   // 2px                                     │
│        '1': '0.25rem',     // 4px                                     │
│        '2': '0.5rem',      // 8px                                     │
│        '3': '0.75rem',     // 12px                                    │
│        '4': '1rem',        // 16px                                    │
│        '5': '1.25rem',     // 20px                                    │
│        '6': '1.5rem',      // 24px                                    │
│        '8': '2rem',        // 32px                                    │
│        '10': '2.5rem',     // 40px                                    │
│        '12': '3rem',      // 48px                                    │
│        '16': '4rem',      // 64px                                    │
│        '20': '5rem',      // 80px                                    │
│        '24': '6rem',      // 96px                                    │
│      },                                                                │
│                                                                         │
│      borderRadius: {                                                     │
│        none: '0', sm: '0.25rem', md: '0.375rem',                       │
│        lg: '0.5rem', xl: '0.75rem', '2xl': '1rem', full: '9999px',   │
│      },                                                                │
│                                                                         │
│      boxShadow: {                                                        │
│        xs: '0 1px 2px rgba(0,0,0,0.05)',                               │
│        sm: '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)',  │
│        md: '0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06)',│
│        lg: '0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05)',│
│        xl: '0 20px 25px rgba(0,0,0,0.1), 0 10px 10px rgba(0,0,0,0.04)',│
│        inner: 'inset 0 2px 4px rgba(0,0,0,0.06)',                       │
│      },                                                                │
│                                                                         │
│      extend: {                                                           │
│        animation: {                                                      │
│          'fade-in': 'fadeIn 200ms ease-out',                            │
│          'slide-up': 'slideUp 300ms cubic-bezier(0.32,0.72,0,1)',      │
│          'scale-in': 'scaleIn 200ms ease-out',                          │
│          'shimmer': 'shimmer 1.5s ease-in-out infinite',                │
│          'pulse-alert': 'pulse 1s ease-in-out 3',                      │
│          'spin-slow': 'spin 800ms linear infinite',                     │
│          'shake': 'shake 400ms ease-in-out',                            │
│        },                                                              │
│        keyframes: { /* all keyframes from Section 12.2 */ },           │
│      },                                                                │
│    },                                                                  │
│  };                                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 17.2 Component API Patterns

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   COMPONENT API PATTERNS (React Example)                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  BUTTON COMPONENT                                                     │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  <Button                                                                    │
│    variant="primary" | "secondary" | "danger" | "ghost" | "outline"         │
│    size="sm" | "md" | "lg"                                               │
│    isLoading={boolean}                                                     │
│    isDisabled={boolean}                                                    │
│    leftIcon={ReactNode}                                                    │
│    rightIcon={ReactNode}                                                   │
│    fullWidth={boolean}                                                     │
│    onClick={handler}                                                       │
│    type="button" | "submit" | "reset"                                      │
│  >                                                                        │
│    {children}                                                             │
│  </Button>                                                                │
│                                                                         │
│  Usage Examples:                                                          │
│  <Button variant="primary" size="lg" fullWidth onClick={startExam}>       │
│    ▶ Start My Exam                                                       │
│  </Button>                                                                │
│                                                                         │
│  <Button variant="danger" size="sm" isLoading={isTerminating}>            │
│    Terminating...                                                         │
│  </Button>                                                                │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  STUDENT CARD COMPONENT (Proctor Dashboard)                               │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  <StudentCard                                                               │
│    student={{                                                              │
│      sessionId: string,                                                    │
│      studentId: string,                                                    │
│      name: string,                                                         │
│      initials: string,        // For avatar (JD, AS, etc.)               │
│      avatarColor: string,     // Deterministic from ID                   │
│      status: 'active' | 'warned' | 'paused' | 'terminated' | 'idle',    │
│      currentSection: string,  // "Listening", "Reading", "Writing"       │
│      timeRemaining: number,    // Seconds remaining                      │
│      violationCount: number,                                                 │
│      warningCount: number,                                                  │
│      lastActivity: string,    // ISO timestamp                           │
│      isIdle: boolean,                                                        │
│      idleSeconds: number,                                                    │
│    }}                                                                       │
│    isSelected={boolean}                                                    │
│    onClick={handler}           // Opens detail panel                     │
│    onQuickAction={handler}     // Context menu or quick action bar       │
│  />                                                                        │
│                                                                         │
│  Internal rendering based on status:                                     │
│  • Top border color = statusColors[status] (3px)                         │
│  • Status dot color + pulse animation if warned/paused                  │
│  • Timer turns amber if <10min, red if <5min                            │
│  • Violation count shows badge if > 0                                   │
│  • Selected state: ring-2 ring-blue-500 ring-offset-2                   │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  ALERT FEED ITEM COMPONENT                                              │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  <AlertFeedItem                                                             │
│    alert={{                                                                 │
│      id: string,                                                             │
│      severity: 'low' | 'medium' | 'high' | 'critical',                     │
│      ruleName: string,                                                       │
│      studentName: string,                                                    │
│      studentId: string,                                                      │
│      sessionId: string,                                                      │
│      timestamp: string,         // ISO timestamp                           │
│      summary: string,          // Human-readable description              │
│      isAcknowledged: boolean,                                                │
│    }}                                                                        │
│    onViewSession={handler}       // Navigate to student detail             │
│    onAcknowledge={handler}       // Mark as read                          │
│    isCompact={boolean}           // Show reduced info                     │
│  />                                                                        │
│                                                                         │
│  Severity visual treatment:                                               │
│  • Critical: Red left border (4px) + red bg tint + bold text            │
│  • High: Orange left border (3px) + amber bg tint                       │
│  • Medium: Amber left border (2px) + subtle amber bg                    │
│  • Low: Gray left border (1px), no background tint                     │
│  • New/unacknowledged: Subtle pulse animation on border               │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  WARNING MODAL (Student-Facing)                                          │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  <WarningModal                                                               │
│    isOpen={boolean}                                                         │
│    severity="medium" | "high" | "critical"                                  │
│    title={string}                                                           │
│    message={string}                                                         │
│    ruleName={string}                                                        │
│    violationCount={number}                                                  │
│    timestamp={string}                                                       │
│    autoDismissSeconds={number}  // 0 = no auto-dismiss                    │
│    requireAcknowledgment={boolean}                                         │
│    onAcknowledge={handler}                                                 │
│    onAutoDismiss={handler}        // Called if countdown expires          │
│  />                                                                        │
│                                                                         │
│  Behavior:                                                                │
│  • Blocks interaction with exam content behind it                         │
│  • Escape key and click-outside are DISABLED (intentional)              │
│  • Auto-dismiss countdown shown as progress text                         │
│  • On acknowledge: closes modal, sends event to server                  │
│  • On auto-dismiss: calls onAutoDismiss, then closes                   │
│  • If critical: no acknowledge button, shows "waiting for proctor"      │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  EXAM TIMER COMPONENT                                                   │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  <ExamTimer                                                                  │
│    totalSeconds={number}         // Initial time (e.g., 9900 for 2h45m) │
│    isPaused={boolean}                                                       │
│    isFrozen={boolean}          // True during disconnect                  │
│    onWarningThreshold={handler}  // Called at 10min remaining             │
│    onCriticalThreshold={handler} // Called at 5min remaining             │
│    onExpire={handler}            // Called when timer reaches 0          │
│  />                                                                        │
│                                                                         │
│  Visual states:                                                           │
│  • Normal (>10min): gray-900 text, no animation                          │
│  • Warning (≤10min): amber-600 text, subtle pulse animation             │
│  • Critical (≤5min): red-600 text, faster pulse animation              │
│  • Frozen/disconnected: "--:--:--" text, gray-400                       │
│  • Paused: shows paused state with duration frozen                      │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  ACTIVITY TIMELINE COMPONENT (Review Page)                               │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  <ActivityTimeline                                                          │
│    events={[                                                                 │
│      id: string,                                                             │
│      timestamp: string,                                                      │
│      eventType: EventType enum,                                             │
│      data: object,          // Event-specific payload                     │
│      isViolation: boolean,                                                   │
│      severity?: Severity enum,                                              │
│      ruleName?: string,                                                      │
│    ]}                                                                        │
│    filterByType={EventType[]}                                               │
│    filterBySeverity={Severity[]}                                            │
│    searchQuery={string}                                                     │
│    isPlaying={boolean}                                                      │
│    playbackSpeed={0.5 | 1 | 2 | 5}                                        │
│    onEventClick={handler}       // Show event detail                     │
│    onJumpToTime={handler}       // Seek timeline to specific point        │
│  />                                                                        │
│                                                                         │
│  Features:                                                                │
│  • Virtual scrolling for large event lists (10k+ events)                 │
│  • Playback mode: auto-scrolls with highlight position                 │
│  • Event grouping: adjacent same-type events can be collapsed           │
│  • Violation events highlighted with severity-colored left border      │
│  • Time markers at section boundaries (L→R→W transitions)              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 17.3 Internationalization (i18n) Considerations

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  INTERNATIONALIZATION (i18n) NOTES                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  CURRENT SCOPE: English only (Phase 1)                                  │
│  FUTURE: Multi-language support for global IELTS centers                 │
│                                                                         │
│  TEXT CATEGORIZATION FOR TRANSLATION:                                   │
│  ═════════════════════════════════════════                             │
│                                                                         │
│  STATIC UI STRINGS (extract to i18n keys):                             │
│  ─────────────────────────────────────────                              │
│                                                                         │
│  {                                                                      │
│    "common": {                                                          │
│      "save": "Save",                                                    │
│      "cancel": "Cancel",                                                │
│      "delete": "Delete",                                                │
│      "edit": "Edit",                                                    │
│      "close": "Close",                                                  │
│      "back": "Back",                                                    │
│      "next": "Next",                                                    │
│      "previous": "Previous",                                            │
│      "search": "Search",                                                │
│      "filter": "Filter",                                                │
│      "export": "Export",                                                │
│      "loading": "Loading...",                                            │
│      "noData": "No data available",                                     │
│      "error": "Something went wrong",                                   │
│      "retry": "Retry",                                                  │
│      "confirm": "Confirm",                                              │
│      "submit": "Submit",                                                │
│    },                                                                   │
│                                                                         │
│    "student": {                                                         │
│      "login.title": "Sign in to your exam account",                     │
│      "login.email": "Email address",                                    │
│      "login.password": "Password",                                      │
│      "login.rememberMe": "Remember me for 30 days",                     │
│      "login.forgotPassword": "Forgot password?",                         │
│      "login.signIn": "Sign In",                                        │
│                                                                         │
│      "precheck.title": "System Compatibility Check",                    │
│      "precheck.running": "Running system checks...",                     │
│      "precheck.passed": "All checks passed",                            │
│      "precheck.failed": "Some checks failed",                            │
│      "precheck.retry": "Retry Checks",                                  │
│      "precheck.continue": "Continue to Exam",                           │
│                                                                         │
│      "lobby.ready": "You're ready to begin!",                           │
│      "lobby.startExam": "Start My Exam",                                │
│      "lobby.agreement": "By clicking Start, you agree...",              │
│                                                                         │
│      "exam.help": "Help",                                                │
│      "exam.submit": "Submit Exam",                                      │
│      "exam.confirmSubmit": "Confirm Exam Submission",                    │
│                                                                         │
│      "warning.title": "Attention",                                     │
│      "warning.understand": "I Understand",                              │
│      "warning.autoDismiss": "This modal will auto-dismiss in:",         │
│                                                                         │
│      "complete.thankYou": "Thank you for completing your exam",        │
│      "complete.sessionRef": "Session Reference:",                       │
│      "complete.closeWindow": "Close Window",                            │
│    },                                                                   │
│                                                                         │
│    "proctor": {                                                         │
│      "dashboard.title": "Proctor Dashboard",                            │
│      "dashboard.live": "LIVE",                                          │
│      "dashboard.active": "Active",                                      │
│      "dashboard.warned": "Warned",                                     │
│      "dashboard.paused": "Paused",                                     │
│      "dashboard.terminated": "Terminated",                             │
│                                                                         │
│      "alert.newAlert": "New Alert",                                    │
│      "alert.clearAll": "Clear All",                                    │
│      "alert.acknowledge": "Acknowledge",                               │
│      "alert.viewSession": "View Session",                              │
│                                                                         │
│      "action.warn": "Warn",                                            │
│      "action.pause": "Pause",                                          │
│      "action.resume": "Resume",                                        │
│      "action.terminate": "Terminate",                                  │
│      "action.note": "Add Note",                                        │
│      "action.extendTime": "Extend Time",                                │
│      "action.flag": "Flag",                                            │
│                                                                         │
│      "warnModal.title": "Send Warning to Student",                     │
│      "warnModal.selectTemplate": "Select Warning Template",            │
│      "warnModal.customMessage": "Or write custom message",             │
│      "warnModal.send": "Send Warning",                                 │
│                                                                         │
│      "termModal.title": "Terminate Session",                           │
│      "termModal.confirm": "Terminate Session",                          │
│      "termModal.reason": "Termination Reason",                          │
│      "termModal.irreversible": "This action cannot be undone",          │
│    },                                                                   │
│                                                                         │
│    "admin": {                                                           │
│      "sessions.title": "Exam Sessions",                                 │
│      "rules.title": "Violation Detection Rules",                       │
│      "users.title": "User Management",                                 │
│      "reports.title": "Reports & Analytics",                            │
│    },                                                                   │
│                                                                         │
│    "status": {                                                          │
│      "active": "Active",                                                │
│      "warned": "Warned",                                                │
│      "paused": "Paused",                                                │
│      "terminated": "Terminated",                                       │
│      "idle": "Idle",                                                    │
│      "completed": "Completed",                                          │
│      "connected": "Connected",                                          │
│      "disconnected": "Disconnected",                                    │
│      "reconnecting": "Reconnecting...",                                │
│    },                                                                   │
│                                                                         │
│    "severity": {                                                         │
│      "low": "Low",                                                      │
│      "medium": "Medium",                                                 │
│      "high": "High",                                                    │
│      "critical": "Critical",                                             │
│    },                                                                   │
│                                                                         │
│    "section": {                                                          │
│      "listening": "Listening",                                          │
│      "reading": "Reading",                                              │
│      "writing": "Writing",                                              │
│    },                                                                   │
│  }                                                                      │
│                                                                         │
│  LOCALIZATION CONSIDERATIONS:                                            │
│  ══════════════════════════════                                          │
│                                                                         │
│  • Date/time formats: Use locale-aware formatting (Intl.DateTimeFormat)  │
│  • Number formats: Locale-specific separators (1,234 vs 1.234)         │
│  • Time format: 12h vs 24h based on locale preference                  │
│  • Text direction: Support RTL for Arabic/Hebrew future versions       │
│  • Font fallback: Include fonts supporting Cyrillic, CJK characters     │
│  • String lengths: German text ~30% longer than English; design flex   │
│  • Pluralization: Different rules per language (i18next plural forms)  │
│  • Form validation messages: Must be translatable                      │
│  • Error messages: All user-facing errors must be in translation file  │
│                                                                         │
│  AVOID HARD-CODING:                                                     │
│  ══════════════════                                                     │
│  ❌ Don't: <div>Tab Switch Detected</div>                               │
│  ✅ Do:   <div>{t('violation.tabSwitchDetected')}</div>                  │
│                                                                         │
│  ❌ Don't: `Time remaining: ${mins} minutes`                            │
│  ✅ Do:   t('exam.timeRemaining', { minutes: mins })                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 18. Design Review & Approval Process

### 18.1 Design Review Checklist

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DESIGN REVIEW CHECKLIST                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  BEFORE HANDOFF TO DEVELOPMENT:                                         │
│  ════════════════════════════════════                                  │
│                                                                         │
│  VISUAL DESIGN:                                                         │
│  ☐ All screens designed at target resolution                            │
│  ☐ Consistent use of design tokens across all screens                  │
│  ☐ Typography hierarchy clear and correctly applied                   │
│  ☐ Color usage follows semantic meaning (not decorative only)         │
│  ☐ Spacing consistent (no magic numbers outside token scale)          │
│  ☐ Icons from approved library (Lucide) with consistent sizing        │
│  ☐ No broken alignments or inconsistent padding                        │
│  ☐ Border radius and shadow treatments consistent                    │
│                                                                         │
│  INTERACTION DESIGN:                                                    │
│  ☐ All interactive elements have hover/focus/active/disabled states    │
│  ☐ Modal open/close flows defined                                     │
│  ☐ Form validation error states designed                              │
│  ☐ Loading states for every async action                              │
│  ☐ Empty states for every list/table view                             │
│  ☐ Error states for every failure scenario                            │
│  ☐ Success feedback after user actions                                │
│  ☐ Confirmation dialogs for destructive actions                        │
│                                                                         │
│  RESPONSIVENESS:                                                        │
│  ☐ Desktop layout (1920px) reviewed and approved                     │
│  ☐ Standard laptop (1440px) reviewed                                  │
│  ☐ Small laptop (1024px) reviewed                                     │
│  ☐ Tablet adaptation (768px) reviewed (proctor/admin only)            │
│  ☐ Mobile NOT required for student exam interface                    │
│                                                                         │
│  ACCESSIBILITY:                                                         │
│  ☐ Contrast ratios verified (all combinations pass WCAG AA)           │
│  ☐ Focus indicators visible and consistent                           │
│  ☐ Tab order logical on every page                                   │
│  ☐ ARIA labels planned for custom components                        │
│  ☐ Screen reader behavior documented for complex widgets            │
│  ☐ Reduced motion fallbacks specified                                │
│  ☐ Touch targets ≥ 44px on tablet adaptations                        │
│                                                                         │
│  CONTENT:                                                               │
│  ☐ Copy text finalized and approved by stakeholder                   │
│  ☐ Error messages clear, actionable, non-blaming                     │
│  ☐ Help text concise and contextually relevant                      │
│  ☐ Button labels use verb+noun pattern ("Save Changes")              │
│  ☐ No jargon or technical terms visible to students                  │
│  ☐ Warning messages firm but respectful in tone                     │
│                                                                         │
│  DEVELOPER HANDOFF:                                                     │
│  ☐ Design tokens exported in machine-readable format                │
│  ☐ Component specs written with prop APIs                            │
│  ☐ Annotated screenshots with measurements                          │
│  ☐ Interactive prototype linked and functional                       │
│  ☐ Asset package prepared (icons, fonts, illustrations)              │
│  ☐ This specification document delivered                            │
│  ☐ Q&A session scheduled with development team                     │
│                                                                         │
│  SIGN-OFF:                                                              │
│  ─────────                                                               │
│  Product Owner: _________________ Date: ________                     │
│  Tech Lead: ___________________ Date: ________                         │
│  UX Lead: ____________________ Date: ________                         │
│  Stakeholder: _________________ Date: ________                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 18.2 Design-Developer Communication Protocol

```
┌─────────────────────────────────────────────────────────────────────────┐
│               DESIGN ↔ DEVELOPER COMMUNICATION PROTOCOL                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  DURING DEVELOPMENT:                                                    │
│  ════════════════════                                                    │
│                                                                         │
│  QUESTION CATEGORIES:                                                   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Category     │ Channel          │ Response Time │ Escalation   │   │
│  │─────────────│──────────────────│──────────────│──────────────│   │
│  │ Clarification│ Slack/Discord    │ < 4 hours     │ Design lead  │   │
│  │ Impossible? │ Slack + Issue     │ < 1 day       │ PM + Design  │   │
│  │ Ambiguous   │ Slack + Screenshots│ < 4 hours     │ Design lead  │   │
│  │ Missing     │ Slack + Doc PR    │ < 1 day       │ Design lead  │   │
│  │ Bug in design│ GitHub Issue      │ < 2 days      │ Design review│   │
│  │ New request │ Formal CR process │ Sprint planning│ PM approval  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  CHANGE REQUEST PROCESS:                                                │
│  ══════════════════════                                                 │
│                                                                         │
│  1. Developer identifies gap/issue in design spec                       │
│         ↓                                                                │
│  2. Posts question in #design-support Slack channel                    │
│         ↓ (with screenshot/context)                                     │
│  3. Designer responds within 4 hours                                   │
│         ↓                                                                │
│  │  SMALL CLARIFICATION:                                              │
│  │  Designer answers → Developer implements → Done                    │
│  │                                                                    │
│  │  DESIGN CHANGE NEEDED:                                             │
│  │  Designer creates update → Reviews with UX lead                  │
│  │  → Updates Figma file → Notifies developer → Implements          │
│  │                                                                    │
│  │  SCOPE CHANGE:                                                     │
│  │  Documents as Change Request → PM reviews → Prioritizes          │
│  │  → Adds to backlog → Addresses in future sprint                  │
│                                                                         │
│  DAILY STANDUP TOPIC:                                                   │
│  • Any blocked items waiting on design decisions?                      │
│  • Any design clarifications needed for current sprint work?          │
│                                                                         │
│  SPRINT DEMO PREP:                                                      │
│  • Designer attends sprint demo to see implemented UI                  │
│  • Collects visual deviations for triage                              │
│  • Creates follow-up tickets for any polish items                     │
│                                                                         │
│  VISUAL DEVIATION TRIAGE:                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Severity  │ Definition                    │ Resolution          │   │
│  │───────────│───────────────────────────────│──────────────────────│   │
│  │  Critical │ Broken layout, wrong component │ Fix immediately     │   │
│  │           │ entirely, blocks functionality│                       │   │
│  │  Major    │ Significant visual deviation   │ Current sprint fix   │   │
│  │           │ from spec, noticeable to users │ or tech debt        │   │
│  │  minor    │ Minor spacing/color difference  │ Tech debt backlog   │   │
│  │           │ not noticeable to most users   │                      │   │
│  │  polish  │ Matches spec but could be better │ Nice-to-have enh.   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 19. Appendix: Quick Reference Cards

### 19.1 Designer Cheat Sheet

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    🎨 DESIGNER QUICK REFERENCE CARD                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  PRIMARY PALETTE (memorize these 6)                                    │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  Blue-600:  #1A508B  ← Primary brand, buttons, links                  │
│  Green-500: #169E58  ← Success, active, clean, go                     │
│  Amber-500: #E69100  ← Warning, caution, attention                   │
│  Red-600:   #C42020  ← Danger, error, terminate, stop                │
│  Gray-900:  #1A1A1A  ← Primary text, headings                        │
│  Gray-500:  #808080  ← Secondary text, disabled, muted               │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  KEY DIMENSIONS                                                        │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  Base unit:     4px                                                    │
│  Grid gap:      24px (space-6)                                        │
│  Card radius:   12px (radius-xl)                                     │
│  Button height: 32sm / 40md / 48lg                                    │
│  Input height:  36sm / 40md / 48lg                                    │
│  Header bar:    56px (student) / 60px (proctor) / 64px (sidebar logo)│
│  Sidebar width: 240px                                                 │
│  Alert panel:   340-400px                                              │
│  Detail panel: 320-400px (expandable to 60vh)                         │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  TYPE SCALE (key sizes)                                                │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  4xl: 36px — Page titles (Login, Report header)                       │
│  2xl: 24px — Card titles, section headers                             │
│  xl:  20px — Subheadings, important labels                            │
│  lg:  18px — Lead body, large labels, stat values                     │
│  base: 16px — Default body text, inputs, content                     │
│  sm:  14px — Secondary text, captions, table cells                   │
│  xs:  12px — Badges, tags, timestamps, helper text                  │
│                                                                         │
│  Font weights:  400 normal / 500 medium / 600 semibold / 700 bold     │
│  Line heights:  Tight 1.25 / Normal 1.5 / Relaxed 1.75               │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  SHADOW SHORTCUTS                                                      │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  xs: Subtle elevation (tooltips, dropdowns)                            │
│  sm: Cards default, inputs, buttons rest                               │
│  md: Cards hover, modals, popovers                                   │
│  lg: Dropdowns, important overlays                                   │
│  xl: Modals, hero elements, promotional                              │
│  inner: Pressed states, inset shadows                                 │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  STATUS COLORS AT A GLANCE                                              │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  🟢 Active/OK:    Green-500 (#169E58) on Green-50                    │
│  🟡 Warn/Caution: Amber-500 (#E69100) on Amber-50                   │
│  🟠 Paused:       Orange-600 (#D97706) on Orange-50                  │
│  🔴 Error/Stop:   Red-600 (#C42020) on Red-50                        │
│  ⚫ Idle/Muted:   Gray-500 (#808080) on Gray-50                      │
│  🔵 Info:         Blue-500 (#2066B0) on Blue-50                       │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  DON'T REMEMBER? CHECK THE SPEC!                                       │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  • Full color palette: Section 3                                        │
│  • Complete type scale: Section 4                                      │
│  • All spacing values: Section 5                                      │
│  • Component specs: Section 6                                         │
│  • Icon assignments: Section 7                                        │
│  • Screen wireframes: Sections 8-11                                   │
│  • Animations: Section 12                                             │
│  • Responsive breakpoints: Section 13                                  │
│  • Accessibility: Section 14                                          │
│  • Error states: Section 15                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 19.2 Developer Cheat Sheet

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    💻 DEVELOPER QUICK REFERENCE CARD                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  TAILWIND CLASS MAPPINGS (most used)                                  │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  CONTAINER:                                                             │
│  • Max width container: max-w-7xl (for admin) / w-full (student)       │
│  • Centered: mx-auto                                                   │
│  • Padding standard: p-4 p-6 p-8                                      │
│                                                                         │
│  TYPOGRAPHY:                                                           │
│  • H1: text-4xl font-semibold                                          │
│  • H2: text-3xl font-semibold                                          │
│  • Card title: text-2xl font-semibold                                  │
│  • Body: text-base                                                     │
│  • Caption: text-xs text-gray-500                                      │
│  • Mono: font-mono text-sm                                             │
│  • Truncate: truncate overflow-hidden text-ellipsis whitespace-nowrap   │
│                                                                         │
│  BUTTONS:                                                              │
│  • Primary: bg-primary-600 text-white hover:bg-primary-700 ...         │
│  • Danger: bg-danger-600 text-white hover:bg-danger-700 ...           │
│  • Ghost: bg-transparent hover:bg-gray-100 ...                         │
│  • Sizes: h-8 px-4 (sm) / h-10 px-5 (md) / h-12 px-6 (lg)          │
│  • Disabled: opacity-50 cursor-not-allowed                             │
│  • Loading: animate-spin inside button                                  │
│                                                                         │
│  CARDS:                                                                │
│  • Base: bg-white rounded-xl shadow-sm border border-gray-200         │
│  • Hover: hover:shadow-md transition-shadow duration-200             │
│  • Selected: ring-2 ring-primary-500 ring-offset-2                   │
│  • Padding: p-6                                                      │
│                                                                         │
│  INPUTS:                                                               │
│  • Base: border border-gray-300 rounded-md px-3 py-2.5 ...           │
│  • Focus: focus:outline-none focus:ring-2 focus:ring-primary-500     │
│  • Error: border-danger-500 focus:ring-danger-500                    │
│  • With icon: pl-10 (relative positioning for internal icon)          │
│                                                                         │
│  BADGES:                                                               │
│  • Pill: rounded-full px-2 py-1 text-xs font-medium                   │
│  • Status: bg-green-50 text-green-700 (adjust color per status)      │
│                                                                         │
│  MODALS:                                                               │
│  • Overlay: fixed inset-0 z-modal bg-black/50 backdrop-blur-sm         │
│  • Container: bg-white rounded-2xl shadow-xl m-auto                   │
│  • Sizes: max-w-sm (sm) / max-w-md (md) / max-w-lg (lg) / max-w-xl  │
│  • Header: px-6 py-4 border-b border-gray-200                        │
│  • Body: px-6 py-4                                                    │
│  │ Footer: px-6 py-4 border-t border-gray-200 justify-end gap-3      │
│                                                                         │
│  TABLES:                                                               │
│  • Container: overflow-x-auto rounded-lg border border-gray-200       │
│  • Header: bg-gray-50 text-xs font-medium text-gray-500 uppercase     │
│  │ Row: border-b border-gray-100 hover:bg-gray-50 h-14               │
│  │ Cell: px-3 py-2 text-sm                                            │
│  • Striped: even:bg-gray-50                                            │
│                                                                         │
│  UTILITIES:                                                             │
│  • Flex center: flex items-center justify-center                       │
│  │ Gap: gap-2 gap-3 gap-4 gap-6                                       │
│  • Text truncation: truncate (needs w-full on parent)                  │
│  • Screen reader only: sr-only                                         │
│  • Transitions: transition-colors duration-200                       │
│  • No select: select-none (for copy-protected areas)                  │
│  • Blur: blur-xl (for split-screen detection overlay)                 │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  COMMON PATTERNS                                                        │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  PAGE HEADER PATTERN:                                                   │
│  ─────────────────────                                                  │
│  <div className="flex items-center justify-between mb-6">                │
│    <div>                                                              │
│      <h1 className="text-3xl font-semibold">{title}</h1>                │
│      <p className="text-gray-500 mt-1">{subtitle}</p>                  │
│    </div>                                                              │
│    {actionButton}                                                      │
│  </div>                                                                 │
│                                                                         │
│  STAT CARD GRID:                                                        │
│  ─────────────────                                                      │
│  <div className="grid grid-cols-5 gap-4">                              │
│    {stats.map(stat => (                                                 │
│      <div key={stat.label} className="bg-white rounded-lg p-4          │
│                    shadow-sm border border-gray-200">                  │
│        <div className="flex items-center gap-2">                      │
│          <stat.icon className="text-{stat.color}" />                  │
│        </div>                                                          │
│        <div className="text-3xl font-bold mt-2">{stat.value}</div>     │
│        <div className="text-sm text-gray-500">{stat.label}</div>        │
│      </div>                                                            │
│    ))}                                                                  │
│  </div>                                                                 │
│                                                                         │
│  EMPTY STATE:                                                           │
│  ─────────────                                                           │
│  <div className="flex flex-col items-center justify-center py-16">      │
│    <icon className="w-20 h-20 text-gray-300 mb-4" />                   │
│    <h3 className="text-lg font-medium text-gray-900">{message}</h3>     │
│    <p className="text-sm text-gray-500 mt-1">{subMessage}</p>          │
│    <Button variant="primary" className="mt-6" onClick={action}>        │
│      {ctaText}                                                          │
│    </Button>                                                            │
│  </div>                                                                 │
│                                                                         │
│  ERROR BOUNDARY (React Error Boundary pattern):                          │
│  ───────────────────────────────────────────                            │
│  <div className="min-h-[400px] flex items-center justify-center          │
│               bg-red-50 rounded-lg border border-red-200">             │
│    <div className="text-center max-w-md">                               │
│      <XCircleIcon className="w-16 h-16 text-red-400 mx-auto mb-4" />  │
│      <h2 className="text-xl font-semibold text-gray-900">              │
│        Something went wrong</h2>                                        │
│      <p className="text-sm text-gray-500 mt-2">{error.message}</p>      │
│      <Button variant="secondary" className="mt-4"                     │
│              onClick={() => resetErrorBoundary()}>                      │
│        Try again</Button>                                               │
│    </div>                                                              │
│  </div>                                                                 │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  KEY API ENDPOINTS TO REMEMBER                                          │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  POST   /api/auth/login              — Authentication                  │
│  GET    /api/proctor/exams/:id/dashboard — Dashboard initial state     │
│  WS     /socket.io/proctor/:examId      — Real-time updates           │
│  POST   /api/proctor/sessions/:id/warn — Send warning                 │
│  POST   /api/proctor/sessions/:id/pause— Pause session                 │
│  POST   /api/students/events/batch     — Upload activity events        │
│  GET    /api/admin/reports/sessions/:id — Session review data         │
│                                                                         │
│  WEBSOCKET EVENTS:                                                      │
│  Client→Server: 'events:batch', 'response:warning-ack', 'help:request'│
│  Server→Client: 'alert:new', 'command:warn', 'command:pause',         │
│                  'command:terminate', 'command:extend-time'            │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│  SECURITY IMPLEMENTATION NOTES                                         │
│  ═══════════════════════════════════════════════════════════════════     │
│                                                                         │
│  CSP HEADERS (must include):                                            │
│  script-src 'self' 'unsafe-inline' (needed for inline security guards)  │
│  connect-src 'self' wss://*.domain.com (WebSocket)                    │
│  frame-ancestors 'none' (prevent iframe embedding)                    │
│                                                                         │
│  STUDENT EXAM PAGE:                                                     │
│  • Use capture phase listeners: { capture: true } in addEventListener  │
│  • Prevent default AND stop propagation for blocked shortcuts          │
│  • Apply select-none class to exam content area                        │
│  • Monitor window.resize for split-screen detection                   │
│  • Use visibilitychange API for tab switch detection                  │
│  • Queue events locally during offline; sync on reconnect             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Document End

---

### 📋 Summary of Deliverables

| Section | Content | Purpose |
|---------|---------|---------|
| **1** | Design Philosophy & Principles | Foundation values and direction |
| **2** | Design System Foundation | Token architecture |
| **3** | Color System | Full palette with semantic mappings |
| **4** | Typography | Font families, scale, usage rules |
| **5** | Spacing & Layout Grid | Spacing scale, breakpoints, layouts |
| **6** | Component Library | Buttons, inputs, cards, tables, modals, alerts, nav |
| **7** | Icon System | Icon library choice and mapping |
| **8** | Student Flow Screens | Login → Check → Lobby → Exam → Warning → Complete |
| **9** | Proctor Dashboard Screens | Selection → Live view → Detail → Actions → Settings |
| **10** | Admin Panel Screens | Shell, rules, sessions, users management |
| **11** | Post-Review Screens | Session report, export modal |
| **12** | Interaction & Animations | Animation library, micro-interactions, reduced motion |
| **13** | Responsive Guidelines | Breakpoint matrix, tablet adaptations |
| **14** | Accessibility (WCAG) | Compliance checklist, screen reader optimization |
| **15** | Error & Edge Cases | 7 error states, 5 empty states |
| **16** | Design Asset Deliverables | File structure, handoff checklist, annotation guide |
| **17** | Implementation Notes | CSS architecture, component APIs, i18n |
| **18** | Design Review Process | Review checklist, communication protocol |
| **19** | Appendix / Cheat Sheets | Designer and developer quick reference |

---

### ✅ Next Steps After This Document

1. **Design Tool Setup** — Create Figma workspace with the design system foundation
2. **Component Library Build** — Implement base components following Section 6 specs
3. **Screen-by-Screen Design** — Create high-fidelity mockups for all screens in Sections 8-11
4. **Prototype** — Link screens into interactive prototype for stakeholder review
5. **Developer Handoff Meeting** — Walk through this document with engineering team
6. **Implementation Sprint** — Begin with Student flow (S-001 → S-006), then Proctor dashboard
7. **Usability Testing** — Test with real users before launch
8. **Iterate** — Refine based on testing feedback

---

**Document Version:** 1.0  
**Last Updated:** June 2025  
**Prepared By:** UI/UX Design Team  
**Status:** Ready for Review and Approval 🔍
