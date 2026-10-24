// @vitest-environment node
import vectors from "../../../../backend/go/internal/attempts/testdata/sat_frozen_hash_vectors.json";
import { hashFrozenResponseManifest, hashResponsePayload } from "../responseCanonicalHash";
import type { ResponsePayload } from "../types";

describe("SAT frozen response hashing", () => {
  it.each(vectors.responses)("matches the Go fixture for $name", async (vector) => {
    await expect(hashResponsePayload(vector.payload as ResponsePayload)).resolves.toBe(vector.hash);
  });

  it("hashes the complete sorted frontier using the same Go fixture", async () => {
    await expect(hashFrozenResponseManifest(vectors.manifest.entries)).resolves.toBe(vectors.manifest.hash);
  });
});
