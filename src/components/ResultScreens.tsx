import { Crown, LogOut, RotateCcw } from "lucide-react";
import type { LeaderboardEntry } from "../game/room-state";
import type { ClientRoomSnapshot } from "../protocol/messages";

function Rankings({ entries, currentPlayerId, showRoundPoints = true }: { entries: LeaderboardEntry[]; currentPlayerId: string; showRoundPoints?: boolean }) {
  return <div className="ranking-list">{entries.map((player, index) => (
    <div className={`${player.rank === 1 ? "leader" : ""} ${player.playerId === currentPlayerId ? "current-player" : ""}`} key={player.playerId}>
      <b>{player.rank}</b><span className={`avatar ${index % 3 === 0 ? "mint" : index % 3 === 1 ? "coral" : "blue"}`}>{player.nickname[0]?.toUpperCase()}</span>
      <strong>{player.nickname}{player.playerId === currentPlayerId ? " (you)" : ""}{showRoundPoints && <small>+{player.roundPoints} this round</small>}</strong>
      <em><small>Total</small>{player.score} pts</em>
    </div>
  ))}</div>;
}

interface RevealProps {
  snapshot: Extract<ClientRoomSnapshot, { phase: "reveal" }>;
  currentPlayerId: string;
  commandBusy: boolean;
  onContinue: () => Promise<boolean>;
}

export function RevealScreen({ snapshot, currentPlayerId, commandBusy, onContinue }: RevealProps) {
  const isHost = snapshot.hostPlayerId === currentPlayerId;
  const hasMatch = snapshot.revealedAnswers.some((answer) => answer.matched);
  return (
    <main className="round-shell reveal-shell">
      <div className="round-topline"><span>ROUND {snapshot.roundNumber} RESULTS</span><strong className="sync-label">{hasMatch ? "HOST MATCHED" : "NO MATCHES"}</strong></div>
      <section className="reveal-card" aria-live="polite">
        <p>HOST'S ANSWER</p><h1>{snapshot.hostAnswer}</h1>
        <small className="reveal-question">{snapshot.question?.text}</small>
        <div className="answer-grid">{snapshot.revealedAnswers.map((answer) => (
          <article className={answer.matched ? "matched" : ""} key={answer.playerId}>
            <span>{answer.nickname}{answer.playerId === currentPlayerId ? " (you)" : ""}</span><strong>{answer.answer}</strong><em>+{answer.pointsAwarded}</em>
            <small>{answer.answer === "No answer" ? "NO ANSWER" : answer.matched ? "MATCH" : "NO MATCH"}</small>
          </article>
        ))}</div>
        {isHost ? <button className="primary-button compact" disabled={commandBusy} onClick={() => void onContinue()}>See standings →</button> : <small className="waiting-copy">Waiting for the host · continues automatically</small>}
      </section>
    </main>
  );
}

interface LeaderboardProps {
  snapshot: Extract<ClientRoomSnapshot, { phase: "leaderboard" }>;
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
  snapshot: Extract<ClientRoomSnapshot, { phase: "final" }>;
  currentPlayerId: string;
  commandBusy: boolean;
  onNewGame: () => Promise<boolean>;
  onExit: () => Promise<void>;
}

export function FinalScreen({ snapshot, currentPlayerId, commandBusy, onNewGame, onExit }: FinalProps) {
  const winners = snapshot.leaderboard.filter((entry) => snapshot.winnerPlayerIds.includes(entry.playerId));
  const isHost = snapshot.hostPlayerId === currentPlayerId;
  const winnerText = winners.length > 1 ? `${winners.map((winner) => winner.nickname).join(" & ")} know ${snapshot.hostName} best` : `${winners[0]?.nickname ?? "No player"} knows ${snapshot.hostName} best`;
  return (
    <main className="round-shell final-shell"><section className="winner-card" aria-live="polite"><div className="crown"><Crown /></div><p>GAME COMPLETE</p><h1>Who knows {snapshot.hostName} best?</h1><strong className="winner-name">{winners.length > 1 ? "SHARED WINNERS" : "WINNER"}: {winnerText}</strong>
      <Rankings entries={snapshot.leaderboard} currentPlayerId={currentPlayerId} showRoundPoints={false} />
      {isHost && <button className="primary-button compact" disabled={commandBusy} onClick={() => void onNewGame()}><RotateCcw size={18} /> Set Up Another Game</button>}
      {!isHost && <small>{snapshot.players.some((player) => player.playerId === snapshot.hostPlayerId) ? `Waiting for ${snapshot.hostName} to prepare another game.` : "The host is unavailable. Another game cannot be started."}</small>}
      <button className="secondary-button compact exit-button" type="button" disabled={commandBusy} onClick={() => void onExit()}><LogOut size={18} /> Exit to Home</button>
      <small className="final-continuity">Room {snapshot.roomCode} stays open for connected players.</small></section></main>
  );
}
