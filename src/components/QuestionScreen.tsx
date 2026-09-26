import { CheckCircle2, Clock3, Send, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ConnectionState } from "../api/useRoomLobby";
import type { ClientRoomSnapshot } from "../protocol/messages";

function useCountdown(phaseEndsAt: number, serverNow: number) {
  const offset = useMemo(() => serverNow - Date.now(), [serverNow]);
  const [remaining, setRemaining] = useState(() => Math.max(0, phaseEndsAt - (Date.now() + offset)));
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, phaseEndsAt - (Date.now() + offset)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [offset, phaseEndsAt]);
  return Math.ceil(remaining / 1_000);
}

interface Props {
  snapshot: Extract<ClientRoomSnapshot, { phase: "question" }>;
  currentPlayerId: string;
  connectionState: ConnectionState;
  commandBusy: boolean;
  onSubmit: (answer: string) => Promise<boolean>;
}

export function QuestionScreen({ snapshot, currentPlayerId, connectionState, commandBusy, onSubmit }: Props) {
  const [answer, setAnswer] = useState("");
  const currentPlayer = snapshot.players.find((player) => player.playerId === currentPlayerId);
  const isHost = snapshot.hostPlayerId === currentPlayerId;
  const submitted = currentPlayer?.answerStatus === "submitted";
  const seconds = useCountdown(snapshot.phaseEndsAt, snapshot.serverNow);
  const submit = async () => {
    if (!answer.trim() || submitted) return;
    await onSubmit(answer);
  };

  return (
    <main className="round-shell">
      <div className="round-topline"><span>ROUND {snapshot.roundNumber} OF {snapshot.totalRounds}</span><div className={`timer ${seconds <= 10 ? "timer-urgent" : ""}`} role="timer" aria-label={`${seconds} seconds remaining`}><Clock3 size={18} /><strong>0:{String(seconds).padStart(2, "0")}</strong></div></div>
      <div className="round-progress"><i style={{ width: `${snapshot.roundNumber / snapshot.totalRounds * 100}%` }} /></div>
      <section className="question-card">
        <div className="question-number">{String(snapshot.roundNumber).padStart(2, "0")}</div>
        <p>QUESTION</p>
        <h1>{snapshot.question.text}</h1>
        {isHost ? (
          <div className="host-round-state">
            <span>Your answer is locked.</span>
            {"hostLockedAnswer" in snapshot && <strong>{snapshot.hostLockedAnswer}</strong>}
            <p>Players are guessing the answer you chose.</p>
          </div>
        ) : (
          <>
            <p className="guess-instruction">Guess the answer {snapshot.hostName} already chose. The host's answer is locked.</p>
            <label className="answer-field">
              <span className="sr-only">Your answer</span>
              <input value={answer} disabled={submitted || commandBusy} maxLength={60} aria-describedby="answer-limit" onChange={(event) => setAnswer(event.target.value.slice(0, 60))} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} placeholder="Your guess" autoFocus />
              <small id="answer-limit">{answer.length}/60</small>
            </label>
            <button className="primary-button" disabled={!answer.trim() || submitted || commandBusy || connectionState !== "connected"} onClick={() => void submit()}>
              {submitted ? <><CheckCircle2 size={19} /> Answer locked in</> : connectionState !== "connected" ? <><WifiOff size={18} /> Reconnecting…</> : <>Submit answer <Send size={18} /></>}
            </button>
            {submitted && <p className="submitted-message">Waiting for the other players.</p>}
          </>
        )}
      </section>
      <div className="submission-strip" aria-live="polite"><span><i className="submitted-dot" /> {snapshot.submissionProgress.submittedCount} of {snapshot.submissionProgress.eligibleCount} players answered</span><p>{isHost ? "The reveal starts when all players answer or time expires." : "Your answer stays private until the reveal."}</p></div>
    </main>
  );
}
