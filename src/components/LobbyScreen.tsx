import { Check, Copy, LogOut, Share2, Signal, SignalZero, UserRound, UsersRound, Wifi } from "lucide-react";
import type { ConnectionState } from "../api/useRoomLobby";
import type { PublicRoomSnapshot } from "../protocol/messages";

interface LobbyScreenProps {
  snapshot: PublicRoomSnapshot;
  currentPlayerId: string;
  connectionState: ConnectionState;
  onLeave: () => Promise<void>;
}

function presenceLabel(presence: "connected" | "reconnecting" | "left") {
  return presence === "connected" ? "Ready" : presence === "reconnecting" ? "Reconnecting" : "Left";
}

export function LobbyScreen({ snapshot, currentPlayerId, connectionState, onLeave }: LobbyScreenProps) {
  const copyCode = () => void navigator.clipboard.writeText(snapshot.roomCode);
  const shareRoom = async () => {
    const text = `Join my SyncUp room with code ${snapshot.roomCode}`;
    try {
      if (navigator.share) await navigator.share({ title: "Join SyncUp", text, url: window.location.href });
      else await navigator.clipboard.writeText(`${text} — ${window.location.href}`);
    } catch {
      // Cancelling the native share sheet needs no visible error.
    }
  };
  const connectionText = connectionState === "connected" ? "Connected" : connectionState === "offline" ? "Offline" : "Reconnecting";

  return (
    <main className="game-shell">
      <div className={`connection-pill ${connectionState !== "connected" ? "connection-warning" : ""}`}>
        {connectionState === "connected" ? <Signal size={14} /> : <SignalZero size={14} />} {connectionText}
      </div>
      <section className="room-banner">
        <div><span>ROOM CODE</span><strong>{snapshot.roomCode}</strong></div>
        <div className="room-actions">
          <button className="small-button" type="button" onClick={copyCode}><Copy size={16} /> Copy</button>
          <button className="small-button" type="button" onClick={() => void shareRoom()}><Share2 size={16} /> Share</button>
          <button className="small-button leave-button" type="button" onClick={() => void onLeave()}><LogOut size={16} /> Leave</button>
        </div>
      </section>
      <section className="lobby-layout">
        <div>
          <div className="section-title">
            <div><p>THE CREW</p><h1>Lobby</h1></div>
            <span><UsersRound size={17} /> {snapshot.players.length}/8</span>
          </div>
          <div className="player-list" aria-live="polite">
            {snapshot.players.map((player, index) => (
              <article className={`player-row ${player.presence === "reconnecting" ? "player-reconnecting" : ""}`} key={player.playerId} style={{ animationDelay: `${index * 80}ms` }}>
                <span className={`avatar ${index % 3 === 0 ? "mint" : index % 3 === 1 ? "coral" : "blue"}`}><UserRound size={19} /></span>
                <div className="player-identity">
                  <strong>{player.nickname}{player.playerId === currentPlayerId ? " (you)" : ""}</strong>
                  <small><i className={`presence-dot ${player.presence}`} />{presenceLabel(player.presence)}</small>
                </div>
                {player.role === "host" && <em>HOST</em>}
                {player.presence === "connected" ? <Check className="ready-check" size={18} aria-label="Connected" /> : <Wifi className="reconnect-icon" size={18} aria-label="Reconnecting" />}
              </article>
            ))}
            {snapshot.players.length < 8 && <div className="empty-slot">Waiting for more minds to join…</div>}
          </div>
        </div>
        <aside className="lobby-aside">
          <div className="pulse-mark" aria-hidden="true"><i /><i /><i /></div>
          <h2>{snapshot.players.length < 2 ? "Invite a friend" : "Everyone's here?"}</h2>
          <p>{snapshot.players.length < 2 ? "Share the room code to bring another player into the lobby." : "The room is live and everyone is synchronized."}</p>
          <button className="primary-button" type="button" disabled title="Gameplay will be enabled in the next build">Start game <span>→</span></button>
          <small>Game rounds are coming next</small>
        </aside>
      </section>
    </main>
  );
}
