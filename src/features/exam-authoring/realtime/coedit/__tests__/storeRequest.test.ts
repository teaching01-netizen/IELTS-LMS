import { describe, expect, it } from "vitest";
import {
  COEDIT_STORE_REQUEST_TYPE,
  createCoeditStoreRequest,
  isCoeditStoreRequest,
  parseCoeditStoreRequest,
} from "../storeRequest";

const WORKSPACE_DOCUMENT_NAME = "coedit:v2:2f1b6c1e-6a0a-4a5b-9f0e-9d3a2f4c5b6d";
const PROMPT_DOCUMENT_NAME = "coedit:v1:2f1b6c1e-6a0a-4a5b-9f0e-9d3a2f4c5b6d";

describe("co-edit store request", () => {
  it("names the room in either schema", () => {
    expect(createCoeditStoreRequest(WORKSPACE_DOCUMENT_NAME)).toEqual({
      type: "coedit.store",
      documentName: WORKSPACE_DOCUMENT_NAME,
    });
    // A save can be retried in the per-question prompt room too, so the request
    // is not workspace-only.
    expect(isCoeditStoreRequest(createCoeditStoreRequest(PROMPT_DOCUMENT_NAME))).toBe(true);
  });

  it("refuses a room name this client invented", () => {
    for (const name of ["coedit:v2:", "coedit:v3:abc", "my-room", "coedit:v2:has space", " coedit:v2:abc "]) {
      expect(() => createCoeditStoreRequest(name)).toThrow();
    }
  });

  it("ignores every payload that is not this frame", () => {
    const valid = JSON.stringify(createCoeditStoreRequest(WORKSPACE_DOCUMENT_NAME));
    expect(parseCoeditStoreRequest(valid)).toEqual(createCoeditStoreRequest(WORKSPACE_DOCUMENT_NAME));

    expect(parseCoeditStoreRequest("not json")).toBeNull();
    expect(parseCoeditStoreRequest(null)).toBeNull();
    expect(parseCoeditStoreRequest([])).toBeNull();
    expect(parseCoeditStoreRequest(JSON.stringify({ type: COEDIT_STORE_REQUEST_TYPE }))).toBeNull();
    expect(parseCoeditStoreRequest(JSON.stringify({ documentName: WORKSPACE_DOCUMENT_NAME }))).toBeNull();
    // Another protocol's frame is not a store request, however much it looks
    // like one.
    expect(
      parseCoeditStoreRequest(
        JSON.stringify({ type: "coedit.seed", documentName: WORKSPACE_DOCUMENT_NAME, seedId: "seed-0" }),
      ),
    ).toBeNull();
    // No field beyond the two the frame declares: a request must not become a
    // way to send content or identity into the room.
    expect(
      parseCoeditStoreRequest(
        JSON.stringify({
          type: COEDIT_STORE_REQUEST_TYPE,
          documentName: WORKSPACE_DOCUMENT_NAME,
          value: "smuggled",
        }),
      ),
    ).toBeNull();
  });

  it("refuses a request for a room the connection is not handling", () => {
    const foreign = JSON.stringify(createCoeditStoreRequest(PROMPT_DOCUMENT_NAME));
    expect(parseCoeditStoreRequest(foreign, { documentName: WORKSPACE_DOCUMENT_NAME })).toBeNull();
    expect(
      parseCoeditStoreRequest(JSON.stringify(createCoeditStoreRequest(WORKSPACE_DOCUMENT_NAME)), {
        documentName: WORKSPACE_DOCUMENT_NAME,
      }),
    ).not.toBeNull();
  });
});
