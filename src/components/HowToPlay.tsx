import { X } from "lucide-react";
import { useEffect, useRef } from "react";

export function HowToPlay({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="how-to-card" role="dialog" aria-modal="true" aria-labelledby="how-to-title">
        <button ref={closeRef} className="modal-close" type="button" onClick={onClose} aria-label="Close how to play"><X size={19} /></button>
        <p className="kicker">QUICK RULES</p><h2 id="how-to-title">How to Play</h2>
        <p>Play with 2 to 8 people for five rounds. Everyone receives the same prompt, and answers stay private until the reveal. There is no single correct answer. Matching answers score points.</p>
        <div className="score-rules" aria-label="Scoring rules">
          <span><strong>2 players</strong><em>100 points each</em></span>
          <span><strong>3 players</strong><em>200 points each</em></span>
          <span><strong>4+ players</strong><em>300 points each</em></span>
        </div>
      </section>
    </div>
  );
}
