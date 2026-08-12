import { useLayoutEffect, useRef, useState } from "react";
import { HelpIcon } from "./icons";

/**
 * A "?" that expands into explanatory text. Pages keep one short lead
 * sentence; the paragraph-length reasoning lives here, read on demand instead
 * of pushing content down on every visit. Click-to-toggle (not hover) so it
 * works on touch screens.
 */
export function InfoHint({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const popRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    // the icon can sit anywhere in a line, so the popover may poke past either
    // viewport edge — measure once and pull it back inside
    const rect = popRef.current?.getBoundingClientRect();
    if (rect) {
      const margin = 8;
      if (rect.right > window.innerWidth - margin) {
        setShift(window.innerWidth - margin - rect.right);
      } else if (rect.left < margin) {
        setShift(margin - rect.left);
      }
    }
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      setShift(0);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={`relative inline-flex ${className ?? ""}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center align-middle transition-colors ${open ? "text-accent" : "text-muted hover:text-ink"}`}
      >
        <HelpIcon className="size-3.5" />
      </button>
      {open && (
        <span
          ref={popRef}
          style={{ transform: `translateX(${shift}px)` }}
          className="absolute -left-2 top-full z-20 mt-1.5 w-72 max-w-[85vw] rounded-xl border border-line bg-panel p-3 text-left text-xs font-normal normal-case tracking-normal leading-relaxed text-muted shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
