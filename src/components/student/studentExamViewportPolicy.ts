export interface StudentExamViewportRect {
  height: number;
  offsetTop: number;
}

export interface StudentExamViewportMeasurement {
  visualHeight: number | null;
  layoutHeight: number;
  offsetTop: number;
  layoutWidth: number;
  scale: number;
}

export type StudentExamViewportMode =
  | 'bootstrapping'
  | 'stable'
  | 'keyboard-active'
  | 'keyboard-recovery'
  | 'pinch-active'
  | 'topology-recovery';

type ResumableStudentExamViewportMode = Exclude<StudentExamViewportMode, 'pinch-active'>;

export interface StudentExamViewportPolicyState {
  mode: StudentExamViewportMode;
  trustedRect: StudentExamViewportRect;
  publishedRect: StudentExamViewportRect;
  keyboardBaseline: StudentExamViewportRect | null;
  layoutWidth: number;
  modeBeforePinch: ResumableStudentExamViewportMode | null;
}

export type StudentExamViewportPolicyEvent =
  | { type: 'measurement-received'; measurement: StudentExamViewportMeasurement }
  | { type: 'editable-focus-entered' }
  | { type: 'editable-focus-left' }
  | { type: 'bootstrap-recovery-started' }
  | { type: 'topology-recovery-started' }
  | { type: 'pinch-started' }
  | { type: 'pinch-finished' }
  | { type: 'recovery-finished' };

const NATIVE_SCALE_TOLERANCE = 0.01;

function finitePositive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function finiteNonNegative(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
}

function rectFromMeasurement(
  measurement: StudentExamViewportMeasurement,
): StudentExamViewportRect | null {
  const height = finitePositive(measurement.visualHeight) ?? finitePositive(measurement.layoutHeight);
  if (height === null) {
    return null;
  }

  return {
    height,
    offsetTop: finiteNonNegative(measurement.offsetTop),
  };
}

function hasNativeScale(measurement: StudentExamViewportMeasurement): boolean {
  return (
    Number.isFinite(measurement.scale) &&
    Math.abs(measurement.scale - 1) <= NATIVE_SCALE_TOLERANCE
  );
}

function acceptTrustedRect(
  state: StudentExamViewportPolicyState,
  rect: StudentExamViewportRect,
  measurement: StudentExamViewportMeasurement,
  mode: StudentExamViewportMode = state.mode,
): StudentExamViewportPolicyState {
  return {
    ...state,
    mode,
    trustedRect: rect,
    publishedRect: rect,
    layoutWidth: finitePositive(measurement.layoutWidth) ?? state.layoutWidth,
  };
}

export function createStudentExamViewportPolicy(
  initialMeasurement: StudentExamViewportMeasurement,
): StudentExamViewportPolicyState {
  const initialRect = rectFromMeasurement(initialMeasurement) ?? { height: 1, offsetTop: 0 };

  return {
    mode: 'bootstrapping',
    trustedRect: initialRect,
    publishedRect: initialRect,
    keyboardBaseline: null,
    layoutWidth: finitePositive(initialMeasurement.layoutWidth) ?? 1,
    modeBeforePinch: null,
  };
}

export function reduceStudentExamViewportPolicy(
  state: StudentExamViewportPolicyState,
  event: StudentExamViewportPolicyEvent,
): StudentExamViewportPolicyState {
  switch (event.type) {
    case 'measurement-received': {
      const rect = rectFromMeasurement(event.measurement);
      if (rect === null || !hasNativeScale(event.measurement) || state.mode === 'pinch-active') {
        return state;
      }

      if (state.mode === 'keyboard-active') {
        const baseline = state.keyboardBaseline ?? state.trustedRect;
        return {
          ...state,
          publishedRect: {
            height: baseline.height,
            offsetTop: rect.offsetTop,
          },
        };
      }

      if (state.mode === 'keyboard-recovery') {
        const baseline = state.keyboardBaseline ?? state.trustedRect;
        const fullHeightReturned =
          rect.height >= baseline.height && rect.offsetTop <= baseline.offsetTop;
        if (!fullHeightReturned) {
          return {
            ...state,
            publishedRect: baseline,
          };
        }

        return {
          ...acceptTrustedRect(state, rect, event.measurement, 'stable'),
          keyboardBaseline: null,
        };
      }

      return acceptTrustedRect(state, rect, event.measurement);
    }

    case 'editable-focus-entered': {
      const baseline = state.keyboardBaseline ?? state.trustedRect;
      return {
        ...state,
        mode: 'keyboard-active',
        keyboardBaseline: baseline,
        publishedRect: baseline,
      };
    }

    case 'editable-focus-left': {
      const baseline = state.keyboardBaseline ?? state.trustedRect;
      return {
        ...state,
        mode: 'keyboard-recovery',
        keyboardBaseline: baseline,
        trustedRect: baseline,
        publishedRect: baseline,
      };
    }

    case 'bootstrap-recovery-started':
      if (state.mode === 'pinch-active') {
        return state;
      }
      return {
        ...state,
        mode: 'bootstrapping',
        keyboardBaseline: null,
        modeBeforePinch: null,
      };

    case 'topology-recovery-started':
      if (state.mode === 'pinch-active') {
        return state;
      }
      return {
        ...state,
        mode: 'topology-recovery',
        keyboardBaseline: null,
        modeBeforePinch: null,
      };

    case 'pinch-started':
      if (state.mode === 'pinch-active') {
        return state;
      }
      return {
        ...state,
        mode: 'pinch-active',
        modeBeforePinch: state.mode,
        publishedRect: state.trustedRect,
      };

    case 'pinch-finished':
      if (state.mode !== 'pinch-active') {
        return state;
      }
      return {
        ...state,
        mode: state.modeBeforePinch ?? 'stable',
        modeBeforePinch: null,
      };

    case 'recovery-finished':
      if (state.mode !== 'bootstrapping' && state.mode !== 'topology-recovery') {
        return state;
      }
      return {
        ...state,
        mode: 'stable',
      };
  }
}
