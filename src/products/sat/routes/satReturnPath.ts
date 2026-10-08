const EXAM_RESPONSES_PATH = /^\/sat\/exams\/[^/?#]+\/responses(?:\?.*)?$/;

/**
 * True for the exam workspace's Responses tab (with any filters). Result pages
 * accept it as a return target so Back lands on the tab the staff member came
 * from; anything else is ignored so a crafted `state.from` can never redirect
 * outside the SAT results surfaces.
 */
export function isExamResponsesPath(value: unknown): value is string {
  return typeof value === 'string' && EXAM_RESPONSES_PATH.test(value);
}

const EXAM_DELIVERY_PATH = /^\/sat\/exams\/[^/?#]+\/access(?:\?.*)?$/;

/** True for an exam's Delivery page, so the session room can offer a way back to it. */
export function isExamDeliveryPath(value: unknown): value is string {
  return typeof value === 'string' && EXAM_DELIVERY_PATH.test(value);
}
