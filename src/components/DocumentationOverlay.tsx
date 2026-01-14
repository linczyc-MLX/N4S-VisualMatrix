import React, { useEffect } from "react";

type Props = {
  onClose: () => void;
  onExportPdf?: () => void;
};

export function DocumentationOverlay({ onClose, onExportPdf }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const openDocs = () => {
    window.open("/docs.html", "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="docOverlay"
      role="dialog"
      aria-modal="true"
      aria-label="VMX Documentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="docOverlayPanel">
        <div className="docOverlayTopbar">
          <div className="docOverlayTitle">
            <div style={{ fontWeight: 900 }}>Documentation</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Guide to using VMX, guardrails, soft costs, escalation and exports
            </div>
          </div>

          <div className="docOverlayBtns">
            <button type="button" className="secondaryBtn" onClick={openDocs}>
              Open in Browser
            </button>

            {onExportPdf ? (
              <button
                type="button"
                className="secondaryBtn"
                onClick={() => {
                  onExportPdf();
                }}
              >
                Export PDF Report
              </button>
            ) : null}

            <button type="button" className="docsBtn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="docOverlayBody">
          <iframe
            title="VMX Documentation"
            src="/docs.html"
            style={{ width: "100%", height: "100%", border: "none", borderRadius: 12 }}
          />
        </div>
      </div>
    </div>
  );
}
