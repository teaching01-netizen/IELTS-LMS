import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADDITIVE_KEY_SOURCE_FIELDS,
  OBJECTIVE_KEY_SOURCE_DEFAULT,
  OBJECTIVE_KEY_SOURCE_FIELDS,
  getKeySourceFieldsForType,
} from '../gradingAnswerUtils';

interface KeySourceManifest {
  rows: Record<string, readonly string[]>;
  additiveRows: Record<string, readonly string[]>;
  default: readonly string[];
}

const manifest = JSON.parse(
  readFileSync('testdata/objective-grading-parity/key-source-table.json', 'utf8'),
) as KeySourceManifest;

describe('shared key-source table', () => {
  it('has the same single-winner rows and field order as the manifest', () => {
    expect(Object.keys(OBJECTIVE_KEY_SOURCE_FIELDS).sort()).toEqual(Object.keys(manifest.rows).sort());
    for (const [questionType, fields] of Object.entries(manifest.rows)) {
      expect(getKeySourceFieldsForType(questionType), questionType).toEqual(fields);
    }
  });

  it('keeps additive types out of the single-winner table', () => {
    expect(Object.keys(ADDITIVE_KEY_SOURCE_FIELDS).sort())
      .toEqual(Object.keys(manifest.additiveRows).sort());
    for (const [questionType, fields] of Object.entries(manifest.additiveRows)) {
      expect(ADDITIVE_KEY_SOURCE_FIELDS[questionType], questionType).toEqual(fields);
      expect(OBJECTIVE_KEY_SOURCE_FIELDS[questionType], questionType).toBeUndefined();
      expect(manifest.rows[questionType], questionType).toBeUndefined();
    }
  });

  it('uses the shared default for an unknown question type', () => {
    expect(getKeySourceFieldsForType('NEW_QUESTION_TYPE')).toEqual(manifest.default);
    expect(OBJECTIVE_KEY_SOURCE_DEFAULT).toEqual(manifest.default);
  });
});
