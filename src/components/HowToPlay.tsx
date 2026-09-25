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
        <p>Bring 2–8 players together for five rounds. Everyone answers the same prompt—there is no single correct answer. You score when your answer matches someone else’s.</p>
        <div className="score-rules" aria-label="Scoring rules">
          <span><strong>2 match</strong><em>100 each</em></span>
          <span><strong>3 match</strong><em>200 each</em></span>
          <span><strong>4+ match</strong><em>300 each</em></span>
        </div>
      </section>
    </div>
  );
}
