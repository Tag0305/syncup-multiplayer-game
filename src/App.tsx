import { useRoomLobby } from "./api/useRoomLobby";
import { Brand } from "./components/Brand";
import { HomeScreen } from "./components/HomeScreen";
import { LobbyScreen } from "./components/LobbyScreen";

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
        <LobbyScreen snapshot={room.snapshot} currentPlayerId={room.session.playerId} connectionState={room.connectionState} onLeave={room.leave} />
      )}
      <footer><span>SYNCUP</span><p>Match minds. Score together.</p></footer>
    </div>
  );
}
