import { Check, Copy, LogOut, Plus, Share2, UserRound, UsersRound, X } from "lucide-react";
import { useState } from "react";
import type { ConnectionState } from "../api/useRoomLobby";
import type { ClientRoomSnapshot } from "../protocol/messages";

type SetupSnapshot = Extract<ClientRoomSnapshot, { phase: "setup" }>;
type SetupPair = { question: string; answer: string; acceptedAnswers: string[] };

const blankSetup = (): SetupPair[] => Array.from({ length: 5 }, () => ({ question: "", answer: "", acceptedAnswers: [] }));

interface Props {
  snapshot: SetupSnapshot;
  currentPlayerId: string;
  connectionState: ConnectionState;
  commandBusy: boolean;
  onSave: (questions: SetupPair[]) => Promise<boolean>;
  onLock: () => Promise<boolean>;
  onLeave: () => Promise<void>;
}

export function HostSetupScreen({ snapshot, currentPlayerId, connectionState, commandBusy, onSave, onLock, onLeave }: Props) {
  const isHost = snapshot.hostPlayerId === currentPlayerId;
  const savedQuestions = "hostSetup" in snapshot ? snapshot.hostSetup.questions : [];
  const [questions, setQuestions] = useState<SetupPair[]>(() => savedQuestions.length === 5 ? savedQuestions : blankSetup());
  const [reviewing, setReviewing] = useState(false);
  const [copied, setCopied] = useState(false);
  const complete = questions.length === 5 && questions.every((pair) => pair.question.trim() && pair.answer.trim());
  const competitors = snapshot.players.filter((player) => player.role === "player");
  const host = snapshot.players.find((player) => player.playerId === snapshot.hostPlayerId);

  const updatePair = (index: number, field: "question" | "answer", value: string) => {
    setQuestions((current) => current.map((pair, pairIndex) => pairIndex === index ? { ...pair, [field]: value } : pair));
  };
  const addAcceptedAnswer = (index: number) => {
    setQuestions((current) => current.map((pair, pairIndex) => pairIndex === index && pair.acceptedAnswers.length < 4
      ? { ...pair, acceptedAnswers: [...pair.acceptedAnswers, ""] }
      : pair));
  };
  const updateAcceptedAnswer = (questionIndex: number, answerIndex: number, value: string) => {
    setQuestions((current) => current.map((pair, pairIndex) => pairIndex === questionIndex
      ? { ...pair, acceptedAnswers: pair.acceptedAnswers.map((answer, index) => index === answerIndex ? value : answer) }
      : pair));
  };
  const removeAcceptedAnswer = (questionIndex: number, answerIndex: number) => {
    setQuestions((current) => current.map((pair, pairIndex) => pairIndex === questionIndex
      ? { ...pair, acceptedAnswers: pair.acceptedAnswers.filter((_, index) => index !== answerIndex) }
      : pair));
  };
  const review = async () => {
    if (!complete) return;
    const preparedQuestions = questions.map((pair) => ({
      ...pair,
      acceptedAnswers: pair.acceptedAnswers.filter((answer) => answer.trim()),
    }));
    if (await onSave(preparedQuestions)) {
      setQuestions(preparedQuestions);
      setReviewing(true);
    }
  };
  const copyCode = async () => {
    await navigator.clipboard.writeText(snapshot.roomCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  const shareRoom = async () => {
    const text = `Join my SyncUp game with code ${snapshot.roomCode}`;
    try {
      if (navigator.share) await navigator.share({ title: "Join SyncUp", text, url: window.location.href });
      else await navigator.clipboard.writeText(`${text}: ${window.location.href}`);
    } catch { /* Native share cancellation needs no error. */ }
  };

  return (
    <main className="game-shell setup-shell">
      <section className="room-banner">
        <div><span>ROOM CODE</span><strong>{snapshot.roomCode}</strong></div>
        <div className="room-actions">
          <button className="small-button" type="button" onClick={() => void copyCode()}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}</button>
          <button className="small-button" type="button" onClick={() => void shareRoom()}><Share2 size={16} /> Share</button>
          <button className="small-button leave-button" type="button" onClick={() => void onLeave()}><LogOut size={16} /> Leave</button>
        </div>
      </section>

      {!isHost ? (
        <section className="waiting-panel" aria-live="polite">
          <UsersRound size={34} aria-hidden="true" />
          <p className="kicker">GAME SETUP</p>
          <h1>{host?.presence === "reconnecting" ? "Host reconnecting" : host ? `${snapshot.hostName} is preparing the game.` : "The host is unavailable."}</h1>
          <p>{host ? "Waiting for the host to lock five questions and answers." : "This game cannot start without the original host. You can leave and join another room."}</p>
          <div className="setup-player-count"><UserRound size={17} /> {competitors.length} of 7 players joined</div>
          <button className="secondary-button compact" type="button" onClick={() => void onLeave()}>Exit to Home</button>
        </section>
      ) : reviewing ? (
        <section className="setup-panel review-panel">
          <p className="kicker">REVIEW GAME</p>
          <h1>Check every answer before locking.</h1>
          <p className="setup-intro">Once locked, these answers cannot be changed.</p>
          <div className="review-list">
            {questions.map((pair, index) => (
              <article key={index}>
                <span>QUESTION {index + 1}</span><strong>{pair.question}</strong>
                <small>SECRET ANSWER</small><em>{pair.answer}</em>
                {pair.acceptedAnswers.length > 0 && <div className="review-alternatives"><small>ALSO ACCEPT</small><ul>{pair.acceptedAnswers.map((answer, answerIndex) => <li key={answerIndex}>{answer}</li>)}</ul></div>}
              </article>
            ))}
          </div>
          <div className="setup-actions">
            <button className="secondary-button" type="button" disabled={commandBusy} onClick={() => setReviewing(false)}>Edit questions</button>
            <button className="primary-button" type="button" disabled={commandBusy || connectionState !== "connected"} onClick={() => void onLock()}>{commandBusy ? "Locking…" : "Lock Questions & Answers"}</button>
          </div>
        </section>
      ) : (
        <section className="setup-panel">
          <p className="kicker">HOST SETUP</p>
          <h1>Create five questions about yourself.</h1>
          <p className="setup-intro">Players will try to guess each secret answer. Answers stay private until their round is revealed.</p>
          <div className="setup-form">
            {questions.map((pair, index) => (
              <fieldset key={index}>
                <legend>QUESTION {index + 1}</legend>
                <label className="field"><span>Question</span><textarea value={pair.question} maxLength={140} disabled={commandBusy} onChange={(event) => updatePair(index, "question", event.target.value)} placeholder="What is my favorite food?" /><small>{pair.question.length}/140</small></label>
                <label className="field"><span>Primary secret answer</span><input value={pair.answer} maxLength={60} disabled={commandBusy} onChange={(event) => updatePair(index, "answer", event.target.value)} placeholder="Mutton Biriyani" /><small>{pair.answer.length}/60</small></label>
                <div className="accepted-answer-section">
                  <div><strong>Optional accepted answers</strong><p>Add other answers that should also count as correct.</p></div>
                  {pair.acceptedAnswers.map((answer, answerIndex) => (
                    <div className="accepted-answer-row" key={answerIndex}>
                      <label className="field"><span>Also accept {answerIndex + 1}</span><input value={answer} maxLength={60} disabled={commandBusy} onChange={(event) => updateAcceptedAnswer(index, answerIndex, event.target.value)} placeholder="Biriyani" /><small>{answer.length}/60</small></label>
                      <button className="remove-answer-button" type="button" disabled={commandBusy} onClick={() => removeAcceptedAnswer(index, answerIndex)} aria-label={`Remove accepted answer ${answerIndex + 1} from question ${index + 1}`}><X size={17} /></button>
                    </div>
                  ))}
                  {pair.acceptedAnswers.length < 4 && <button className="add-answer-button" type="button" disabled={commandBusy} onClick={() => addAcceptedAnswer(index)}><Plus size={16} /> Add accepted answer</button>}
                  <small>{pair.acceptedAnswers.length} of 4 alternatives added</small>
                </div>
              </fieldset>
            ))}
          </div>
          <button className="primary-button setup-review-button" type="button" disabled={!complete || commandBusy || connectionState !== "connected"} onClick={() => void review()}>{commandBusy ? "Saving…" : "Review game"}</button>
        </section>
      )}
    </main>
  );
}
