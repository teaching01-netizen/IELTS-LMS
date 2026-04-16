export async function seedDevelopmentFixtures() {
  if (!import.meta.env.DEV) {
    return;
  }

  const { seedGradingData } = await import('../utils/gradingSeedData');
  await seedGradingData();
}
