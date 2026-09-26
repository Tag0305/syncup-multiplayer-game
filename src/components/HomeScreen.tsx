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
  const [hostName, setHostName] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [showHowTo, setShowHowTo] = useState(false);

  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    if (playerName.trim() && roomCode.trim().length === 6) void onJoin(playerName.trim(), roomCode.trim().toUpperCase());
  };

  return (
    <main className="home-grid" id="home">
      <section className="intro-panel">
        <div className="eyebrow">MULTIPLAYER PARTY GAME</div>
        <h1>How well do you<br /><span>know the host?</span></h1>
        <p className="lede">Guess the answers your host already chose. Match them to score. The player who knows the host best after 5 rounds wins.</p>
        <div className="mini-flow" aria-label="How it works">
          <span><strong>01</strong> Host locks answers</span><i /><span><strong>02</strong> Players guess</span><i /><span><strong>03</strong> Score</span>
        </div>
        <button className="text-button how-to-trigger" type="button" onClick={() => setShowHowTo(true)}><CircleHelp size={17} /> How to play</button>
      </section>

      <section className="entry-card" aria-labelledby="play-heading">
        <div className="card-heading">
          <p>CREATE A GAME</p>
          <h2 id="play-heading">Host a room</h2>
        </div>
        <label className="field">
          <span>Host name</span>
          <input value={hostName} disabled={busy} onChange={(event) => setHostName(event.target.value)} maxLength={20} placeholder="Your name" autoComplete="nickname" />
        </label>

        {error && <div className="form-error" role="alert">{error}</div>}

        <button className="primary-button" type="button" aria-busy={busy} disabled={!hostName.trim() || busy} onClick={() => void onCreate(hostName.trim())}>
          {busy ? "Connecting…" : <>Create game <ArrowRight size={19} /></>}
        </button>

        <div className="divider"><span>JOIN A GAME</span></div>

        <form onSubmit={submitJoin}>
          <label className="field">
            <span>Nickname</span>
            <input value={playerName} disabled={busy} onChange={(event) => setPlayerName(event.target.value)} maxLength={20} placeholder="Your name" autoComplete="nickname" />
          </label>
          <label className="field">
            <span>Room code</span>
            <div className="code-field">
              <input value={roomCode} disabled={busy} inputMode="text" autoCapitalize="characters" autoComplete="off" onChange={(event) => setRoomCode(event.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase())} placeholder="ABC234" aria-describedby="room-hint" />
            </div>
          </label>
          <p className="field-hint" id="room-hint">Six characters from your host</p>
          <button className="secondary-button" aria-busy={busy} disabled={!playerName.trim() || roomCode.length !== 6 || busy}>{busy ? "Connecting…" : "Join game"}</button>
        </form>
        <p className="privacy-note">No account needed. Just pick a name and play.</p>
      </section>
      {showHowTo && <HowToPlay onClose={() => setShowHowTo(false)} />}
    </main>
  );
}
