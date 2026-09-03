import React from "react";
import { describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { overrideObjectiveQuestion } = vi.hoisted(() => ({
  overrideObjectiveQuestion: vi.fn(),
}));

vi.mock("../../../services/gradingRepository", () => {
  return {
    gradingRepository: {
      getSubmissionById: vi.fn(),
      getSectionSubmissionsBySubmissionId: vi.fn(),
      invalidateSubmissionBundle: vi.fn(),
      getWritingSubmissionsBySubmissionId: vi.fn(),
      getReviewDraftBySubmission: vi.fn(),
    },
  };
});

vi.mock("../../../services/examRepository", () => {
  return {
    examRepository: {
      getVersionById: vi.fn(),
    },
  };
});

vi.mock("../../../services/gradingService", () => {
  return {
    gradingService: {
      startReview: vi.fn(),
      saveReviewDraft: vi.fn(),
      markGradingComplete: vi.fn(),
      markReadyToRelease: vi.fn(),
      releaseResult: vi.fn(),
      scheduleRelease: vi.fn(),
      reopenReview: vi.fn(),
      overrideObjectiveQuestion,
      getObjectiveGradingSource: vi.fn().mockResolvedValue({ success: false }),
    },
  };
});

describe("StudentReviewWorkspace objective answers", () => {
  test("shows only ACT Science with traceback details and supports answer overrides", async () => {
    const { createInitialExamState } = await import("../../../services/examAdapterService");
    const { gradingRepository } = await import("../../../services/gradingRepository");
    const { examRepository } = await import("../../../services/examRepository");
    const { StudentReviewWorkspace } = await import("../StudentReviewWorkspace");

    const questionId = "science-question-1";
    const examState = createInitialExamState("ACT Science Practice", "ACT", "ACT Science");
    examState.science.stimuli = [
      {
        id: "stimulus-1",
        title: "Water temperature results",
        content: "The table shows the results of an experiment.",
        blocks: [
          {
            id: "science-block-1",
            type: "SINGLE_MCQ",
            instruction: "Use the experiment results to answer the question.",
            stem: "Which conclusion is supported by the experiment?",
            options: [
              { id: "option-a", text: "Option A", isCorrect: true },
              { id: "option-b", text: "Option B", isCorrect: false },
            ],
            questions: [
              {
                id: questionId,
                stem: "Which conclusion is supported by the experiment?",
                skillCategory: "interpretation_of_data",
                options: [
                  { id: "option-a", text: "Option A", isCorrect: true },
                  { id: "option-b", text: "Option B", isCorrect: false },
                ],
              },
            ],
          },
        ],
        images: [],
      },
    ] as any;

    const now = new Date().toISOString();
    (gradingRepository.getSubmissionById as any).mockResolvedValue({
      id: "sub-act-1",
      submissionId: "sub-act-1",
      scheduleId: "sched-act-1",
      examId: "exam-act-1",
      publishedVersionId: "ver-act-1",
      studentId: "stu-act-1",
      studentName: "ACT Student",
      studentEmail: "act@example.com",
      cohortName: "ACT Cohort",
      submittedAt: now,
      timeSpentSeconds: 120,
      gradingStatus: "submitted",
      isFlagged: false,
      isOverdue: false,
      sectionStatuses: {
        listening: "auto_graded",
        reading: "auto_graded",
        writing: "needs_review",
        speaking: "pending",
        science: "auto_graded",
      },
      createdAt: now,
      updatedAt: now,
    });
    (gradingRepository.getSectionSubmissionsBySubmissionId as any).mockResolvedValue([
      {
        id: "science-section-1",
        submissionId: "sub-act-1",
        section: "science",
        answers: { type: "science", answers: { [questionId]: "option-a" } },
        autoGradingResults: {
          totalScore: 1,
          maxScore: 1,
          percentage: 100,
          questionResults: [
            {
              questionId,
              studentAnswer: "option-a",
              correctAnswer: "option-a",
              isCorrect: true,
              awardedScore: 1,
              maxScore: 1,
              scoringRule: "single_choice",
              hasOverride: false,
            },
          ],
          generatedAt: now,
        },
        gradingStatus: "auto_graded",
        submittedAt: now,
      },
    ]);
    (gradingRepository.getWritingSubmissionsBySubmissionId as any).mockResolvedValue([]);
    (gradingRepository.getReviewDraftBySubmission as any).mockResolvedValue({
      id: "draft-act-1",
      submissionId: "sub-act-1",
      studentId: "stu-act-1",
      teacherId: "teacher-1",
      releaseStatus: "draft",
      sectionDrafts: {},
      annotations: [],
      drawings: [],
      teacherSummary: { strengths: [], improvementPriorities: [], recommendedPractice: [] },
      checklist: {},
      hasUnsavedChanges: false,
      createdAt: now,
      updatedAt: now,
    });
    (examRepository.getVersionById as any).mockResolvedValue({
      id: "ver-act-1",
      contentSnapshot: examState,
    });
    overrideObjectiveQuestion.mockResolvedValue({ success: true });

    render(
      <StudentReviewWorkspace
        submissionId="sub-act-1"
        onBack={() => {}}
        currentTeacherId="teacher-1"
        currentTeacherName="Teacher"
      />
    );

    expect(
      await screen.findByRole("button", { name: /ACT Science auto_graded/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /listening/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reading/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /writing/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /speaking/i })).not.toBeInTheDocument();
    expect(
      await screen.findByText("Which conclusion is supported by the experiment?")
    ).toBeInTheDocument();
    expect(screen.getAllByText("Option A")).toHaveLength(2);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Mark incorrect" }));
    });
    await waitFor(() => {
      expect(overrideObjectiveQuestion).toHaveBeenCalledWith("sub-act-1", "science", questionId, {
        isCorrect: false,
        reason: "Manual grader correctness decision",
      });
    });
  });

  test("renders reading answers from backend bundle map", async () => {
    const { createInitialExamState } = await import("../../../services/examAdapterService");
    const { gradingRepository } = await import("../../../services/gradingRepository");
    const { examRepository } = await import("../../../services/examRepository");
    const { StudentReviewWorkspace } = await import("../StudentReviewWorkspace");

    const answerValue = "student-ans-123";
    const questionId = "q-1";

    const examState = createInitialExamState("Exam", "Academic");
    examState.reading.passages = [
      {
        id: "p1",
        title: "Passage 1",
        content: "Content",
        blocks: [
          {
            id: "b1",
            type: "SHORT_ANSWER",
            instruction: "Answer",
            questions: [
              {
                id: questionId,
                prompt: "What?",
                correctAnswer: "correct",
                answerRule: "ONE_WORD",
              },
            ],
          },
        ],
        images: [],
        wordCount: 1,
      },
    ];

    (gradingRepository.getSubmissionById as any).mockResolvedValue({
      id: "sub-1",
      submissionId: "sub-1",
      scheduleId: "sched-1",
      examId: "exam-1",
      publishedVersionId: "ver-1",
      studentId: "stu-1",
      studentName: "Alice",
      studentEmail: "alice@example.com",
      cohortName: "Cohort",
      submittedAt: new Date().toISOString(),
      timeSpentSeconds: 0,
      gradingStatus: "submitted",
      assignedTeacherId: undefined,
      assignedTeacherName: undefined,
      isFlagged: false,
      flagReason: undefined,
      isOverdue: false,
      dueDate: undefined,
      sectionStatuses: {
        listening: "pending",
        reading: "auto_graded",
        writing: "needs_review",
        speaking: "pending",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    (gradingRepository.getSectionSubmissionsBySubmissionId as any).mockResolvedValue([
      {
        id: "sec-1",
        submissionId: "sub-1",
        section: "reading",
        answers: {
          type: "reading",
          answers: {
            [questionId]: answerValue,
          },
        },
        autoGradingResults: undefined,
        gradingStatus: "auto_graded",
        reviewedBy: undefined,
        reviewedAt: undefined,
        finalizedBy: undefined,
        finalizedAt: undefined,
        submittedAt: new Date().toISOString(),
      },
    ]);

    (gradingRepository.getWritingSubmissionsBySubmissionId as any).mockResolvedValue([]);
    (gradingRepository.getReviewDraftBySubmission as any).mockResolvedValue({
      id: "draft-1",
      submissionId: "sub-1",
      studentId: "stu-1",
      teacherId: "t-1",
      releaseStatus: "draft",
      sectionDrafts: {},
      annotations: [],
      drawings: [],
      overallFeedback: undefined,
      studentVisibleNotes: undefined,
      internalNotes: undefined,
      teacherSummary: { strengths: [], improvementPriorities: [], recommendedPractice: [] },
      checklist: {},
      hasUnsavedChanges: false,
      lastAutoSaveAt: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    (examRepository.getVersionById as any).mockResolvedValue({
      id: "ver-1",
      contentSnapshot: examState,
    });

    render(
      <StudentReviewWorkspace
        submissionId="sub-1"
        onBack={() => {}}
        currentTeacherId="t-1"
        currentTeacherName="Teacher"
      />
    );

    expect(await screen.findByText("Traceback View")).toBeInTheDocument();
    expect(await screen.findByText(answerValue)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^listening$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reading/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^writing$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^speaking$/i })).toBeInTheDocument();
    const initialSectionLoadCount = vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId)
      .mock.calls.length;

    act(() => {
      window.dispatchEvent(
        new CustomEvent("objective-grading-updated", {
          detail: { examId: "exam-1", updatedAt: new Date().toISOString() },
        })
      );
    });

    await waitFor(() => {
      expect(gradingRepository.invalidateSubmissionBundle).toHaveBeenCalledWith("sub-1");
      expect(gradingRepository.getSectionSubmissionsBySubmissionId).toHaveBeenCalledTimes(
        initialSectionLoadCount + 1
      );
    });
  });

  test("shows both writing tasks in the student preview with the correct labels and bands", async () => {
    const { createInitialExamState } = await import("../../../services/examAdapterService");
    const { gradingRepository } = await import("../../../services/gradingRepository");
    const { examRepository } = await import("../../../services/examRepository");
    const { StudentReviewWorkspace } = await import("../StudentReviewWorkspace");

    const examState = createInitialExamState("Exam", "Academic");
    examState.writing.tasks = [
      { taskId: "task1", prompt: "Describe the chart." } as any,
      { taskId: "task2", prompt: "Discuss the opinion." } as any,
    ];

    (gradingRepository.getSubmissionById as any).mockResolvedValue({
      id: "sub-1",
      submissionId: "sub-1",
      scheduleId: "sched-1",
      examId: "exam-1",
      publishedVersionId: "ver-1",
      studentId: "stu-1",
      studentName: "Alice",
      studentEmail: "alice@example.com",
      cohortName: "Cohort",
      submittedAt: new Date().toISOString(),
      timeSpentSeconds: 0,
      gradingStatus: "submitted",
      assignedTeacherId: undefined,
      assignedTeacherName: undefined,
      isFlagged: false,
      flagReason: undefined,
      isOverdue: false,
      dueDate: undefined,
      sectionStatuses: {
        listening: "pending",
        reading: "auto_graded",
        writing: "needs_review",
        speaking: "pending",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    (gradingRepository.getSectionSubmissionsBySubmissionId as any).mockResolvedValue([]);
    (gradingRepository.getWritingSubmissionsBySubmissionId as any).mockResolvedValue([
      {
        id: "write-1",
        submissionId: "sub-1",
        taskId: "task1",
        taskLabel: "Task 1",
        prompt: "Describe the chart.",
        studentText: "Task 1 response",
        wordCount: 3,
        rubricAssessment: null,
        annotations: [],
        overallFeedback: null,
        studentVisibleNotes: null,
        gradingStatus: "needs_review",
        submittedAt: new Date().toISOString(),
        gradedBy: undefined,
        gradedAt: undefined,
        finalizedBy: undefined,
        finalizedAt: undefined,
      },
      {
        id: "write-2",
        submissionId: "sub-1",
        taskId: "task2",
        taskLabel: "Task 2",
        prompt: "Discuss the opinion.",
        studentText: "Task 2 response",
        wordCount: 3,
        rubricAssessment: null,
        annotations: [],
        overallFeedback: null,
        studentVisibleNotes: null,
        gradingStatus: "needs_review",
        submittedAt: new Date().toISOString(),
        gradedBy: undefined,
        gradedAt: undefined,
        finalizedBy: undefined,
        finalizedAt: undefined,
      },
    ]);
    (gradingRepository.getReviewDraftBySubmission as any).mockResolvedValue({
      id: "draft-1",
      submissionId: "sub-1",
      studentId: "stu-1",
      teacherId: "t-1",
      releaseStatus: "ready_to_release",
      sectionDrafts: {
        writing: {
          task1: {
            taskResponseBand: 6,
            coherenceBand: 6.5,
            lexicalBand: 6,
            grammarBand: 5.5,
            overallBand: 6,
            wordCount: 3,
            gradingStatus: "in_review",
            taskResponseNotes: "Task 1 note",
            coherenceNotes: "Task 1 coherence",
            lexicalNotes: "Task 1 lexical",
            grammarNotes: "Task 1 grammar",
          },
          task2: {
            taskResponseBand: 7,
            coherenceBand: 7,
            lexicalBand: 7.5,
            grammarBand: 7,
            overallBand: 7.5,
            wordCount: 3,
            gradingStatus: "in_review",
            taskResponseNotes: "Task 2 note",
            coherenceNotes: "Task 2 coherence",
            lexicalNotes: "Task 2 lexical",
            grammarNotes: "Task 2 grammar",
          },
        },
      },
      annotations: [],
      drawings: [],
      overallFeedback: undefined,
      studentVisibleNotes: undefined,
      internalNotes: undefined,
      teacherSummary: { strengths: [], improvementPriorities: [], recommendedPractice: [] },
      checklist: {},
      hasUnsavedChanges: false,
      lastAutoSaveAt: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    (examRepository.getVersionById as any).mockResolvedValue({
      id: "ver-1",
      contentSnapshot: examState,
    });

    render(
      <StudentReviewWorkspace
        submissionId="sub-1"
        onBack={() => {}}
        currentTeacherId="t-1"
        currentTeacherName="Teacher"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: /preview as student/i }));

    expect(await screen.findByText("Student Report Preview")).toBeInTheDocument();
    expect(await screen.findByText("Writing Task 2")).toBeInTheDocument();
    expect(screen.getByText("Band 7.5")).toBeInTheDocument();
    expect(screen.getAllByText("Task 2 response").length).toBeGreaterThan(0);
  });

  test("does not crash when teacherSummary fields are missing", async () => {
    const { createInitialExamState } = await import("../../../services/examAdapterService");
    const { gradingRepository } = await import("../../../services/gradingRepository");
    const { examRepository } = await import("../../../services/examRepository");
    const { StudentReviewWorkspace } = await import("../StudentReviewWorkspace");

    const examState = createInitialExamState("Exam", "Academic");
    examState.reading.passages = [];

    (gradingRepository.getSubmissionById as any).mockResolvedValue({
      id: "sub-2",
      submissionId: "sub-2",
      scheduleId: "sched-2",
      examId: "exam-2",
      publishedVersionId: "ver-2",
      studentId: "stu-2",
      studentName: "Bob",
      studentEmail: "bob@example.com",
      cohortName: "Cohort",
      submittedAt: new Date().toISOString(),
      timeSpentSeconds: 0,
      gradingStatus: "in_progress",
      assignedTeacherId: undefined,
      assignedTeacherName: undefined,
      isFlagged: false,
      flagReason: undefined,
      isOverdue: false,
      dueDate: undefined,
      sectionStatuses: {
        listening: "pending",
        reading: "pending",
        writing: "pending",
        speaking: "pending",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    (gradingRepository.getSectionSubmissionsBySubmissionId as any).mockResolvedValue([]);
    (gradingRepository.getWritingSubmissionsBySubmissionId as any).mockResolvedValue([]);
    (gradingRepository.getReviewDraftBySubmission as any).mockResolvedValue({
      id: "draft-2",
      submissionId: "sub-2",
      studentId: "stu-2",
      teacherId: "t-1",
      releaseStatus: "draft",
      sectionDrafts: {},
      annotations: [],
      drawings: [],
      overallFeedback: undefined,
      studentVisibleNotes: undefined,
      internalNotes: undefined,
      teacherSummary: {} as any,
      checklist: {},
      hasUnsavedChanges: false,
      lastAutoSaveAt: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    (examRepository.getVersionById as any).mockResolvedValue({
      id: "ver-2",
      contentSnapshot: examState,
    });

    render(
      <StudentReviewWorkspace
        submissionId="sub-2"
        onBack={() => {}}
        currentTeacherId="t-1"
        currentTeacherName="Teacher"
      />
    );

    expect(await screen.findByText("Teacher Summary")).toBeInTheDocument();
    expect(await screen.findByText("Strengths")).toBeInTheDocument();
  });

  test("renders writing responses as plain text without stored html tags", async () => {
    const { createInitialExamState } = await import("../../../services/examAdapterService");
    const { gradingRepository } = await import("../../../services/gradingRepository");
    const { examRepository } = await import("../../../services/examRepository");
    const { StudentReviewWorkspace } = await import("../StudentReviewWorkspace");

    const examState = createInitialExamState("Exam", "Academic");

    (gradingRepository.getSubmissionById as any).mockResolvedValue({
      id: "sub-3",
      submissionId: "sub-3",
      scheduleId: "sched-3",
      examId: "exam-3",
      publishedVersionId: "ver-3",
      studentId: "stu-3",
      studentName: "Cara",
      studentEmail: "cara@example.com",
      cohortName: "Cohort",
      submittedAt: new Date().toISOString(),
      timeSpentSeconds: 0,
      gradingStatus: "in_progress",
      assignedTeacherId: undefined,
      assignedTeacherName: undefined,
      isFlagged: false,
      flagReason: undefined,
      isOverdue: false,
      dueDate: undefined,
      sectionStatuses: {
        listening: "pending",
        reading: "pending",
        writing: "needs_review",
        speaking: "pending",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    (gradingRepository.getSectionSubmissionsBySubmissionId as any).mockResolvedValue([]);
    (gradingRepository.getWritingSubmissionsBySubmissionId as any).mockResolvedValue([
      {
        id: "write-1",
        submissionId: "sub-3",
        taskId: "task1",
        taskLabel: "Task 1",
        prompt:
          '<p class="MsoNormal"><span>You should write something.</span></p><p><b>Use details.</b></p>',
        studentText: "<div>Hello&nbsp;world</div><div>Second line</div>",
        wordCount: 4,
        rubricAssessment: undefined,
        annotations: [],
        overallFeedback: undefined,
        studentVisibleNotes: undefined,
        gradingStatus: "in_review",
        submittedAt: new Date().toISOString(),
        gradedBy: undefined,
        gradedAt: undefined,
      },
    ]);
    (gradingRepository.getReviewDraftBySubmission as any).mockResolvedValue({
      id: "draft-3",
      submissionId: "sub-3",
      studentId: "stu-3",
      teacherId: "t-1",
      releaseStatus: "draft",
      sectionDrafts: {},
      annotations: [],
      drawings: [],
      overallFeedback: undefined,
      studentVisibleNotes: undefined,
      internalNotes: undefined,
      teacherSummary: { strengths: [], improvementPriorities: [], recommendedPractice: [] },
      checklist: {},
      hasUnsavedChanges: false,
      lastAutoSaveAt: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    (examRepository.getVersionById as any).mockResolvedValue({
      id: "ver-3",
      contentSnapshot: examState,
    });

    render(
      <StudentReviewWorkspace
        submissionId="sub-3"
        onBack={() => {}}
        currentTeacherId="t-1"
        currentTeacherName="Teacher"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: /writing/i }));

    expect((await screen.findAllByText(/You should write something/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Use details/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Hello world/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Second line/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/<div>/)).not.toBeInTheDocument();
    expect(screen.queryByText(/MsoNormal/)).not.toBeInTheDocument();

    const printSpy = vi.spyOn(window, "print").mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: /print writing/i }));
    expect(printSpy).toHaveBeenCalledOnce();
    printSpy.mockRestore();
  });

  test("retries release with explicit override after backend override-required conflict", async () => {
    const { createInitialExamState } = await import("../../../services/examAdapterService");
    const { gradingRepository } = await import("../../../services/gradingRepository");
    const { gradingService } = await import("../../../services/gradingService");
    const { examRepository } = await import("../../../services/examRepository");
    const { StudentReviewWorkspace } = await import("../StudentReviewWorkspace");

    const examState = createInitialExamState("Exam", "Academic");
    (examRepository.getVersionById as any).mockResolvedValue({
      id: "ver-4",
      contentSnapshot: examState,
    });

    (gradingRepository.getSubmissionById as any).mockResolvedValue({
      id: "sub-4",
      submissionId: "sub-4",
      scheduleId: "sched-4",
      examId: "exam-4",
      publishedVersionId: "ver-4",
      studentId: "stu-4",
      studentName: "Drew",
      studentEmail: "drew@example.com",
      cohortName: "Cohort",
      submittedAt: new Date().toISOString(),
      timeSpentSeconds: 0,
      gradingStatus: "in_progress",
      assignedTeacherId: undefined,
      assignedTeacherName: undefined,
      isFlagged: true,
      flagReason: "merge_incomplete_override_required",
      isOverdue: false,
      dueDate: undefined,
      sectionStatuses: {
        listening: "pending",
        reading: "auto_graded",
        writing: "needs_review",
        speaking: "pending",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    (gradingRepository.getSectionSubmissionsBySubmissionId as any).mockResolvedValue([]);
    (gradingRepository.getWritingSubmissionsBySubmissionId as any).mockResolvedValue([]);
    (gradingRepository.getReviewDraftBySubmission as any).mockResolvedValue({
      id: "draft-4",
      submissionId: "sub-4",
      studentId: "stu-4",
      teacherId: "t-1",
      releaseStatus: "ready_to_release",
      sectionDrafts: {},
      annotations: [],
      drawings: [],
      overallFeedback: undefined,
      studentVisibleNotes: undefined,
      internalNotes: undefined,
      teacherSummary: { strengths: [], improvementPriorities: [], recommendedPractice: [] },
      checklist: {},
      hasUnsavedChanges: false,
      lastAutoSaveAt: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    (gradingService.releaseResult as any)
      .mockResolvedValueOnce({
        success: false,
        error:
          "Failed to release result: Error: Explicit grader override confirmation is required before release.",
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: "result-4",
        },
      });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <StudentReviewWorkspace
        submissionId="sub-4"
        onBack={() => {}}
        currentTeacherId="t-1"
        currentTeacherName="Teacher"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: /release now/i }));

    await waitFor(() => {
      expect(gradingService.releaseResult).toHaveBeenNthCalledWith(
        1,
        "sub-4",
        "t-1",
        "Teacher",
        false
      );
      expect(gradingService.releaseResult).toHaveBeenNthCalledWith(
        2,
        "sub-4",
        "t-1",
        "Teacher",
        true
      );
    });
    expect(confirmSpy).toHaveBeenCalledOnce();
    confirmSpy.mockRestore();
  });
});
