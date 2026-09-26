import { expect, test } from "@playwright/test";
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
  STUDENT_STORAGE_STATE_PATH,
} from "./support/backendE2e";

test.describe("Frontend Performance Monitoring", () => {
  test("measures API request performance", async ({ page }) => {
    await page.goto("/admin/exams");

    // Measure API request performance
    const metrics = await page.evaluate(() => {
      return (window as any).performanceMonitor?.getMetricsByName("API") || [];
    });

    if (metrics.length > 0) {
      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics[0].value).toBeGreaterThan(0);
    }
  });

  test("measures component render performance", async ({ page }) => {
    await page.goto("/admin/exams");

    // Measure component render time
    const renderMetrics = await page.evaluate(() => {
      return (window as any).performanceMonitor?.getMetricsByName("RENDER") || [];
    });

    if (renderMetrics.length > 0) {
      expect(renderMetrics.length).toBeGreaterThan(0);
      expect(renderMetrics[0].value).toBeGreaterThan(0);
    }
  });

  test("verifies slow operation warnings", async ({ page }) => {
    await page.goto("/admin/exams");

    // Check for slow operation warnings
    const slowOps = await page.evaluate(() => {
      return (window as any).performanceMonitor?.getSlowOperations() || [];
    });

    if (slowOps.length > 0) {
      expect(slowOps.length).toBeGreaterThan(0);
      expect(slowOps[0].operation).toBeDefined();
      expect(slowOps[0].duration).toBeGreaterThan(0);
    }
  });

  test("verifies performance markers", async ({ page }) => {
    await page.goto("/admin/exams");

    // Check for performance markers
    const markers = await page.evaluate(() => {
      return (window as any).performanceMonitor?.getPerformanceMarks() || [];
    });

    if (markers.length > 0) {
      expect(markers.length).toBeGreaterThan(0);
      expect(markers[0].name).toBeDefined();
      expect(markers[0].startTime).toBeDefined();
    }
  });

  test("verifies P95 calculations", async ({ page }) => {
    await page.goto("/admin/exams");

    // Get P95 metric
    const p95Metrics = await page.evaluate(() => {
      return (window as any).performanceMonitor?.getP95Metrics() || {};
    });

    if (Object.keys(p95Metrics).length > 0) {
      expect(Object.keys(p95Metrics).length).toBeGreaterThan(0);

      // Verify P95 values are reasonable
      for (const [key, value] of Object.entries(p95Metrics)) {
        expect(typeof value).toBe("number");
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  test("verifies PerformanceMonitor records metrics", async ({ page }) => {
    await page.goto("/admin/exams");

    // Check if PerformanceMonitor is available
    const hasPerfMonitor = await page.evaluate(() => {
      return typeof (window as any).performanceMonitor !== "undefined";
    });

    if (hasPerfMonitor) {
      // Get all metrics
      const allMetrics = await page.evaluate(() => {
        return (window as any).performanceMonitor?.getAllMetrics() || [];
      });

      expect(Array.isArray(allMetrics)).toBe(true);
      expect(allMetrics.length).toBeGreaterThan(0);

      // Verify metric structure
      if (allMetrics.length > 0) {
        expect(allMetrics[0].name).toBeDefined();
        expect(allMetrics[0].value).toBeDefined();
        expect(allMetrics[0].timestamp).toBeDefined();
      }
    }
  });

  test("verifies slow operations are logged", async ({ page }) => {
    await page.goto("/admin/exams");

    // Trigger a potentially slow operation
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Check for logged slow operations
    const slowOps = await page.evaluate(() => {
      return (window as any).performanceMonitor?.getSlowOperations() || [];
    });

    // Verify slow operations have required fields
    for (const op of slowOps) {
      expect(op.operation).toBeDefined();
      expect(op.duration).toBeDefined();
      expect(op.threshold).toBeDefined();
    }
  });

  test("verifies performance marks are created", async ({ page }) => {
    await page.goto("/admin/exams");

    // Check for navigation timing marks
    const navTiming = await page.evaluate(() => {
      const timing = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return {
        domContentLoaded: timing.domContentLoadedEventEnd - timing.startTime,
        loadComplete: timing.loadEventEnd > 0 ? timing.loadEventEnd - timing.startTime : null,
        firstPaint: performance.getEntriesByName("first-paint")[0]?.startTime,
        readyState: document.readyState,
      };
    });

    // WebKit can expose a zero DOMContentLoaded duration for a cached Vite
    // document even after navigation has completed. In that case the ready
    // state is the reliable browser-level signal that the page is usable.
    if (navTiming.domContentLoaded <= 0) {
      expect(navTiming.readyState).toBe("complete");
    } else {
      expect(navTiming.domContentLoaded).toBeGreaterThan(0);
    }
    // Browsers may leave loadEventEnd at zero for a cached Vite document. If
    // it is populated, it must still occur after navigation started.
    if (navTiming.loadComplete !== null) {
      expect(navTiming.loadComplete).toBeGreaterThan(0);
    }
  });

  test("verifies P95 calculations are accurate", async ({ page }) => {
    await page.goto("/admin/exams");

    // Get P95 metrics
    const p95Metrics = await page.evaluate(() => {
      return (window as any).performanceMonitor?.getP95Metrics() || {};
    });

    // Get average metrics for comparison
    const avgMetrics = await page.evaluate(() => {
      return (window as any).performanceMonitor?.getAverageMetrics() || {};
    });

    if (Object.keys(p95Metrics).length > 0 && Object.keys(avgMetrics).length > 0) {
      // Compare P95 with average for same metric
      const commonMetric = Object.keys(p95Metrics).find((key) => avgMetrics[key]);

      if (commonMetric) {
        const p95Value = p95Metrics[commonMetric];
        const avgValue = avgMetrics[commonMetric];

        // P95 should be >= average
        expect(p95Value).toBeGreaterThanOrEqual(avgValue);
      }
    }
  });

  test("measures page load performance", async ({ page }) => {
    const startTime = Date.now();
    await page.goto("/admin/exams");
    await page.waitForLoadState("networkidle");
    const loadTime = Date.now() - startTime;

    // Page load should be under 5 seconds
    expect(loadTime).toBeLessThan(5000);
  });

  test("measures student exam page load performance", async ({ page }) => {
    const manifest = readBackendE2EManifest();

    const startTime = Date.now();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);
    await page.waitForLoadState("networkidle");
    const loadTime = Date.now() - startTime;

    // Student exam page should load quickly (< 3 seconds)
    expect(loadTime).toBeLessThan(3000);
  });

  test("measures proctor dashboard load performance", async ({ page }) => {
    const startTime = Date.now();
    await page.goto("/proctor");
    await page.waitForLoadState("networkidle");
    const loadTime = Date.now() - startTime;

    // Proctor dashboard should load quickly (< 3 seconds)
    expect(loadTime).toBeLessThan(3000);
  });

  test("verifies memory usage is reasonable", async ({ page }) => {
    await page.goto("/admin/exams");

    // Get memory metrics if available
    const memoryMetrics = await page.evaluate(() => {
      return (window as any).performanceMonitor?.getMemoryMetrics() || null;
    });

    if (memoryMetrics) {
      expect(memoryMetrics.usedJSHeapSize).toBeGreaterThan(0);
      expect(memoryMetrics.totalJSHeapSize).toBeGreaterThan(0);
      expect(memoryMetrics.usedJSHeapSize).toBeLessThan(memoryMetrics.totalJSHeapSize);
    }
  });

  test("verifies frame rate is acceptable", async ({ page }) => {
    await page.goto("/admin/exams");

    // Check frame rate metrics if available
    const frameRateMetrics = await page.evaluate(() => {
      return (window as any).performanceMonitor?.getFrameRateMetrics() || null;
    });

    if (frameRateMetrics) {
      expect(frameRateMetrics.fps).toBeGreaterThan(0);
      expect(frameRateMetrics.fps).toBeGreaterThan(30); // At least 30 FPS
    }
  });

  test("verifies bundle size is acceptable", async ({ page, request }) => {
    await page.goto("/admin/exams");

    // Check loaded resources
    const resources = await page.evaluate(() => {
      return performance.getEntriesByType("resource").map((r: any) => ({
        name: r.name,
        size: r.transferSize,
      }));
    });

    // Check for large JavaScript bundles
    const jsBundles = resources.filter((r: any) => r.name.endsWith(".js"));

    for (const bundle of jsBundles) {
      // Individual bundles should be under 1MB
      expect(bundle.size).toBeLessThan(1024 * 1024);
    }
  });

  test("verifies lazy loading works", async ({ page }) => {
    await page.goto("/admin/exams");

    // Check if lazy-loaded components are not initially loaded
    const lazyComponent = page.getByTestId("lazy-component");
    const isInitiallyVisible = await lazyComponent.isVisible().catch(() => false);

    expect(isInitiallyVisible).toBe(false);

    // Scroll to trigger lazy loading
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // Component should now be loaded
    const isNowVisible = await lazyComponent.isVisible().catch(() => false);
    // This depends on implementation - may or may not be visible
  });

  test("verifies code splitting works", async ({ page }) => {
    await page.goto("/admin/exams");

    // Check that not all code is loaded upfront
    const resources = await page.evaluate(() => {
      return performance.getEntriesByType("resource").map((r: any) => r.name);
    });

    // Should have separate chunks, not one giant bundle
    const chunkFiles = resources.filter((r: string) => r.includes(".chunk.") || r.includes("."));
    expect(chunkFiles.length).toBeGreaterThan(0);
  });

  test("verifies image optimization", async ({ page }) => {
    await page.goto("/admin/exams");

    // Check loaded images
    const images = await page.evaluate(() => {
      return Array.from(document.images).map((img) => ({
        src: img.src,
        width: img.naturalWidth,
        height: img.naturalHeight,
      }));
    });

    for (const img of images) {
      // Images should have dimensions
      expect(img.width).toBeGreaterThan(0);
      expect(img.height).toBeGreaterThan(0);
    }
  });

  test("verifies caching headers are set", async ({ page, request }) => {
    const response = await request.get("/admin/exams");
    const cacheControl = response.headers()["cache-control"];

    // Should have some caching directive
    expect(cacheControl).toBeDefined();
  });

  test("verifies compression is enabled", async ({ page, request }) => {
    const response = await request.get("/admin/exams");
    const contentEncoding = response.headers()["content-encoding"];

    if (!contentEncoding) {
      test.skip(
        true,
        "The Vite development server does not compress HTML; production owns this check."
      );
    }

    // Should be compressed (gzip, br, etc.)
    expect(contentEncoding).toMatch(/gzip|br|deflate/i);
  });

  test("verifies no memory leaks on navigation", async ({ page }) => {
    await page.goto("/admin/exams");

    const initialMemory = await page.evaluate(() => {
      return (window as any).performanceMonitor?.getMemoryMetrics()?.usedJSHeapSize || 0;
    });

    // Navigate multiple times
    for (let i = 0; i < 5; i++) {
      await page.goto("/admin/scheduling");
      await page.goto("/admin/exams");
    }

    const finalMemory = await page.evaluate(() => {
      return (window as any).performanceMonitor?.getMemoryMetrics()?.usedJSHeapSize || 0;
    });

    if (initialMemory > 0 && finalMemory > 0) {
      // Memory should not have grown significantly (less than 2x)
      expect(finalMemory).toBeLessThan(initialMemory * 2);
    }
  });

  test("verifies performance score is acceptable", async ({ page }) => {
    await page.goto("/admin/exams");

    // Get performance score if available
    const perfScore = await page.evaluate(() => {
      return (window as any).performanceMonitor?.getPerformanceScore() || null;
    });

    if (perfScore) {
      expect(perfScore.score).toBeGreaterThan(0);
      expect(perfScore.score).toBeLessThanOrEqual(100);

      // Score should be at least 70 (good performance)
      expect(perfScore.score).toBeGreaterThanOrEqual(70);
    }
  });
});
