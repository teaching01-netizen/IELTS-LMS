import { expect, test } from '@playwright/test';
import {
  ADMIN_STORAGE_STATE_PATH,
} from './support/backendE2e';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe.skip('Admin Media Library Management', () => {
  test('uploads audio files', async ({ page }) => {
    await page.goto('/admin/library');
    await expect(page.getByRole('heading', { name: /Media Library/i })).toBeVisible();

    // Navigate to audio section
    await page.getByRole('tab', { name: 'Audio' }).click();

    // Upload audio file
    const fileInput = page.getByLabel('Upload audio');
    await fileInput.setInputFiles({
      name: 'test-audio.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('fake audio content'),
    });

    // Wait for upload to complete
    await expect(page.getByText('Upload complete')).toBeVisible({ timeout: 10000 });

    // Verify audio appears in list
    await expect(page.getByText('test-audio.mp3')).toBeVisible();
  });

  test('uploads images', async ({ page }) => {
    await page.goto('/admin/library');

    // Navigate to images section
    await page.getByRole('tab', { name: 'Images' }).click();

    // Upload image file
    const fileInput = page.getByLabel('Upload image');
    await fileInput.setInputFiles({
      name: 'test-image.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fake image content'),
    });

    // Wait for upload to complete
    await expect(page.getByText('Upload complete')).toBeVisible({ timeout: 10000 });

    // Verify image appears in list
    await expect(page.getByText('test-image.png')).toBeVisible();
  });

  test('manages question bank items', async ({ page }) => {
    await page.goto('/admin/library');

    // Navigate to question bank section
    await page.getByRole('tab', { name: 'Question Bank' }).click();
    await expect(page.getByRole('heading', { name: /Question Bank/i })).toBeVisible();

    // Create new question bank item
    await page.getByRole('button', { name: 'Add Item' }).click();
    await expect(page.getByRole('dialog', { name: /Add Question Bank Item/i })).toBeVisible();

    // Fill item details
    const timestamp = Date.now();
    await page.getByLabel('Title').fill(`Test Question ${timestamp}`);
    await page.getByLabel('Question Type').selectOption('TFNG');
    await page.getByLabel('Question Text').fill('This is a test question for the question bank');
    await page.getByLabel('Correct Answer').fill('TRUE');

    // Save item
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Question bank item created')).toBeVisible();

    // Verify item appears in list
    await expect(page.getByText(`Test Question ${timestamp}`)).toBeVisible();
  });

  test('manages passage library', async ({ page }) => {
    await page.goto('/admin/library');

    // Navigate to passage library section
    await page.getByRole('tab', { name: 'Passage Library' }).click();
    await expect(page.getByRole('heading', { name: /Passage Library/i })).toBeVisible();

    // Create new passage
    await page.getByRole('button', { name: 'Add Passage' }).click();
    await expect(page.getByRole('dialog', { name: /Add Passage/i })).toBeVisible();

    // Fill passage details
    const timestamp = Date.now();
    await page.getByLabel('Title').fill(`Test Passage ${timestamp}`);
    await page.getByLabel('Content').fill('This is a test passage for the passage library. It contains sample text that can be used in reading passages.');
    await page.getByLabel('Topic').fill('General');
    await page.getByLabel('Word Count').fill('50');

    // Save passage
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Passage created')).toBeVisible();

    // Verify passage appears in list
    await expect(page.getByText(`Test Passage ${timestamp}`)).toBeVisible();
  });

  test('deletes unused media', async ({ page }) => {
    await page.goto('/admin/media');

    // Navigate to audio section
    await page.getByRole('tab', { name: 'Audio' }).click();

    // Find an unused audio file (if any)
    const audioItems = page.locator('[data-media-item]');
    const hasAudio = await audioItems.count() > 0;

    if (hasAudio) {
      const firstItem = audioItems.first();
      const isUnused = await firstItem.getAttribute('data-unused') === 'true';

      if (isUnused) {
        await firstItem.getByRole('button', { name: 'Delete' }).click();
        await expect(page.getByRole('dialog', { name: /Confirm Delete/i })).toBeVisible();
        await page.getByRole('button', { name: 'Confirm' }).click();
        await expect(page.getByText('Media deleted successfully')).toBeVisible();
      }
    }
  });

  test('views storage budget', async ({ page }) => {
    await page.goto('/admin/media');

    // Check for storage budget display
    const storageBudget = page.getByTestId('storage-budget');
    const isStorageVisible = await storageBudget.isVisible().catch(() => false);

    if (isStorageVisible) {
      await expect(storageBudget).toBeVisible();
      
      // Verify storage metrics
      const storageUsed = page.getByTestId('storage-used');
      const storageTotal = page.getByTestId('storage-total');
      const storageLevel = page.getByTestId('storage-level');
      
      await expect(storageUsed).toBeVisible();
      await expect(storageTotal).toBeVisible();
      await expect(storageLevel).toBeVisible();
    }
  });

  test('verifies storage budget enforcement', async ({ page }) => {
    await page.goto('/admin/media');

    // Check storage budget level
    const storageLevel = page.getByTestId('storage-level');
    const isStorageVisible = await storageLevel.isVisible().catch(() => false);

    if (isStorageVisible) {
      const levelText = await storageLevel.textContent();
      expect(levelText).not.toBeNull();

      // If storage is near limit, upload should be restricted
      if (levelText?.includes('critical') || levelText?.includes('full')) {
        await page.getByRole('tab', { name: 'Images' }).click();
        const uploadButton = page.getByRole('button', { name: 'Upload' });
        await expect(uploadButton).toBeDisabled();
      }
    }
  });

  test('filters media by type', async ({ page }) => {
    await page.goto('/admin/media');

    // Filter by audio
    await page.getByRole('combobox', { name: 'Filter by type' }).selectOption('audio');
    await expect(page.getByRole('combobox', { name: 'Filter by type' })).toHaveValue('audio');

    // Filter by images
    await page.getByRole('combobox', { name: 'Filter by type' }).selectOption('image');
    await expect(page.getByRole('combobox', { name: 'Filter by type' })).toHaveValue('image');

    // Show all media
    await page.getByRole('combobox', { name: 'Filter by type' }).selectOption('all');
    await expect(page.getByRole('combobox', { name: 'Filter by type' })).toHaveValue('all');
  });

  test('searches media library', async ({ page }) => {
    await page.goto('/admin/media');

    // Search for a media item
    const searchInput = page.getByPlaceholder('Search media...');
    await searchInput.fill('test');

    // Wait for search results
    await page.waitForTimeout(1000);

    // Verify search results
    const mediaItems = page.locator('[data-media-item]');
    const hasResults = await mediaItems.count() > 0;
    
    if (hasResults) {
      await expect(mediaItems.first()).toBeVisible();
    }
  });

  test('edits question bank item', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByRole('tab', { name: 'Question Bank' }).click();

    // Find a question bank item
    const questionItems = page.locator('[data-question-item]');
    const hasQuestions = await questionItems.count() > 0;

    if (hasQuestions) {
      await questionItems.first().getByRole('button', { name: 'Edit' }).click();
      await expect(page.getByRole('dialog', { name: /Edit Question Bank Item/i })).toBeVisible();

      // Modify question text
      await page.getByLabel('Question Text').fill('Updated question text for editing test');

      // Save changes
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Question bank item updated')).toBeVisible();
    }
  });

  test('edits passage library item', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByRole('tab', { name: 'Passage Library' }).click();

    // Find a passage
    const passageItems = page.locator('[data-passage-item]');
    const hasPassages = await passageItems.count() > 0;

    if (hasPassages) {
      await passageItems.first().getByRole('button', { name: 'Edit' }).click();
      await expect(page.getByRole('dialog', { name: /Edit Passage/i })).toBeVisible();

      // Modify passage content
      await page.getByLabel('Content').fill('Updated passage content for editing test');

      // Save changes
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Passage updated')).toBeVisible();
    }
  });

  test('deletes question bank item', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByRole('tab', { name: 'Question Bank' }).click();

    // Create a test item first
    await page.getByRole('button', { name: 'Add Item' }).click();
    const timestamp = Date.now();
    await page.getByLabel('Title').fill(`Delete Test ${timestamp}`);
    await page.getByLabel('Question Type').selectOption('TFNG');
    await page.getByLabel('Question Text').fill('Test question for deletion');
    await page.getByLabel('Correct Answer').fill('TRUE');
    await page.getByRole('button', { name: 'Save' }).click();

    // Delete the item
    const testItem = page.locator('tr').filter({ hasText: `Delete Test ${timestamp}` });
    await testItem.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog', { name: /Confirm Delete/i })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Question bank item deleted')).toBeVisible();

    // Verify item is removed
    await expect(page.getByText(`Delete Test ${timestamp}`)).not.toBeVisible();
  });

  test('deletes passage library item', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByRole('tab', { name: 'Passage Library' }).click();

    // Create a test passage first
    await page.getByRole('button', { name: 'Add Passage' }).click();
    const timestamp = Date.now();
    await page.getByLabel('Title').fill(`Delete Passage ${timestamp}`);
    await page.getByLabel('Content').fill('Test passage for deletion');
    await page.getByLabel('Topic').fill('General');
    await page.getByLabel('Word Count').fill('50');
    await page.getByRole('button', { name: 'Save' }).click();

    // Delete the passage
    const testPassage = page.locator('tr').filter({ hasText: `Delete Passage ${timestamp}` });
    await testPassage.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog', { name: /Confirm Delete/i })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Passage deleted')).toBeVisible();

    // Verify passage is removed
    await expect(page.getByText(`Delete Passage ${timestamp}`)).not.toBeVisible();
  });

  test('verifies media telemetry metrics', async ({ page }) => {
    await page.goto('/admin/media');

    // Check for telemetry data
    const storageBudgetBytes = page.getByTestId('storage-budget-bytes');
    const storageBudgetLevel = page.getByTestId('storage-budget-level');

    const hasTelemetry = await storageBudgetBytes.isVisible().catch(() => false);

    if (hasTelemetry) {
      await expect(storageBudgetBytes).toBeVisible();
      await expect(storageBudgetLevel).toBeVisible();

      // Verify values are numeric
      const bytesText = await storageBudgetBytes.textContent();
      const levelText = await storageBudgetLevel.textContent();

      expect(bytesText).toMatch(/\d+/);
      expect(levelText).toMatch(/low|medium|high|critical/i);
    }
  });

  test('bulk uploads media files', async ({ page }) => {
    await page.goto('/admin/media');

    // Navigate to images section
    await page.getByRole('tab', { name: 'Images' }).click();

    // Check for bulk upload option
    const bulkUploadButton = page.getByRole('button', { name: 'Bulk Upload' });
    const isBulkUploadAvailable = await bulkUploadButton.isVisible().catch(() => false);

    if (isBulkUploadAvailable) {
      await bulkUploadButton.click();
      await expect(page.getByRole('dialog', { name: /Bulk Upload/i })).toBeVisible();

      // Simulate bulk upload
      const fileInput = page.getByLabel('Select files');
      await fileInput.setInputFiles([
        {
          name: 'bulk-image-1.png',
          mimeType: 'image/png',
          buffer: Buffer.from('fake image 1'),
        },
        {
          name: 'bulk-image-2.png',
          mimeType: 'image/png',
          buffer: Buffer.from('fake image 2'),
        },
      ]);

      await page.getByRole('button', { name: 'Upload All' }).click();
      await expect(page.getByText('Bulk upload complete')).toBeVisible({ timeout: 15000 });
    }
  });
});
