import { CheckCircle2, Clock3, Send } from "lucide-react";
import { useState } from "react";

export function QuestionScreen({ onSubmit }: { onSubmit: () => void }) {
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const submit = () => { if (!answer.trim()) return; setSubmitted(true); window.setTimeout(onSubmit, 450); };

  return (
    <main className="round-shell">
      <div className="round-topline"><span>ROUND 1 OF 5</span><div className="timer"><Clock3 size={18} /><strong>0:45</strong></div></div>
      <div className="round-progress"><i /></div>
      <section className="question-card">
        <div className="question-number">01</div>
        <p>NAME SOMETHING PEOPLE PRETEND TO UNDERSTAND</p>
        <h1>What comes to mind?</h1>
        <label className="answer-field">
          <span className="sr-only">Your answer</span>
          <input value={answer} disabled={submitted} onChange={(event) => setAnswer(event.target.value.slice(0, 60))} placeholder="Type your answer…" autoFocus />
          <small>{answer.length}/60</small>
        </label>
        <button className="primary-button" disabled={!answer.trim() || submitted} onClick={submit}>
          {submitted ? <><CheckCircle2 size={19} /> Answer locked</> : <>Lock it in <Send size={18} /></>}
        </button>
      </section>
      <div className="submission-strip"><span><i className="submitted-dot" /> 2 of 3 answered</span><p>Your answer stays private until everyone is ready.</p></div>
    </main>
  );
}
