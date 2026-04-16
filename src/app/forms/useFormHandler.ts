/**
 * Form Handler Hook
 * Provides standardized form handling with React Hook Form and Zod validation
 */

import React from 'react';
import { DefaultValues, FieldValues, Resolver, UseFormReturn, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ValidationError } from '../error/errorTypes';
import { logError } from '../error/errorLogger';

type FormSchema<TValues extends FieldValues> = z.ZodType<TValues>;

function createResolver<TValues extends FieldValues>(schema: FormSchema<TValues>): Resolver<TValues> {
  return zodResolver(schema as never) as unknown as Resolver<TValues>;
}

export interface UseFormHandlerOptions<TValues extends FieldValues> {
  schema: FormSchema<TValues>;
  defaultValues?: DefaultValues<TValues>;
  onSubmit?: (values: TValues) => Promise<void> | void;
  onSuccess?: (values: TValues) => void;
  onError?: (error: Error) => void;
  mode?: 'onSubmit' | 'onBlur' | 'onChange' | 'onTouched' | 'all';
  resetOnSubmit?: boolean;
}

export type UseFormHandlerReturn<TValues extends FieldValues> = UseFormReturn<TValues> & {
  submitForm: (e?: React.BaseSyntheticEvent) => Promise<void>;
  isSubmitting: boolean;
  submitError: Error | null;
  clearError: () => void;
};

/**
 * Hook for standardized form handling with validation
 */
export function useFormHandler<TValues extends FieldValues>({
  schema,
  defaultValues,
  onSubmit,
  onSuccess,
  onError,
  mode = 'onSubmit',
  resetOnSubmit = false,
}: UseFormHandlerOptions<TValues>): UseFormHandlerReturn<TValues> {
  const methods = useForm<TValues>({
    resolver: createResolver(schema),
    mode,
    ...(defaultValues ? { defaultValues } : {}),
  }) as UseFormReturn<TValues>;

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<Error | null>(null);

  const submitForm = async (e?: React.BaseSyntheticEvent) => {
    e?.preventDefault();

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      const values = await methods.trigger();

      if (!values) {
        throw new ValidationError('Form validation failed');
      }

      const validValues = methods.getValues();

      if (onSubmit) {
        await onSubmit(validValues);
      }

      if (onSuccess) {
        onSuccess(validValues);
      }

      if (resetOnSubmit) {
        methods.reset(defaultValues);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Form submission failed');
      setSubmitError(err);
      logError(err, { context: 'FormHandler' });

      if (onError) {
        onError(err);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearError = () => {
    setSubmitError(null);
  };

  return {
    ...methods,
    submitForm,
    isSubmitting,
    submitError,
    clearError,
  } as UseFormHandlerReturn<TValues>;
}

/**
 * Hook for multi-step form handling
 */
export interface MultiStepFormOptions<TValues extends FieldValues> {
  schemas: Array<FormSchema<TValues>>;
  defaultValues?: DefaultValues<TValues>;
  onSubmit?: (values: TValues) => Promise<void> | void;
}

export type MultiStepFormReturn<TValues extends FieldValues> = UseFormHandlerReturn<TValues> & {
  currentStep: number;
  totalSteps: number;
  nextStep: () => void;
  previousStep: () => void;
  goToStep: (step: number) => void;
  isFirstStep: boolean;
  isLastStep: boolean;
  canGoNext: boolean;
};

export function useMultiStepForm<TValues extends FieldValues>({
  schemas,
  defaultValues,
  onSubmit,
}: MultiStepFormOptions<TValues>): MultiStepFormReturn<TValues> {
  const [currentStep, setCurrentStep] = React.useState(0);
  const totalSteps = schemas.length;

  const currentSchema = schemas[currentStep] ?? schemas[0];
  if (!currentSchema) {
    throw new Error('useMultiStepForm requires at least one schema');
  }

  const methods = useForm<TValues>({
    resolver: createResolver(currentSchema),
    mode: 'onChange',
    ...(defaultValues ? { defaultValues } : {}),
  }) as UseFormReturn<TValues>;

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<Error | null>(null);

  const validateCurrentStep = async () => {
    const fields = currentSchema instanceof z.ZodObject
      ? (Object.keys(currentSchema.shape) as Parameters<typeof methods.trigger>[0])
      : undefined;
    return fields ? methods.trigger(fields) : methods.trigger();
  };

  const nextStep = async () => {
    const isValid = await validateCurrentStep();
    if (isValid && currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const previousStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const goToStep = async (step: number) => {
    if (step >= 0 && step < totalSteps) {
      // Validate all previous steps
      if (step > currentStep) {
        const isValid = await validateCurrentStep();
        if (!isValid) return;
      }
      setCurrentStep(step);
    }
  };

  const submitForm = async (e?: React.BaseSyntheticEvent) => {
    e?.preventDefault();

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      // Validate all steps
      const isValid = await methods.trigger();
      if (!isValid) {
        throw new ValidationError('Form validation failed');
      }

      const values = methods.getValues();

      if (onSubmit) {
        await onSubmit(values);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Form submission failed');
      setSubmitError(err);
      logError(err, { context: 'MultiStepFormHandler' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearError = () => {
    setSubmitError(null);
  };

  const canGoNext = currentStep < totalSteps - 1;

  return {
    ...methods,
    submitForm,
    isSubmitting,
    submitError,
    clearError,
    currentStep,
    totalSteps,
    nextStep,
    previousStep,
    goToStep,
    isFirstStep: currentStep === 0,
    isLastStep: currentStep === totalSteps - 1,
    canGoNext,
  } as MultiStepFormReturn<TValues>;
}
