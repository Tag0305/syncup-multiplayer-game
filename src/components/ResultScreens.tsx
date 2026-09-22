import { Crown, RotateCcw, Sparkles } from "lucide-react";

const ranking = [
  { rank: 1, name: "You", score: 300, color: "mint" },
  { rank: 2, name: "Leo", score: 200, color: "coral" },
  { rank: 3, name: "Noah", score: 100, color: "blue" },
];

export function RevealScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <main className="round-shell reveal-shell">
      <div className="round-topline"><span>ROUND 1 RESULTS</span><strong className="sync-label"><Sparkles size={16} /> MATCH FOUND</strong></div>
      <section className="reveal-card">
        <p>Name something people pretend to understand</p>
        <h1>Great minds think alike.</h1>
        <div className="answer-grid">
          <article className="matched"><span>You</span><strong>Crypto</strong><em>+100</em></article>
          <article className="matched"><span>Leo</span><strong>crypto!</strong><em>+100</em></article>
          <article><span>Noah</span><strong>Modern art</strong><em>+0</em></article>
        </div>
        <button className="primary-button compact" onClick={onContinue}>See standings →</button>
      </section>
    </main>
  );
}

export function LeaderboardScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <main className="round-shell leaderboard-shell">
      <div className="round-topline"><span>AFTER ROUND 1</span><strong>4 rounds left</strong></div>
      <section className="leaderboard-card">
        <p className="kicker">CURRENT STANDINGS</p><h1>Leaderboard</h1>
        <div className="ranking-list">
          {ranking.map((player) => <div className={player.rank === 1 ? "leader" : ""} key={player.name}><b>{player.rank}</b><span className={`avatar ${player.color}`}>{player.name[0]}</span><strong>{player.name}</strong><em>{player.score} pts</em></div>)}
        </div>
        <button className="primary-button compact" onClick={onContinue}>Next round →</button>
        <small>Moving on automatically in 15 seconds</small>
      </section>
    </main>
  );
}

export function FinalScreen({ onReplay }: { onReplay: () => void }) {
  return (
    <main className="round-shell final-shell">
      <section className="winner-card">
        <div className="crown"><Crown /></div><p>THE MOST IN SYNC</p><h1>You win!</h1><strong className="winning-score">1,100 points</strong>
        <div className="stats-grid"><div><strong>4</strong><span>matched rounds</span></div><div><strong>67%</strong><span>room sync</span></div><div><strong>3</strong><span>best match</span></div></div>
        <button className="primary-button compact" onClick={onReplay}><RotateCcw size={18} /> Play again</button>
        <small>Same room. Same crew. Fresh questions.</small>
      </section>
    </main>
  );
}
