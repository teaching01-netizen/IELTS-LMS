export async function seedDevelopmentFixtures() {
  if (!import.meta.env.DEV) {
    return;
  }

  if (
    String(
      import.meta.env['VITE_FEATURE_USE_BACKEND_GRADING'] ??
        import.meta.env['FEATURE_USE_BACKEND_GRADING'] ??
        'false',
    ) === 'true'
  ) {
    return;
  }

  const { seedGradingData } = await import('../utils/gradingSeedData');
  await seedGradingData();
}
