import { CheckCircle2, Clock3, Send, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ConnectionState } from "../api/useRoomLobby";
import type { PublicRoomSnapshot } from "../protocol/messages";

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
  snapshot: Extract<PublicRoomSnapshot, { phase: "question" }>;
  currentPlayerId: string;
  connectionState: ConnectionState;
  commandBusy: boolean;
  onSubmit: (answer: string) => Promise<boolean>;
}

export function QuestionScreen({ snapshot, currentPlayerId, connectionState, commandBusy, onSubmit }: Props) {
  const [answer, setAnswer] = useState("");
  const currentPlayer = snapshot.players.find((player) => player.playerId === currentPlayerId);
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
        <p>{snapshot.question.text}</p>
        <h1>{submitted ? "Answer locked." : "What comes to mind?"}</h1>
        <label className="answer-field">
          <span className="sr-only">Your answer</span>
          <input value={answer} disabled={submitted || commandBusy} maxLength={60} aria-describedby="answer-limit" onChange={(event) => setAnswer(event.target.value.slice(0, 60))} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} placeholder="Type your answer…" autoFocus />
          <small id="answer-limit">{answer.length}/60</small>
        </label>
        <button className="primary-button" disabled={!answer.trim() || submitted || commandBusy || connectionState !== "connected"} onClick={() => void submit()}>
          {submitted ? <><CheckCircle2 size={19} /> Answer locked</> : connectionState !== "connected" ? <><WifiOff size={18} /> Reconnecting…</> : <>Lock it in <Send size={18} /></>}
        </button>
      </section>
      <div className="submission-strip" aria-live="polite"><span><i className="submitted-dot" /> {snapshot.submissionProgress.submittedCount} of {snapshot.submissionProgress.eligibleCount} answered</span><p>Your answer stays private until everyone is ready.</p></div>
    </main>
  );
}
