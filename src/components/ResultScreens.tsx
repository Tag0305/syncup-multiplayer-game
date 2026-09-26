import { Crown, LogOut, RotateCcw } from "lucide-react";
import type { LeaderboardEntry } from "../game/room-state";
import type { PublicRoomSnapshot } from "../protocol/messages";

function Rankings({ entries, currentPlayerId }: { entries: LeaderboardEntry[]; currentPlayerId: string }) {
  return <div className="ranking-list">{entries.map((player, index) => (
    <div className={`${player.rank === 1 ? "leader" : ""} ${player.playerId === currentPlayerId ? "current-player" : ""}`} key={player.playerId}>
      <b>{player.rank}</b><span className={`avatar ${index % 3 === 0 ? "mint" : index % 3 === 1 ? "coral" : "blue"}`}>{player.nickname[0]?.toUpperCase()}</span>
      <strong>{player.nickname}{player.playerId === currentPlayerId ? " (you)" : ""}<small>{player.roundPoints > 0 ? `+${player.roundPoints} this round` : "No points this round"}</small></strong>
      <em><small>Total</small>{player.score} pts</em>
    </div>
  ))}</div>;
}

interface RevealProps {
  snapshot: Extract<PublicRoomSnapshot, { phase: "reveal" }>;
  currentPlayerId: string;
  commandBusy: boolean;
  onContinue: () => Promise<boolean>;
}

export function RevealScreen({ snapshot, currentPlayerId, commandBusy, onContinue }: RevealProps) {
  const isHost = snapshot.hostPlayerId === currentPlayerId;
  const hasMatch = snapshot.revealedAnswers.some((answer) => answer.matchSize >= 2);
  const matchGroups = new Map<string, number>();
  for (const answer of snapshot.revealedAnswers) {
    if (answer.normalizedGroup && answer.matchSize >= 2 && !matchGroups.has(answer.normalizedGroup)) matchGroups.set(answer.normalizedGroup, matchGroups.size);
  }
  return (
    <main className="round-shell reveal-shell">
      <div className="round-topline"><span>ROUND {snapshot.roundNumber} RESULTS</span><strong className="sync-label">{hasMatch ? "MATCH FOUND" : "ALL UNIQUE"}</strong></div>
      <section className="reveal-card" aria-live="polite">
        <p>{snapshot.question?.text}</p><h1>{hasMatch ? "Great minds think alike." : "Different minds this time."}</h1>
        <div className="answer-grid">{snapshot.revealedAnswers.map((answer) => (
          <article className={answer.matchSize >= 2 ? `matched match-group-${matchGroups.get(answer.normalizedGroup ?? "") ?? 0}` : ""} key={answer.playerId}>
            <span>{answer.nickname}{answer.playerId === currentPlayerId ? " (you)" : ""}</span><strong>{answer.answer}</strong><em>+{answer.pointsAwarded}</em>
            <small>{answer.answer === "No answer" ? "NO ANSWER" : answer.matchSize >= 2 ? `IN SYNC: ${answer.matchSize} PLAYERS` : "NO MATCH"}</small>
          </article>
        ))}</div>
        {isHost ? <button className="primary-button compact" disabled={commandBusy} onClick={() => void onContinue()}>See standings →</button> : <small className="waiting-copy">Waiting for the host · continues automatically</small>}
      </section>
    </main>
  );
}

interface LeaderboardProps {
  snapshot: Extract<PublicRoomSnapshot, { phase: "leaderboard" }>;
  currentPlayerId: string;
  commandBusy: boolean;
  onContinue: () => Promise<boolean>;
}

export function LeaderboardScreen({ snapshot, currentPlayerId, commandBusy, onContinue }: LeaderboardProps) {
  const isHost = snapshot.hostPlayerId === currentPlayerId;
  const isLastRound = snapshot.roundNumber === snapshot.totalRounds;
  return (
    <main className="round-shell leaderboard-shell"><div className="round-topline"><span>AFTER ROUND {snapshot.roundNumber}</span><strong>{isLastRound ? "Final results next" : `${snapshot.totalRounds - snapshot.roundNumber} rounds left`}</strong></div>
      <section className="leaderboard-card"><p className="kicker">CURRENT STANDINGS</p><h1>Leaderboard</h1><Rankings entries={snapshot.leaderboard} currentPlayerId={currentPlayerId} />
        {isHost ? <button className="primary-button compact" disabled={commandBusy} onClick={() => void onContinue()}>{isLastRound ? "Final results" : "Next round"} →</button> : <small>Waiting for the host · moving on automatically</small>}
      </section>
    </main>
  );
}

interface FinalProps {
  snapshot: Extract<PublicRoomSnapshot, { phase: "final" }>;
  currentPlayerId: string;
  commandBusy: boolean;
  onReplay: () => Promise<boolean>;
  onExit: () => Promise<void>;
}

export function FinalScreen({ snapshot, currentPlayerId, commandBusy, onReplay, onExit }: FinalProps) {
  const winners = snapshot.leaderboard.filter((entry) => snapshot.winnerPlayerIds.includes(entry.playerId));
  const isHost = snapshot.hostPlayerId === currentPlayerId;
  const winnerText = winners.length > 1 ? `${winners.map((winner) => winner.nickname).join(" & ")} tie!` : `${winners[0]?.nickname ?? "No one"} wins!`;
  return (
    <main className="round-shell final-shell"><section className="winner-card" aria-live="polite"><div className="crown"><Crown /></div><p>{winners.length > 1 ? "SHARED WINNERS" : "THE MOST IN SYNC"}</p><h1>{winnerText}</h1><strong className="winning-score">{winners[0]?.score ?? 0} points</strong>
      <Rankings entries={snapshot.leaderboard} currentPlayerId={currentPlayerId} />
      {isHost && snapshot.players.length >= 2 && <button className="primary-button compact" disabled={commandBusy} onClick={() => void onReplay()}><RotateCcw size={18} /> Play again</button>}
      {isHost && snapshot.players.length < 2 && <p className="replay-requirement">At least 2 players are needed to play again.</p>}
      {!isHost && snapshot.players.length >= 2 && <small>Waiting for the host to start another game.</small>}
      <button className="secondary-button compact exit-button" type="button" disabled={commandBusy} onClick={() => void onExit()}><LogOut size={18} /> Exit to Home</button>
      <small className="final-continuity">Room {snapshot.roomCode} stays open. {snapshot.players.length} players remain together.</small></section></main>
  );
}
