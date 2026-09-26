import { ArrowRight, CircleHelp } from "lucide-react";
import { useState, type FormEvent } from "react";
import { HowToPlay } from "./HowToPlay";

interface HomeScreenProps {
  onCreate: (nickname: string) => Promise<void>;
  onJoin: (nickname: string, roomCode: string) => Promise<void>;
  busy: boolean;
  error: string | null;
}

export function HomeScreen({ onCreate, onJoin, busy, error }: HomeScreenProps) {
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [showHowTo, setShowHowTo] = useState(false);

  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    if (nickname.trim() && roomCode.trim().length === 6) void onJoin(nickname.trim(), roomCode.trim().toUpperCase());
  };

  return (
    <main className="home-grid" id="home">
      <section className="intro-panel">
        <div className="eyebrow">MULTIPLAYER PARTY GAME</div>
        <h1>Match answers.<br /><span>Score together.</span></h1>
        <p className="lede">Answer the same prompt. Match your friends. Score when your answers sync.</p>
        <div className="mini-flow" aria-label="How it works">
          <span><strong>01</strong> Join</span><i /><span><strong>02</strong> Answer</span><i /><span><strong>03</strong> Match</span>
        </div>
        <button className="text-button how-to-trigger" type="button" onClick={() => setShowHowTo(true)}><CircleHelp size={17} /> How to play</button>
      </section>

      <section className="entry-card" aria-labelledby="play-heading">
        <div className="card-heading">
          <p>READY WHEN YOU ARE</p>
          <h2 id="play-heading">Enter the room</h2>
        </div>
        <label className="field">
          <span>Your nickname</span>
          <input value={nickname} disabled={busy} onChange={(event) => setNickname(event.target.value)} maxLength={20} placeholder="What should we call you?" autoComplete="nickname" />
        </label>

        {error && <div className="form-error" role="alert">{error}</div>}

        <button className="primary-button" type="button" aria-busy={busy} disabled={!nickname.trim() || busy} onClick={() => void onCreate(nickname.trim())}>
          {busy ? "Connecting…" : <>Create a room <ArrowRight size={19} /></>}
        </button>

        <div className="divider"><span>or join friends</span></div>

        <form onSubmit={submitJoin}>
          <label className="field">
            <span>Room code</span>
            <div className="code-field">
              <input value={roomCode} disabled={busy} inputMode="text" autoCapitalize="characters" autoComplete="off" onChange={(event) => setRoomCode(event.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase())} placeholder="ABC234" aria-describedby="room-hint" />
            </div>
          </label>
          <p className="field-hint" id="room-hint">Six characters from your host</p>
          <button className="secondary-button" aria-busy={busy} disabled={!nickname.trim() || roomCode.length !== 6 || busy}>{busy ? "Connecting…" : "Join room"}</button>
        </form>
        <p className="privacy-note">No account needed. Just pick a name and play.</p>
      </section>
      {showHowTo && <HowToPlay onClose={() => setShowHowTo(false)} />}
    </main>
  );
}
