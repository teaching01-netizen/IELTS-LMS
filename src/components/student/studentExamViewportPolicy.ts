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
  keyboardHeight: number | null;
}

export type StudentExamViewportMode =
  | 'bootstrapping'
  | 'stable'
  | 'pinch-active'
  | 'topology-recovery';

export type StudentExamKeyboardPhase = 'clear' | 'armed' | 'occluding' | 'recovering';

type ResumableStudentExamViewportMode = Exclude<StudentExamViewportMode, 'pinch-active'>;

export interface StudentExamViewportPolicyState {
  mode: StudentExamViewportMode;
  keyboardPhase: StudentExamKeyboardPhase;
  editableFocusActive: boolean;
  closedHeight: number;
  liveOffsetTop: number;
  publishedRect: StudentExamViewportRect;
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

function publish(
  state: StudentExamViewportPolicyState,
  height: number,
  offsetTop: number,
): StudentExamViewportPolicyState {
  return {
    ...state,
    liveOffsetTop: offsetTop,
    publishedRect: { height, offsetTop },
  };
}

function acceptClosedHeight(
  state: StudentExamViewportPolicyState,
  height: number,
  offsetTop: number,
  layoutWidth: number,
): StudentExamViewportPolicyState {
  return {
    ...publish(state, height, offsetTop),
    closedHeight: height,
    layoutWidth,
  };
}

export function createStudentExamViewportPolicy(
  initialMeasurement: StudentExamViewportMeasurement,
): StudentExamViewportPolicyState {
  const initialRect = rectFromMeasurement(initialMeasurement) ?? { height: 1, offsetTop: 0 };

  return {
    mode: 'bootstrapping',
    keyboardPhase: 'clear',
    editableFocusActive: false,
    closedHeight: initialRect.height,
    liveOffsetTop: initialRect.offsetTop,
    publishedRect: initialRect,
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

      const layoutWidth = finitePositive(event.measurement.layoutWidth) ?? state.layoutWidth;
      const keyboardPositive =
        event.measurement.keyboardHeight !== null && event.measurement.keyboardHeight > 0;
      const keyboardExplicitlyClear = event.measurement.keyboardHeight === 0;

      if (state.mode === 'bootstrapping' || state.mode === 'topology-recovery') {
        return acceptClosedHeight(state, rect.height, rect.offsetTop, layoutWidth);
      }

      if (rect.height >= state.closedHeight) {
        return {
          ...acceptClosedHeight(state, rect.height, rect.offsetTop, layoutWidth),
          keyboardPhase: state.editableFocusActive ? 'armed' : 'clear',
        };
      }

      if (keyboardPositive) {
        return {
          ...publish(state, state.closedHeight, rect.offsetTop),
          keyboardPhase: 'occluding',
        };
      }

      if (state.keyboardPhase === 'clear') {
        return acceptClosedHeight(state, rect.height, rect.offsetTop, layoutWidth);
      }

      if (keyboardExplicitlyClear) {
        return {
          ...publish(state, state.closedHeight, rect.offsetTop),
          keyboardPhase: state.editableFocusActive ? 'armed' : 'recovering',
        };
      }

      if (state.keyboardPhase === 'armed') {
        return {
          ...publish(state, state.closedHeight, rect.offsetTop),
          keyboardPhase: 'occluding',
        };
      }

      return publish(state, state.closedHeight, rect.offsetTop);
    }

    case 'editable-focus-entered':
      return {
        ...state,
        editableFocusActive: true,
        keyboardPhase: state.keyboardPhase === 'occluding' ? 'occluding' : 'armed',
      };

    case 'editable-focus-left':
      return {
        ...state,
        editableFocusActive: false,
        keyboardPhase: 'recovering',
      };

    case 'bootstrap-recovery-started':
      if (state.mode === 'pinch-active') {
        return state;
      }
      return {
        ...state,
        mode: 'bootstrapping',
        modeBeforePinch: null,
      };

    case 'topology-recovery-started':
      if (state.mode === 'pinch-active') {
        return state;
      }
      return {
        ...state,
        mode: 'topology-recovery',
        keyboardPhase: state.editableFocusActive ? 'armed' : 'clear',
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
