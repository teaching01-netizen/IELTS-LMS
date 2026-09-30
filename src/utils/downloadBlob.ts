export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  // Keep the anchor in the document while clicking; detached clicks are
  // ignored by some browsers, including Firefox.
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Revoking synchronously can abort the download before the browser reads
    // the blob URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
