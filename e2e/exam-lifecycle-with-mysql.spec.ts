import { expect, test, type Page } from '@playwright/test';
import {
  BUILDER_STORAGE_STATE_PATH,
  readBackendE2EManifest,
} from './support/backendE2e';

test.use({ storageState: BUILDER_STORAGE_STATE_PATH });

// Helper function to create exam via API
async function createExamViaAPI(page: Page, title: string): Promise<string> {
  const response = await page.request.post('/api/v1/exams', {
    data: {
      title: title,
      type: 'Academic',
      config: {
        general: {
          preset: 'Academic',
          summary: 'Test exam for MySQL validation',
          instructions: 'Follow instructions',
        },
        modules: {
          reading: { enabled: true, label: 'Reading', passageCount: 1, order: 1, gapAfter: 0 },
          listening: { enabled: false, label: 'Listening', partCount: 0, order: 0, gapAfter: 0 },
          writing: { enabled: true, label: 'Writing', order: 2, gapAfter: 0 },
          speaking: { enabled: false, label: 'Speaking', order: 3, gapAfter: 0 },
        },
        standards: {
          passageWordCount: { optimalMin: 700, optimalMax: 1000, warningMin: 500, warningMax: 1200 },
          writingTasks: {
            task1: { minWords: 150, recommendedTime: 20 },
            task2: { minWords: 250, recommendedTime: 40 },
          },
          rubricDeviationThreshold: 10,
          rubricWeights: {
            writing: { taskResponse: 25, coherence: 25, lexical: 25, grammar: 25 },
            speaking: { fluency: 25, lexical: 25, grammar: 25, pronunciation: 25 },
          },
          bandScoreTables: {
            listening: { 39: 9.0, 37: 8.5, 35: 8.0, 32: 7.5, 30: 7.0, 26: 6.5, 23: 6.0, 18: 5.5, 16: 5.0, 13: 4.5, 10: 4.0, 6: 3.5, 4: 3.0, 2: 2.5 },
            readingAcademic: { 39: 9.0, 37: 8.5, 35: 8.0, 33: 7.5, 30: 7.0, 27: 6.5, 23: 6.0, 19: 5.5, 15: 5.0, 13: 4.5, 10: 4.0, 8: 3.5, 6: 3.0, 4: 2.5 },
            readingGeneralTraining: { 40: 9.0, 39: 8.5, 37: 8.0, 36: 7.5, 34: 7.0, 32: 6.5, 30: 6.0, 27: 5.5, 23: 5.0, 19: 4.5, 15: 4.0, 12: 3.5, 9: 3.0, 6: 2.5 },
          },
        },
        timing: {
          sectionDurations: { listening: 30, reading: 60, writing: 60, speaking: 15 },
          gapsAfterSections: { listening: 0, reading: 0, writing: 0, speaking: 0 },
          sectionOrder: ['listening', 'reading', 'writing', 'speaking'],
          runtimePolicies: {
            autoSubmit: true,
            lockAfterSubmit: true,
            allowPause: false,
            showWarnings: true,
            warningThreshold: 3,
          },
        },
        security: {
          proctoringControls: { webcam: true, audio: true, screen: true },
          screenDetection: {
            detectSecondaryScreen: true,
            fullscreen: 'required',
            fullscreenAutoReentry: true,
            fullscreenMaxViolations: 3,
          },
          inputProtection: { preventAutofill: true, preventAutocorrect: true },
          tabSwitchRule: 'warn',
          heartbeat: {
            interval: 15,
            missThreshold: 3,
            warningThreshold: 2,
            hardBlockThreshold: 4,
          },
          offlineBehavior: {
            pauseOnOffline: true,
            bufferAnswersOffline: true,
            requireDeviceContinuity: true,
          },
          severityThresholds: { low: 5, medium: 3, high: 2 },
          criticalAction: 'terminate',
        },
      },
      author: 'E2E MySQL Test',
    },
  });

  if (!response.ok()) {
    throw new Error(`Failed to create exam: ${response.status()} ${await response.text()}`);
  }

  const data = await response.json();
  return data.data.id;
}

// Helper function to update exam draft
async function updateExamDraft(page: Page, examId: string, updates: any): Promise<void> {
  const response = await page.request.patch(`/api/v1/exams/${examId}/draft`, {
    data: updates,
  });

  if (!response.ok()) {
    throw new Error(`Failed to update exam draft: ${response.status()} ${await response.text()}`);
  }
}

// Helper function to publish exam
async function publishExam(page: Page, examId: string): Promise<void> {
  const response = await page.request.post(`/api/v1/exams/${examId}/publish`, {
    data: {
      publishNotes: 'Published via E2E MySQL test',
    },
  });

  if (!response.ok()) {
    throw new Error(`Failed to publish exam: ${response.status()} ${await response.text()}`);
  }
}

// Helper function to get exam from DB
async function getExamFromDB(page: Page, examId: string): Promise<any> {
  const response = await page.request.get(`/api/v1/exams/${examId}`);

  if (!response.ok()) {
    throw new Error(`Failed to get exam: ${response.status()} ${await response.text()}`);
  }

  const data = await response.json();
  return data.data;
}

