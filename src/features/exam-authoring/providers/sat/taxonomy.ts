export const SAT_DOMAINS = {
  "reading-writing": [
    { key: "information-and-ideas", label: "Information and Ideas" },
    { key: "craft-and-structure", label: "Craft and Structure" },
    { key: "expression-of-ideas", label: "Expression of Ideas" },
    { key: "standard-english-conventions", label: "Standard English Conventions" },
  ],
  math: [
    { key: "algebra", label: "Algebra" },
    { key: "advanced-math", label: "Advanced Math" },
    { key: "problem-solving-and-data-analysis", label: "Problem-Solving and Data Analysis" },
    { key: "geometry-and-trigonometry", label: "Geometry and Trigonometry" },
  ],
} as const;

export const SAT_SKILLS = {
  "information-and-ideas": [
    "Central Ideas and Details",
    "Command of Evidence — Textual",
    "Command of Evidence — Quantitative",
    "Inferences",
  ],
  "craft-and-structure": [
    "Words in Context",
    "Text Structure and Purpose",
    "Cross-Text Connections",
  ],
  "expression-of-ideas": ["Rhetorical Synthesis", "Transitions"],
  "standard-english-conventions": ["Boundaries", "Form, Structure, and Sense"],
  algebra: [
    "Linear Equations in One Variable",
    "Linear Functions",
    "Linear Equations in Two Variables",
    "Systems of Two Linear Equations",
    "Linear Inequalities",
  ],
  "advanced-math": [
    "Equivalent Expressions",
    "Nonlinear Equations in One Variable",
    "Systems of Equations in Two Variables",
    "Nonlinear Functions",
  ],
  "problem-solving-and-data-analysis": [
    "Ratios, Rates, Proportional Relationships, and Units",
    "Percentages",
    "One-Variable Data",
    "Two-Variable Data",
    "Probability and Conditional Probability",
    "Inference from Sample Statistics and Margin of Error",
    "Evaluating Statistical Claims",
  ],
  "geometry-and-trigonometry": [
    "Area and Volume",
    "Lines, Angles, and Triangles",
    "Right Triangles and Trigonometry",
    "Circles",
  ],
} as const;

export type SatSectionKey = keyof typeof SAT_DOMAINS;
export type SatDomainKey = keyof typeof SAT_SKILLS;

export function isSatDomain(sectionKey: string, domain: string): boolean {
  const domains = SAT_DOMAINS[sectionKey as SatSectionKey];
  return domains?.some((entry) => entry.key === domain) ?? false;
}

export function getSatSkills(domain: string | null): readonly string[] {
  if (!domain) return [];
  return SAT_SKILLS[domain as SatDomainKey] ?? [];
}

export function isSatSkill(domain: string | null, skill: string): boolean {
  return getSatSkills(domain).includes(skill);
}
