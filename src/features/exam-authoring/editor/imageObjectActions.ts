import { isDirectImageSource } from "./schema/imageNode";
import type { ImageObjectAttrs } from "../api/satImagePresentation";

export interface ImageAssetResolver {
  (assetId: string): Promise<{ downloadUrl: string | null }>;
}

/**
 * Hands the author the original file the visual came from.
 *
 * Managed assets resolve through the media API; direct sources are already
 * their own URL. Cross-origin links may open instead of saving, because
 * browsers only honour `download` same-origin — the action still lands the
 * author on the original rather than doing nothing.
 */
export async function downloadImageOriginal(
  attrs: ImageObjectAttrs,
  resolve: ImageAssetResolver
): Promise<void> {
  const assetId = typeof attrs["assetId"] === "string" ? attrs["assetId"] : "";
  const source = typeof attrs["src"] === "string" ? attrs["src"] : "";
  const direct = isDirectImageSource(assetId) ? assetId : isDirectImageSource(source) ? source : "";
  let href = direct;
  if (!href && assetId) {
    try {
      href = (await resolve(assetId)).downloadUrl ?? "";
    } catch {
      href = "";
    }
  }
  if (!href || typeof document === "undefined") return;
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = "";
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