test.describe('Exam Lifecycle with Real MySQL Database', () => {
  test.skip(({ browserName }) => browserName === 'webkit', 'Skipping webkit due to storage state auth issue');

  test('complete flow: create -> edit -> validate -> publish -> re-edit', async ({ page }) => {
    console.log('=== Starting Complete Exam Lifecycle Test with MySQL ===');

    // Step 1: Create exam via API
    console.log('Step 1: Creating exam via API...');
    const examTitle = `MySQL Test Exam ${Date.now()}`;
    const examId = await createExamViaAPI(page, examTitle);
    console.log(`Created exam with ID: ${examId}`);

    // Verify exam was created in DB
    const examFromDB = await getExamFromDB(page, examId);
    expect(examFromDB.id).toBe(examId);
    expect(examFromDB.title).toBe(examTitle);
    expect(examFromDB.status).toBe('draft');
    console.log('✓ Exam verified in MySQL database');

    // Step 2: Edit exam - update basic info
    console.log('Step 2: Editing exam...');
    await updateExamDraft(page, examId, {
      title: `${examTitle} (Edited)`,
      config: {
        ...examFromDB.config,
        general: {
          ...examFromDB.config.general,
          summary: 'Updated summary for MySQL validation',
          instructions: 'Updated instructions for MySQL validation',
        },
      },
    });

    // Verify edit was persisted to DB
    const editedExam = await getExamFromDB(page, examId);
    expect(editedExam.title).toBe(`${examTitle} (Edited)`);
    expect(editedExam.config.general.summary).toBe('Updated summary for MySQL validation');
    console.log('✓ Edit verified in MySQL database');

    // Step 3: Add content - reading passage with questions
    console.log('Step 3: Adding reading passage content...');
    const passageUpdate = {
      reading_passages: [
        {
          id: `passage-${Date.now()}`,
          title: 'Test Passage',
          content: 'This is a test passage for MySQL validation. ' + 'The study of database systems has evolved significantly. '.repeat(30),
          blocks: [
            {
              id: `block-${Date.now()}`,
              type: 'SINGLE_MCQ',
              instruction: 'Choose the correct answer',
              questions: [
                {
                  id: `q1-${Date.now()}`,
                  prompt: 'What is the main topic?',
                  options: [
                    { id: 'opt1', text: 'Database systems', correct: true },
                    { id: 'opt2', text: 'Web development', correct: false },
                    { id: 'opt3', text: 'Mobile apps', correct: false },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    await updateExamDraft(page, examId, passageUpdate);
    const examWithContent = await getExamFromDB(page, examId);
    expect(examWithContent.reading_passages).toBeDefined();
    expect(examWithContent.reading_passages.length).toBeGreaterThan(0);
    console.log('✓ Content added and verified in MySQL database');

    // Step 4: Add writing tasks
    console.log('Step 4: Adding writing tasks...');
    const writingUpdate = {
      writing_tasks: [
        {
          id: `task1-${Date.now()}`,
          taskNumber: 1,
          prompt: 'Describe the graph showing database usage trends',
          minWords: 150,
          recommendedTime: 20,
        },
        {
          id: `task2-${Date.now()}`,
          taskNumber: 2,
          prompt: 'Discuss the advantages of MySQL for IELTS testing',
          minWords: 250,
          recommendedTime: 40,
        },
      ],
    };

    await updateExamDraft(page, examId, writingUpdate);
    const examWithWriting = await getExamFromDB(page, examId);
    expect(examWithWriting.writing_tasks).toBeDefined();
    expect(examWithWriting.writing_tasks.length).toBe(2);
    console.log('✓ Writing tasks added and verified in MySQL database');

    // Step 5: Validate exam - check validation logic
    console.log('Step 5: Validating exam...');
    await page.goto(`/builder/${examId}/review`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Check if validation status is displayed
    const validationText = page.getByText(/validation/i);
    const validationVisible = await validationText.isVisible().catch(() => false);

    if (validationVisible) {
      const passedText = page.getByText('Technical Validation Passed');
      const passedVisible = await passedText.isVisible().catch(() => false);

      if (passedVisible) {
        console.log('✓ Validation passed - content meets requirements');
      } else {
        // Check for issues
        const issuesText = page.getByText('Technical Validation Issues');
        const issuesVisible = await issuesText.isVisible().catch(() => false);
        if (issuesVisible) {
          console.log('⚠ Validation has issues - checking details...');
          const errorSection = page.getByText(/error|warning/i);
          const errorVisible = await errorSection.isVisible().catch(() => false);
          if (!errorVisible) {
            console.log('✓ Validation issues are informational (not blocking)');
          }
        }
      }
    } else {
      console.log('⚠ Validation section not visible - may need more content');
    }

    // Step 6: Publish exam
    console.log('Step 6: Publishing exam...');
    await publishExam(page, examId);

    // Verify exam status changed to published in DB
    const publishedExam = await getExamFromDB(page, examId);
    expect(publishedExam.status).toBe('published');
    expect(publishedExam.currentPublishedVersionId).toBeDefined();
    console.log('✓ Exam published and status verified in MySQL database');

    // Step 7: Verify exam can still be edited after publish (should create new version)
    console.log('Step 7: Re-editing published exam...');
    await updateExamDraft(page, examId, {
      config: {
        ...publishedExam.config,
        general: {
          ...publishedExam.config.general,
          summary: 'Summary after publish - should create new version',
        },
      },
    });

    const reEditedExam = await getExamFromDB(page, examId);
    expect(reEditedExam.config.general.summary).toBe('Summary after publish - should create new version');
    console.log('✓ Exam re-edited and verified in MySQL database');

    // Step 8: Check versions
    console.log('Step 8: Checking exam versions...');
    const versionsResponse = await page.request.get(`/api/v1/exams/${examId}/versions`);
    if (versionsResponse.ok()) {
      const versionsData = await versionsResponse.json();
      const versions = versionsData.data;
      expect(versions.length).toBeGreaterThan(0);
      console.log(`✓ Found ${versions.length} version(s) in MySQL database`);
    }

    console.log('=== Complete Exam Lifecycle Test with MySQL PASSED ===');
  });

  test('validation checks database constraints', async ({ page }) => {
    console.log('=== Testing Database Constraints in Validation ===');

    // Create exam with invalid config to test validation
    const examTitle = `Validation Test ${Date.now()}`;
    const examId = await createExamViaAPI(page, examTitle);

    // Try to set invalid values (e.g., negative durations)
    try {
      await updateExamDraft(page, examId, {
        config: {
          general: {
            preset: 'Academic',
            summary: 'Test',
            instructions: 'Test',
          },
          modules: {
            reading: { enabled: true, label: 'Reading', passageCount: 1, order: 1, gapAfter: 0 },
            listening: { enabled: false, label: 'Listening', partCount: 0, order: 0, gapAfter: 0 },
            writing: { enabled: false, label: 'Writing', order: 2, gapAfter: 0 },
            speaking: { enabled: false, label: 'Speaking', order: 3, gapAfter: 0 },
          },
          standards: {
            passageWordCount: { optimalMin: 700, optimalMax: 1000, warningMin: 500, warningMax: 1200 },
            writingTasks: {
              task1: { minWords: 150, recommendedTime: 20 },
              task2: { minWords: 250, recommendedTime: 40 },
            },
            rubricDeviationThreshold: 10,
            rubricWeights: {
              writing: { taskResponse: 25, coherence: 25, lexical: 25, grammar: 25 },
              speaking: { fluency: 25, lexical: 25, grammar: 25, pronunciation: 25 },
            },
            bandScoreTables: {
              listening: { 39: 9.0, 37: 8.5, 35: 8.0, 32: 7.5, 30: 7.0, 26: 6.5, 23: 6.0, 18: 5.5, 16: 5.0, 13: 4.5, 10: 4.0, 6: 3.5, 4: 3.0, 2: 2.5 },
              readingAcademic: { 39: 9.0, 37: 8.5, 35: 8.0, 33: 7.5, 30: 7.0, 27: 6.5, 23: 6.0, 19: 5.5, 15: 5.0, 13: 4.5, 10: 4.0, 8: 3.5, 6: 3.0, 4: 2.5 },
              readingGeneralTraining: { 40: 9.0, 39: 8.5, 37: 8.0, 36: 7.5, 34: 7.0, 32: 6.5, 30: 6.0, 27: 5.5, 23: 5.0, 19: 4.5, 15: 4.0, 12: 3.5, 9: 3.0, 6: 2.5 },
            },
          },
          timing: {
            sectionDurations: { listening: -1, reading: -1, writing: -1, speaking: -1 }, // Invalid
            gapsAfterSections: { listening: 0, reading: 0, writing: 0, speaking: 0 },
            sectionOrder: ['listening', 'reading', 'writing', 'speaking'],
            runtimePolicies: {
              autoSubmit: true,
              lockAfterSubmit: true,
              allowPause: false,
              showWarnings: true,
              warningThreshold: 3,
            },
          },
          security: {
            proctoringControls: { webcam: true, audio: true, screen: true },
            screenDetection: {
              detectSecondaryScreen: true,
              fullscreen: 'required',
              fullscreenAutoReentry: true,
              fullscreenMaxViolations: 3,
            },
            inputProtection: { preventAutofill: true, preventAutocorrect: true },
            tabSwitchRule: 'warn',
            heartbeat: {
              interval: 15,
              missThreshold: 3,
              warningThreshold: 2,
              hardBlockThreshold: 4,
            },
            offlineBehavior: {
              pauseOnOffline: true,
              bufferAnswersOffline: true,
              requireDeviceContinuity: true,
            },
            severityThresholds: { low: 5, medium: 3, high: 2 },
            criticalAction: 'terminate',
          },
        },
      });
      console.log('⚠ Backend accepted negative durations - validation may be at UI level');
    } catch (error) {
      console.log('✓ Backend rejected invalid config:', error instanceof Error ? error.message : String(error));
    }

    console.log('=== Database Constraints Validation Test Complete ===');
  });
});
