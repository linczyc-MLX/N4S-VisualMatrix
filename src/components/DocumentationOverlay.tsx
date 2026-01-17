import React, { useEffect, useMemo, useRef } from "react";

type Props = {
  onClose: () => void;
  onExportPdf?: () => void;
  /** If supplied, picks the correct docs file (Lite vs Pro) */
  mode?: "lite" | "pro";
};

/**
 * DocumentationOverlay (v6)
 * - Full-height modal overlay (fixed, 92vh)
 * - Sticky top action bar (Open / Export / Close)
 * - Top-right "X" close button
 * - Background scroll lock + scrollbar shift compensation
 * - Escape to close
 * - Click outside to close
 * - Focus trap (tab stays within modal)
 * - BASE_URL-safe docs path for subfolder deployments
 * - Mode-aware docs: docs-lite.html vs docs-pro.html
 */
export function DocumentationOverlay({ onClose, onExportPdf, mode = "pro" }: Props) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Use Vite BASE_URL so this works both locally (/) and on sub-path deploys (/vmx/, /app/, etc.)
  const docsPath = useMemo(() => {
    const base = (import.meta.env?.BASE_URL || "/") as string;
    const file = mode === "lite" ? "docs-lite.html" : "docs-pro.html";
    const root = base.endsWith("/") ? base : `${base}/`;
    return `${root}${file}`;
  }, [mode]);

  // Lock background scroll while overlay is open
  useEffect(() => {
    const body = document.body;

    // Preserve existing inline styles (so we don't clobber other logic)
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;

    // If the page already has a vertical scrollbar, removing scroll can cause a "layout shift".
    // Compensate by adding padding-right equal to scrollbar width.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, []);

  // Focus trap + Escape close
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the Close button by default (best UX)
    window.setTimeout(() => closeBtnRef.current?.focus(), 0);

    const getFocusable = (): HTMLElement[] => {
      const root = panelRef.current;
      if (!root) return [];
      const nodes = root.querySelectorAll<HTMLElement>(
        [
          "a[href]",
          "button:not([disabled])",
          "textarea:not([disabled])",
          "input:not([disabled])",
          "select:not([disabled])",
          "[tabindex]:not([tabindex='-1'])",
        ].join(",")
      );
      return Array.from(nodes).filter((el) => {
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const openDocs = () => {
    const url = new URL(docsPath, window.location.origin).toString();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      ref={overlayRef}
      className="docOverlay"
      role="dialog"
      aria-modal="true"
      aria-label="VMX Documentation"
      onMouseDown={(e) => {
        // Click outside closes
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <div
        ref={panelRef}
        className="docOverlayPanel"
        style={{
          width: "min(1200px, 96vw)",
          height: "92vh",
          background: "var(--card, #0b1220)",
          borderRadius: 16,
          boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Top-right X close */}
        <button
          type="button"
          aria-label="Close documentation"
          title="Close"
          onClick={onClose}
          ref={closeBtnRef}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            width: 36,
            height: 36,
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.9)",
            fontSize: 20,
            fontWeight: 700,
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          ×
        </button>

        {/* Sticky top bar */}
        <div
          className="docOverlayTopbar"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            background: "rgba(12,18,32,0.92)",
            backdropFilter: "blur(8px)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            padding: "14px 14px 12px 14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div className="docOverlayTitle" style={{ paddingRight: 44 }}>
              <div style={{ fontWeight: 900, fontSize: 16, color: "rgba(255,255,255,0.95)" }}>
                Documentation — {mode === "lite" ? "Lite" : "Pro"}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2, color: "rgba(255,255,255,0.65)" }}>
                {mode === "lite"
                  ? "Client-facing overview (VMX Pro remains available for professional teams)."
                  : "Full guide: guardrails, soft costs, escalation, multipliers and exports."}
              </div>
            </div>

            <div className="docOverlayBtns" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button type="button" className="secondaryBtn" onClick={openDocs}>
                Open in Browser
              </button>

              {onExportPdf ? (
                <button type="button" className="secondaryBtn" onClick={onExportPdf}>
                  Export PDF Report
                </button>
              ) : null}

              <button type="button" className="docsBtn" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div
          className="docOverlayBody"
          style={{
            flex: 1,
            overflow: "hidden",
            background: "rgba(0,0,0,0.12)",
          }}
        >
          <iframe
            title="VMX Documentation"
            src={docsPath}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              display: "block",
              background: "transparent",
            }}
          />
        </div>
      </div>
    </div>
  );
}
