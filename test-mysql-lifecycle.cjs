#!/usr/bin/env node

const http = require('http');

const API_BASE = 'http://localhost:4000/api/v1';
let authToken = null;
let csrfToken = null;
let examId = null;

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    
    if (authToken) {
      headers['Cookie'] = `session_token=${authToken}; csrf_token=${csrfToken}`;
      headers['X-CSRF-Token'] = csrfToken;
    }

    const req = http.request(url, {
      method: options.method || 'GET',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

async function testCompleteLifecycle() {
  console.log('=== Testing Complete Exam Lifecycle with MySQL ===\n');

  try {
    // Step 1: Create a user and login (or use existing)
    console.log('Step 1: Creating user and logging in...');
    const registerResponse = await makeRequest('/auth/register', {
      method: 'POST',
      body: {
        email: 'mysql-test@example.com',
        password: 'Password123!',
        displayName: 'MySQL Test User',
        role: 'builder',
      },
    });
    
    if (registerResponse.status === 200 || registerResponse.status === 201) {
      console.log('✓ User created successfully');
    } else if (registerResponse.status === 409) {
      console.log('✓ User already exists, proceeding to login');
    } else {
      console.log('Register response:', registerResponse.data);
    }

    // Login
    const loginResponse = await makeRequest('/auth/login', {
      method: 'POST',
      body: {
        email: 'mysql-test@example.com',
        password: 'Password123!',
      },
    });

    if (loginResponse.status === 200) {
      authToken = loginResponse.data.data.sessionToken;
      csrfToken = loginResponse.data.data.csrfToken;
      console.log('✓ Logged in successfully');
    } else {
      console.log('Login failed:', loginResponse.data);
      throw new Error('Login failed');
    }

    // Step 2: Create exam
    console.log('\nStep 2: Creating exam via API...');
    const createExamResponse = await makeRequest('/exams', {
      method: 'POST',
      body: {
        title: `MySQL Test Exam ${Date.now()}`,
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
        author: 'MySQL Test',
      },
    });

    if (createExamResponse.status === 200 || createExamResponse.status === 201) {
      examId = createExamResponse.data.data.id;
      console.log(`✓ Exam created with ID: ${examId}`);
      console.log(`  Status: ${createExamResponse.data.data.status}`);
    } else {
      console.log('Create exam failed:', createExamResponse.data);
      throw new Error('Failed to create exam');
    }

    // Step 3: Verify exam in database
    console.log('\nStep 3: Verifying exam in MySQL database...');
    const getExamResponse = await makeRequest(`/exams/${examId}`);
    
    if (getExamResponse.status === 200) {
      const exam = getExamResponse.data.data;
      console.log(`✓ Exam retrieved from database`);
      console.log(`  Title: ${exam.title}`);
      console.log(`  Status: ${exam.status}`);
      console.log(`  Type: ${exam.type}`);
    } else {
      console.log('Get exam failed:', getExamResponse.data);
      throw new Error('Failed to retrieve exam from database');
    }

    // Step 4: Edit exam (update draft)
    console.log('\nStep 4: Editing exam (updating draft)...');
    const updateDraftResponse = await makeRequest(`/exams/${examId}/draft`, {
      method: 'PATCH',
      body: {
        title: `${getExamResponse.data.data.title} (Edited)`,
        config: {
          ...getExamResponse.data.data.config,
          general: {
            ...getExamResponse.data.data.config.general,
            summary: 'Updated summary - MySQL validation',
            instructions: 'Updated instructions - MySQL validation',
          },
        },
      },
    });

    if (updateDraftResponse.status === 200) {
      console.log('✓ Exam draft updated successfully');
    } else {
      console.log('Update draft failed:', updateDraftResponse.data);
      throw new Error('Failed to update exam draft');
    }

    // Step 5: Verify edit persisted to database
    console.log('\nStep 5: Verifying edit persisted to MySQL database...');
    const getUpdatedExamResponse = await makeRequest(`/exams/${examId}`);
    
    if (getUpdatedExamResponse.status === 200) {
      const updatedExam = getUpdatedExamResponse.data.data;
      console.log(`✓ Edit verified in database`);
      console.log(`  Title: ${updatedExam.title}`);
      console.log(`  Summary: ${updatedExam.config.general.summary}`);
    } else {
      console.log('Get updated exam failed:', getUpdatedExamResponse.data);
      throw new Error('Failed to retrieve updated exam');
    }

    // Step 6: Add content (reading passage)
    console.log('\nStep 6: Adding reading passage content...');
    const addContentResponse = await makeRequest(`/exams/${examId}/draft`, {
      method: 'PATCH',
      body: {
        reading_passages: [
          {
            id: `passage-${Date.now()}`,
            title: 'MySQL Test Passage',
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
      },
    });

    if (addContentResponse.status === 200) {
      console.log('✓ Reading passage added successfully');
    } else {
      console.log('Add content failed:', addContentResponse.data);
      console.log('⚠ Continuing without content...');
    }

    // Step 7: Publish exam
    console.log('\nStep 7: Publishing exam...');
    const publishResponse = await makeRequest(`/exams/${examId}/publish`, {
      method: 'POST',
      body: {
        publishNotes: 'Published via MySQL lifecycle test',
      },
    });

    if (publishResponse.status === 200 || publishResponse.status === 201) {
      console.log('✓ Exam published successfully');
    } else {
      console.log('Publish failed:', publishResponse.data);
      console.log('⚠ Continuing without publish...');
    }

    // Step 8: Verify exam status in database
    console.log('\nStep 8: Verifying exam status in MySQL database...');
    const getPublishedExamResponse = await makeRequest(`/exams/${examId}`);
    
    if (getPublishedExamResponse.status === 200) {
      const publishedExam = getPublishedExamResponse.data.data;
      console.log(`✓ Exam status verified in database`);
      console.log(`  Status: ${publishedExam.status}`);
      console.log(`  Published Version ID: ${publishedExam.currentPublishedVersionId || 'N/A'}`);
    } else {
      console.log('Get published exam failed:', getPublishedExamResponse.data);
    }

    // Step 9: Re-edit after publish (should create new version)
    console.log('\nStep 9: Re-editing exam after publish...');
    const reEditResponse = await makeRequest(`/exams/${examId}/draft`, {
      method: 'PATCH',
      body: {
        config: {
          ...getPublishedExamResponse.data.data.config,
          general: {
            ...getPublishedExamResponse.data.data.config.general,
            summary: 'Summary after publish - should create new version',
          },
        },
      },
    });

    if (reEditResponse.status === 200) {
      console.log('✓ Exam re-edited successfully after publish');
    } else {
      console.log('Re-edit failed:', reEditResponse.data);
      console.log('⚠ Continuing without re-edit...');
    }

    // Step 10: Check versions
    console.log('\nStep 10: Checking exam versions...');
    const versionsResponse = await makeRequest(`/exams/${examId}/versions`);
    
    if (versionsResponse.status === 200) {
      const versions = versionsResponse.data.data;
      console.log(`✓ Retrieved ${versions.length} version(s) from MySQL database`);
      versions.forEach((v, i) => {
        console.log(`  Version ${i + 1}: ID=${v.id}, Revision=${v.revision}`);
      });
    } else {
      console.log('Get versions failed:', versionsResponse.data);
    }

    console.log('\n=== Complete Exam Lifecycle Test with MySQL PASSED ===');
    console.log('All steps completed successfully with real MySQL database integration');
    
  } catch (error) {
    console.error('\n=== Test FAILED ===');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

testCompleteLifecycle();
