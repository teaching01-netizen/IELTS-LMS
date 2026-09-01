import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';
import rule from '../authoring-materials.js';

describe('authoring-materials rule', () => {
  it('rejects raw fills and unapproved translucency while allowing semantic tokens', () => {
    const tester = new RuleTester({
      languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    });
    tester.run('authoring-materials', rule, {
      valid: [
        { code: '<div className="bg-au-tint text-au-danger-text authoring-glass" />' },
        { code: '<div className="shadow-[0_1px_2px_rgba(0,0,0,0.04)]" />' },
      ],
      invalid: [
        {
          code: '<div className="bg-[#0071e3]" />',
          errors: [{ message: 'Use an au-* semantic color token instead of a raw fill color.' }],
        },
        {
          code: '<div className="backdrop-blur-xl" />',
          errors: [{ message: 'Use an approved authoring HUD/material class for translucency.' }],
        },
        {
          code: '<div className="text-slate-700 rgba(0,0,0,0.2)" />',
          errors: [{ message: 'Use a material or semantic token instead of raw rgba color.' }],
        },
      ],
    });
  });
});
