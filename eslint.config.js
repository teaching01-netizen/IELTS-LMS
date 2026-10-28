import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import storybook from "eslint-plugin-storybook";
import tseslint from "typescript-eslint";
import authoringMaterials from "./scripts/eslint-rules/authoring-materials.js";

const sharedTypeScriptFiles = ["**/*.{ts,tsx}"];
const jsxA11yRecommendedWarnings = Object.fromEntries(
  Object.keys(jsxA11y.configs.recommended.rules).map((ruleName) => [ruleName, "warn"])
);

export default tseslint.config(
  {
    ignores: [
      "dist",
      "build",
      "coverage",
      "node_modules",
      "backend/target",
      "playwright-report",
      "storybook-static",
      "test-results",
      ".storybook",
      ".tsbuildinfo",
      "*.config.js",
      "*.min.js",
      "*.min.css",
    ],
  },
  {
    files: sharedTypeScriptFiles,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...jsxA11yRecommendedWarnings,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-case-declarations": "warn",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**/*"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["*.config.ts", "*.config.js", "vitest.config.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Staff rewrite ratchet: all staff feature, product, and view code is clean
    // of effect-dependency and explicit-any findings, so new ones fail lint.
    files: [
      "src/features/{admin,answer-history,assessment-forms,auth,builder,content-library,exam-authoring,grading,preferences,proctor,proctoring,results,sat-score-conversion,scheduling}/**/*.{ts,tsx}",
      "src/products/**/*.{ts,tsx}",
      "src/components/{admin,answer-history,proctor}/**/*.{ts,tsx}",
      "src/hooks/useFocusTrap.ts",
      "src/services/adminPreferencesRepository.ts",
    ],
    // The answer-key editor probes loosely typed block shapes; the plan keeps
    // it out of the rewrite until a defect is reproduced (Package 5).
    ignores: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/__tests__/**",
      "src/features/builder/routes/ExamAnswerKeyRoute.tsx",
      "src/features/builder/utils/answerKeyOverview.ts",
    ],
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/features/exam-authoring/**/*.ts", "src/features/exam-authoring/**/*.tsx"],
    plugins: { "authoring": { rules: { "materials": authoringMaterials } } },
    rules: { "authoring/materials": "error" },
  },
  {
    files: ["src/features/**/*.ts", "src/features/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../features/*"],
              message:
                "Features should not import directly from other features. Use shared/ or app/ for shared code.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/features/**/routes/**/*.ts",
      "src/features/**/routes/**/*.tsx",
      "src/features/**/hooks/**/*.ts",
      "src/features/**/hooks/**/*.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../../../app/*"],
              message: "Use @app/* imports from feature routes and hooks.",
            },
            {
              group: ["../../../services/*"],
              message: "Use @services/* imports from feature routes and hooks.",
            },
            {
              group: ["../../../components/*"],
              message: "Use @components/* imports from feature routes and hooks.",
            },
            {
              group: ["../../../features/*", "../../features/*", "../features/*"],
              message: "Do not cross feature boundaries with relative feature imports.",
            },
          ],
        },
      ],
    },
  },
  ...storybook.configs["flat/recommended"]
);
