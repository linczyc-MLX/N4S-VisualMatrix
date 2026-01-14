export const VMX_APP_NAME = "VMX — Visual Matrix";
/**
 * App version shown in UI + exports. Keep it simple and bump when you ship changes.
 */
export const VMX_APP_VERSION = "1.3.0";

/**
 * Helper: format a date for provenance (local time).
 */
export function formatProvenanceDate(d: Date): string {
  try {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    // Ultra-safe fallback
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
}
