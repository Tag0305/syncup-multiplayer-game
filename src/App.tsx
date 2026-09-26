import { useRoomLobby } from "./api/useRoomLobby";
import { Brand } from "./components/Brand";
import { HomeScreen } from "./components/HomeScreen";
import { LobbyScreen } from "./components/LobbyScreen";
import { LegalPage } from "./components/LegalPage";
import { QuestionScreen } from "./components/QuestionScreen";
import { FinalScreen, LeaderboardScreen, RevealScreen } from "./components/ResultScreens";

function Footer() {
  return (
    <footer>
      <a className="footer-brand" href="/">SyncUp</a>
      <nav aria-label="Legal links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
    </footer>
  );
}

function GameApp() {
  const room = useRoomLobby();
  const isRestoring = room.session && !room.snapshot;

  return (
    <div className="app-frame">
      <Brand />
      {!room.session && <HomeScreen onCreate={room.create} onJoin={room.join} busy={room.busy} error={room.error} />}
      {isRestoring && (
        <main className="restore-screen" aria-live="polite">
          <div className="loader-orbit" aria-hidden="true"><i /><i /></div>
          <h1>Rejoining your room…</h1>
          <p>Getting the latest lobby state.</p>
        </main>
      )}
      {room.session && room.snapshot && room.snapshot.phase === "lobby" && (
        <LobbyScreen snapshot={room.snapshot} currentPlayerId={room.session.playerId} connectionState={room.connectionState} commandBusy={room.commandBusy} onStart={room.startGame} onLeave={room.leave} />
      )}
      {room.session && room.snapshot?.phase === "question" && <QuestionScreen snapshot={room.snapshot} currentPlayerId={room.session.playerId} connectionState={room.connectionState} commandBusy={room.commandBusy} onSubmit={room.submitAnswer} />}
      {room.session && room.snapshot?.phase === "reveal" && <RevealScreen snapshot={room.snapshot} currentPlayerId={room.session.playerId} commandBusy={room.commandBusy} onContinue={room.advancePhase} />}
      {room.session && room.snapshot?.phase === "leaderboard" && <LeaderboardScreen snapshot={room.snapshot} currentPlayerId={room.session.playerId} commandBusy={room.commandBusy} onContinue={room.advancePhase} />}
      {room.session && room.snapshot?.phase === "final" && <FinalScreen snapshot={room.snapshot} currentPlayerId={room.session.playerId} commandBusy={room.commandBusy} onReplay={room.playAgain} onExit={room.leave} />}
      {room.session && room.snapshot?.phase !== "lobby" && room.connectionState !== "connected" && (
        <div className="connection-notice" role="status" aria-live="polite">Connection interrupted. Reconnecting to your game…</div>
      )}
      {room.session && room.error && <div className="game-error" role="alert">{room.error}</div>}
      <Footer />
    </div>
  );
}

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/privacy" || path === "/terms") {
    return <div className="app-frame"><Brand /><LegalPage page={path === "/privacy" ? "privacy" : "terms"} /><Footer /></div>;
  }
  return <GameApp />;
}
