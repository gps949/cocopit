import { useLocation } from "react-router-dom";

export type Product = "claude" | "codex";

/**
 * The product lives in the URL — /codex/* is the Codex view of the same
 * console — so links are shareable and the two histories never mix. Claude
 * keeps the original unprefixed paths.
 */
export function useProduct(): Product {
  const { pathname } = useLocation();
  return pathname === "/codex" || pathname.startsWith("/codex/") ? "codex" : "claude";
}

/** Prefixes an app path for the given product ("/sessions" → "/codex/sessions"). */
export function productPath(product: Product, path: string): string {
  return product === "codex" ? `/codex${path}` : path;
}

/** Appends the product to an API query string when it differs from the default. */
export function withProduct(product: Product, qs: URLSearchParams): URLSearchParams {
  if (product !== "claude") qs.set("product", product);
  return qs;
}
