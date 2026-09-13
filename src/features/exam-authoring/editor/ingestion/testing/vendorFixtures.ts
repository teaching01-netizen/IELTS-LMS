/**
 * Phase 01 — vendor fixture registry stub.
 *
 * Real fixtures land in phases 02-06. The registry shape is frozen here so
 * vendor files plug in without rework; phase-00 baseline files under
 * testing/fixtures/baseline are reference-only and stay untouched.
 */
export interface VendorFixtureRef {
  id: string;
  vendor: string;
  sourceKind: "text" | "html" | "spreadsheet" | "image" | "pdf-text";
  inputPath: string;
  expectedAstPath: string;
}

const registry: VendorFixtureRef[] = [];

export function listVendorFixtures(): readonly VendorFixtureRef[] {
  return registry;
}

export function registerVendorFixture(fixture: VendorFixtureRef): void {
  if (!registry.some((entry) => entry.id === fixture.id)) {
    registry.push(fixture);
  }
}

export function clearVendorFixtures(): void {
  registry.length = 0;
}
