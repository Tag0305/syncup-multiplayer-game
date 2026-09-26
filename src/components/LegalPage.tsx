import { useEffect } from "react";

const effectiveDate = "September 26, 2026";

function PrivacyPolicy() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="legal-date">Effective {effectiveDate}</p>
      <p>SyncUp is a multiplayer browser game. No user account is required. This policy explains the information the current application uses to create rooms, reconnect players, and run games.</p>

      <h2>Information SyncUp uses</h2>
      <ul>
        <li><strong>Nickname and room code:</strong> used to identify you inside a room and connect players to the correct game.</li>
        <li><strong>Anonymous player ID and reconnect credential:</strong> generated for your game session so the same player can reconnect after a refresh or brief disconnection.</li>
        <li><strong>Questions, answers, scores, and game state:</strong> used to store the host's five locked question-and-answer pairs, reveal each answer at the appropriate time, compare player guesses, maintain rankings, and synchronize the room.</li>
        <li><strong>Technical request information:</strong> Cloudflare may process information such as IP address, request details, and operational logs while providing hosting, security, WebSockets, Durable Objects, and observability.</li>
      </ul>

      <h2>Browser storage</h2>
      <p>Your browser stores the room code, anonymous player ID, and reconnect token in localStorage. This lets SyncUp restore the same room session after a refresh or browser restart. Choosing Leave or Exit to Home removes that saved session from the browser.</p>

      <h2>Room and game data</h2>
      <p>The authoritative room state is stored in a Cloudflare Durable Object. The server stores a hash of the reconnect token, not the raw token. Room state includes players, host-created questions and locked answers, submitted guesses, scores, timers, and game progress. Rooms have a maximum active lifetime of 24 hours. This is not a promise that all infrastructure logs or stored records are deleted at exactly that time.</p>

      <h2>Answer visibility</h2>
      <p>The host's locked answers and submitted player guesses are kept out of player-facing room snapshots before reveal. The current host answer and player guesses are revealed to room participants together when that round moves to the reveal phase. Future host answers remain private.</p>

      <h2>Analytics and advertising</h2>
      <p>The current SyncUp code does not include an advertising system or a third-party product analytics or tracking SDK. Cloudflare observability is enabled for operational monitoring.</p>

      <h2>Contact</h2>
      <p>For privacy questions, email <a href="mailto:tagoreronanki77@gmail.com">tagoreronanki77@gmail.com</a>.</p>
    </>
  );
}

function Terms() {
  return (
    <>
      <h1>Terms and Conditions</h1>
      <p className="legal-date">Effective {effectiveDate}</p>
      <p>These terms apply when you use SyncUp. By creating or joining a room, you agree to use the game responsibly.</p>

      <h2>Using SyncUp</h2>
      <p>SyncUp is provided as a small multiplayer web game. You may use it for personal, lawful play. You must not interfere with the service, attempt unauthorized access, automate abusive traffic, or use the game for illegal activity.</p>

      <h2>Your nicknames, questions, and answers</h2>
      <p>You are responsible for the nicknames, host-created questions, locked host answers, and player guesses you submit. Do not submit content that is illegal, threatening, harassing, hateful, or that violates another person’s rights. Other participants in your room will see host questions during play and submitted answers when their round is revealed.</p>

      <h2>Availability</h2>
      <p>SyncUp may change, become unavailable, or experience interruptions. Room connections, saved sessions, and game data are not guaranteed to remain available. Do not rely on SyncUp to store important information.</p>

      <h2>Ownership</h2>
      <p>Except for content submitted by room participants, the SyncUp application and its original code and design remain owned by the project owner. Third-party software remains subject to its own licenses.</p>

      <h2>Disclaimer and limitation</h2>
      <p>SyncUp is provided as available without a guarantee that it will always be error-free or uninterrupted. To the extent permitted by applicable law, the project owner is not responsible for indirect or consequential losses resulting from use of or inability to use the service.</p>

      <h2>Contact</h2>
      <p>For terms questions, email <a href="mailto:tagoreronanki77@gmail.com">tagoreronanki77@gmail.com</a>.</p>
    </>
  );
}

export function LegalPage({ page }: { page: "privacy" | "terms" }) {
  useEffect(() => {
    document.title = `${page === "privacy" ? "Privacy Policy" : "Terms and Conditions"} | SyncUp`;
  }, [page]);

  return <main className="legal-shell"><article>{page === "privacy" ? <PrivacyPolicy /> : <Terms />}</article></main>;
}
