import type { ExamSchedule } from "../../../types/domain";

export type SatSessionType = "practice" | "classroom" | "classroom_lower" | "classroom_higher" | "classroom_staff";

export const SAT_SESSION_TYPE_LABELS: Record<SatSessionType, string> = {
  practice: "Standard practice",
  classroom: "Classroom (adaptive Module 2)",
  classroom_lower: "Classroom (everyone gets easier Module 2)",
  classroom_higher: "Classroom (everyone gets harder Module 2)",
  classroom_staff: "Classroom (teacher picks Module 2 per student)",
};

export const SAT_SESSION_TYPE_REQUEST: Record<SatSessionType, Pick<ExamSchedule, "satSessionMode" | "satRoutePolicy">> = {
  practice: {},
  classroom: { satSessionMode: "classroom" },
  classroom_lower: { satSessionMode: "classroom", satRoutePolicy: "force_lower" },
  classroom_higher: { satSessionMode: "classroom", satRoutePolicy: "force_higher" },
  classroom_staff: { satSessionMode: "classroom", satRoutePolicy: "staff_selects" },
};

/** The session type a stored/requested mode + route policy pair selects. */
export function satSessionTypeOf(
  fields: Pick<ExamSchedule, "satSessionMode" | "satRoutePolicy">,
): SatSessionType {
  if (fields.satSessionMode !== "classroom") return "practice";
  switch (fields.satRoutePolicy) {
    case "force_lower":
      return "classroom_lower";
    case "force_higher":
      return "classroom_higher";
    case "staff_selects":
      return "classroom_staff";
    default:
      return "classroom";
  }
}
