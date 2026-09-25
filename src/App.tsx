import { useRoomLobby } from "./api/useRoomLobby";
import { Brand } from "./components/Brand";
import { HomeScreen } from "./components/HomeScreen";
import { LobbyScreen } from "./components/LobbyScreen";
import { QuestionScreen } from "./components/QuestionScreen";
import { FinalScreen, LeaderboardScreen, RevealScreen } from "./components/ResultScreens";

export default function App() {
  const room = useRoomLobby();
  const isRestoring = room.session && !room.snapshot;

  return (
    <div className="app-frame">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
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
      {room.session && room.snapshot?.phase === "final" && <FinalScreen snapshot={room.snapshot} currentPlayerId={room.session.playerId} commandBusy={room.commandBusy} onReplay={room.playAgain} />}
      {room.session && room.error && <div className="game-error" role="alert">{room.error}</div>}
      <footer><span>SYNCUP</span><p>Match minds. Score together.</p></footer>
    </div>
  );
}
