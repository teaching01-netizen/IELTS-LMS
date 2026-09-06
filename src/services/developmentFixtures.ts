export async function seedDevelopmentFixtures() {
  if (!import.meta.env.DEV) {
    return;
  }

  // The Go-backed grading queue owns its fixtures and persistence. Running
  // the legacy browser-only seed here makes redundant requests and can create
  // schedule-id/session-id mismatches while the backend is authoritative.
  if (import.meta.env["VITE_FEATURE_USE_BACKEND_GRADING"] === "true") {
    return;
  }

  const { seedGradingData } = await import("../utils/gradingSeedData");
  await seedGradingData();
}
