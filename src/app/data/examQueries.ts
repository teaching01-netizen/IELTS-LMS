/**
 * React Query hooks for exam data fetching
 * Provides type-safe, cached, and optimized data fetching with automatic refetching
 */

import { useQuery, useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query';
import { examRepository } from '../../services/examRepository';
import { examLifecycleService } from '../../services/examLifecycleService';
import { queryKeys } from './queryClient';
import { ExamState } from '../../types';
import { ExamSchedule, ExamSessionRuntime, ExamStatus } from '../../types/domain';
import { TransitionResult } from '../../types/domain';

/**
 * Hook to fetch all exams
 */
export function useExams() {
  return useQuery({
    queryKey: queryKeys.exams.lists(),
    queryFn: () => examRepository.getAllExamsWithLegacyMigration(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch a single exam by ID
 */
export function useExam(id: string) {
  return useQuery({
    queryKey: queryKeys.exams.details(id),
    queryFn: () => examRepository.getExamById(id),
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
    queryFn: () => examRepository.getVersionSummaries(examId),
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
    queryFn: () => examRepository.getEvents(examId, limit),
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
    queryFn: () => examRepository.getAllSchedules(),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook to fetch schedules for a specific exam
 */
export function useExamSchedules(examId: string) {
  return useQuery({
    queryKey: [...queryKeys.schedules.lists(), examId],
    queryFn: () => examRepository.getSchedulesByExam(examId),
    enabled: !!examId,
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Hook to fetch runtime for a schedule
 */
export function useScheduleRuntime(scheduleId: string) {
  return useQuery({
    queryKey: ['schedule-runtime', scheduleId],
    queryFn: () => examRepository.getRuntimeByScheduleId(scheduleId),
    enabled: !!scheduleId,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 30 * 1000, // Poll every 30 seconds
  });
}

/**
 * Mutation to create a new exam
 */
export function useCreateExam(options?: UseMutationOptions<TransitionResult, Error, { title: string; type: 'Academic' | 'General Training'; initialState: ExamState; owner?: string }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ title, type, initialState, owner }) => 
      examLifecycleService.createExam(title, type, initialState, owner),
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
export function useSaveDraft(options?: UseMutationOptions<TransitionResult, Error, { examId: string; content: ExamState; actor?: string }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ examId, content, actor }) => 
      examLifecycleService.saveDraft(examId, content, actor),
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
export function usePublishExam(options?: UseMutationOptions<TransitionResult, Error, { examId: string; actor?: string; publishNotes?: string }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ examId, actor, publishNotes }) => 
      examLifecycleService.publishExam(examId, actor, publishNotes),
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
export function useDeleteExam(options?: UseMutationOptions<TransitionResult, Error, { examId: string; actor?: string }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ examId, actor }) => 
      examLifecycleService.deleteExam(examId, actor),
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
export function useTransitionStatus(options?: UseMutationOptions<TransitionResult, Error, { examId: string; toStatus: ExamStatus; actor?: string; notes?: string }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ examId, toStatus, actor, notes }) => 
      examLifecycleService.transitionStatus(examId, toStatus, actor, notes),
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
    mutationFn: (schedule) => examRepository.saveSchedule(schedule),
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
    mutationFn: (scheduleId) => examRepository.deleteSchedule(scheduleId),
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
    mutationFn: (runtime) => examRepository.saveRuntime(runtime),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['schedule-runtime', variables.scheduleId] });
    },
    ...options,
  });
}
