import { backendGet, backendPost } from "../infrastructure/examAuthoringBackendGateway";
import type { CreateSatRoomRequest, SatRoomReceipt } from "../contracts/satCreateRoom";

export const satCreateRoomApi = {
  /** POST /sat/exams/{id}/rooms — validates, captures/reuses the release, creates the room. */
  create(examId: string, request: CreateSatRoomRequest): Promise<SatRoomReceipt> {
    return backendPost<SatRoomReceipt, CreateSatRoomRequest>(
      `/v1/sat/exams/${encodeURIComponent(examId)}/rooms`,
      request
    );
  },
  /** The caller's own committed operation; 404 OPERATION_NOT_FOUND when none committed. */
  operation(operationKey: string): Promise<SatRoomReceipt> {
    return backendGet<SatRoomReceipt>(`/v1/sat/room-operations/${encodeURIComponent(operationKey)}`);
  },
};
