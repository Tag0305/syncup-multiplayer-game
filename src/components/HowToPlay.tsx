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
        <ol className="how-to-steps">
          <li>The host creates five questions about themselves.</li>
          <li>The host secretly answers and locks them.</li>
          <li>Players join with the room code and guess each locked answer.</li>
          <li>An exact normalized match earns 100 points.</li>
          <li>After five rounds, the highest score wins.</li>
        </ol>
        <div className="rule-example" aria-label="Scoring example">
          <span>What is the host's favorite food?</span>
          <strong>Host locked: Biryani</strong>
          <p>Alex: Biryani <em>+100</em></p>
          <p>Maya: Pizza <em>0</em></p>
        </div>
        <p className="how-to-summary">The better you know the host, the more points you score.</p>
      </section>
    </div>
  );
}
