/**
 * React Query hooks for exam data fetching
 * Provides type-safe, cached, and optimized data fetching with automatic refetching
 */

import { useQuery, useMutation, useQueryClient, UseMutationOptions } from "@tanstack/react-query";
import { examAuthoringFacade } from "../../features/exam-authoring/application/examAuthoringFacade";
import { liveQueryPolicy, queryKeys } from "./queryClient";
import { ExamState, ExamType } from "../../types";
import { ExamSchedule, ExamSessionRuntime, ExamStatus } from "../../types/domain";
import { TransitionResult } from "../../types/domain";

/**
 * Hook to fetch all exams
 */
export function useExams() {
  return useQuery({
    queryKey: queryKeys.exams.lists(),
    queryFn: () => examAuthoringFacade.repository.getAllExamsWithLegacyMigration(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch a single exam by ID
 */
export function useExam(id: string) {
  return useQuery({
    queryKey: queryKeys.exams.details(id),
    queryFn: () => examAuthoringFacade.repository.getExamById(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch exam versions
 */
export function useExamVersions(examId: string) {
  return useQuery({
    queryKey: queryKeys.exams.versions(examId),
    queryFn: () => examAuthoringFacade.repository.getVersionSummaries(examId),
    enabled: !!examId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook to fetch exam events
 */
export function useExamEvents(examId: string, limit = 100) {
  return useQuery({
    queryKey: queryKeys.exams.events(examId),
    queryFn: () => examAuthoringFacade.repository.getEvents(examId, limit),
    enabled: !!examId,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

/**
 * Hook to fetch all schedules
 */
export function useSchedules() {
  return useQuery({
    queryKey: queryKeys.schedules.lists(),
    queryFn: () => examAuthoringFacade.repository.getAllSchedules(),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook to fetch schedules for a specific exam
 */
export function useExamSchedules(examId: string) {
  return useQuery({
    queryKey: [...queryKeys.schedules.lists(), examId],
    queryFn: () => examAuthoringFacade.repository.getSchedulesByExam(examId),
    enabled: !!examId,
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Hook to fetch runtime for a schedule
 */
export function useScheduleRuntime(scheduleId: string) {
  return useQuery({
    queryKey: ["schedule-runtime", scheduleId],
    queryFn: () => examAuthoringFacade.repository.getRuntimeByScheduleId(scheduleId),
    enabled: !!scheduleId,
    ...liveQueryPolicy,
    refetchInterval: 15 * 1000,
  });
}

/**
 * Mutation to create a new exam
 */
export function useCreateExam(
  options?: UseMutationOptions<
    TransitionResult,
    Error,
    { title: string; type: ExamType; initialState: ExamState; owner?: string }
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ title, type, initialState, owner }) =>
      examAuthoringFacade.lifecycle.createExam(title, type, initialState, owner),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.exams.lists() });
      if (data.exam) {
        queryClient.setQueryData(queryKeys.exams.details(data.exam.id), data.exam);
      }
    },
    ...options,
  });
}

/**
 * Mutation to save exam draft
 */
export function useSaveDraft(
  options?: UseMutationOptions<
    TransitionResult,
    Error,
    { examId: string; content: ExamState; actor?: string }
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ examId, content, actor }) =>
      examAuthoringFacade.lifecycle.saveDraft(examId, content, actor),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.exams.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.exams.details(variables.examId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.exams.versions(variables.examId) });
    },
    ...options,
  });
}

/**
 * Mutation to publish an exam
 */
export function usePublishExam(
  options?: UseMutationOptions<
    TransitionResult,
    Error,
    { examId: string; actor?: string; publishNotes?: string }
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ examId, actor, publishNotes }) =>
      examAuthoringFacade.lifecycle.publishExam(examId, actor, publishNotes),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.exams.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.exams.details(variables.examId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.exams.versions(variables.examId) });
    },
    ...options,
  });
}

/**
 * Mutation to delete an exam
 */
export function useDeleteExam(
  options?: UseMutationOptions<TransitionResult, Error, { examId: string; actor?: string }>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ examId, actor }) => examAuthoringFacade.lifecycle.deleteExam(examId, actor),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.exams.lists() });
      queryClient.removeQueries({ queryKey: queryKeys.exams.details(variables.examId) });
    },
    ...options,
  });
}

/**
 * Mutation to transition exam status
 */
export function useTransitionStatus(
  options?: UseMutationOptions<
    TransitionResult,
    Error,
    { examId: string; toStatus: ExamStatus; actor?: string; notes?: string }
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ examId, toStatus, actor, notes }) =>
      examAuthoringFacade.lifecycle.transitionStatus(examId, toStatus, actor, notes),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.exams.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.exams.details(variables.examId) });
    },
    ...options,
  });
}

/**
 * Mutation to save a schedule
 */
export function useSaveSchedule(options?: UseMutationOptions<void, Error, ExamSchedule>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (schedule) => examAuthoringFacade.repository.saveSchedule(schedule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules.lists() });
    },
    ...options,
  });
}

/**
 * Mutation to delete a schedule
 */
export function useDeleteSchedule(options?: UseMutationOptions<void, Error, string>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (scheduleId) => examAuthoringFacade.repository.deleteSchedule(scheduleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules.lists() });
    },
    ...options,
  });
}

/**
 * Mutation to save runtime
 */
export function useSaveRuntime(options?: UseMutationOptions<void, Error, ExamSessionRuntime>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (runtime) => examAuthoringFacade.repository.saveRuntime(runtime),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["schedule-runtime", variables.scheduleId] });
    },
    ...options,
  });
}
