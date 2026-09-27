import { Check, CircleHelp, Copy, LogOut, Share2, Signal, SignalZero, UserRound, UsersRound, Wifi } from "lucide-react";
import { useState } from "react";
import type { ConnectionState } from "../api/useRoomLobby";
import type { ClientRoomSnapshot } from "../protocol/messages";
import { HowToPlay } from "./HowToPlay";

interface LobbyScreenProps {
  snapshot: Extract<ClientRoomSnapshot, { phase: "lobby" }>;
  currentPlayerId: string;
  connectionState: ConnectionState;
  onLeave: () => Promise<void>;
  onStart: () => Promise<boolean>;
  commandBusy: boolean;
}

function presenceLabel(presence: "connected" | "reconnecting" | "left") {
  return presence === "connected" ? "Ready" : presence === "reconnecting" ? "Reconnecting" : "Left";
}

export function LobbyScreen({ snapshot, currentPlayerId, connectionState, onLeave, onStart, commandBusy }: LobbyScreenProps) {
  const [copied, setCopied] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  const copyCode = async () => {
    await navigator.clipboard.writeText(snapshot.roomCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  const shareRoom = async () => {
    const text = `Join my SyncUp room with code ${snapshot.roomCode}`;
    try {
      if (navigator.share) await navigator.share({ title: "Join SyncUp", text, url: window.location.href });
      else await navigator.clipboard.writeText(`${text}: ${window.location.href}`);
    } catch {
      // Cancelling the native share sheet needs no visible error.
    }
  };
  const connectionText = connectionState === "connected"
    ? "Connected"
    : connectionState === "offline"
      ? "Offline"
      : connectionState === "connecting" || connectionState === "idle"
        ? "Connecting"
        : "Reconnecting";
  const isHost = snapshot.hostPlayerId === currentPlayerId;
  const host = snapshot.players.find((player) => player.playerId === snapshot.hostPlayerId);
  const competitors = snapshot.players.filter((player) => player.role === "player");
  const connectedCompetitors = competitors.filter((player) => player.presence === "connected");
  const canStart = isHost && snapshot.setupStatus === "locked" && connectedCompetitors.length >= 1 && connectionState === "connected";
  const lobbyHeading = !host ? "Host unavailable" : host.presence === "reconnecting" ? "Host reconnecting" : connectedCompetitors.length < 1 ? "Invite a player" : "Questions locked";
  const lobbyMessage = !host
    ? "This game cannot start without the original host. You can leave and join another room."
    : host.presence === "reconnecting"
      ? `Waiting up to 30 seconds for ${snapshot.hostName} to reconnect.`
      : connectedCompetitors.length < 1
        ? "Share the room code. At least one player must be connected before the game starts."
        : `${snapshot.hostName}'s five questions and answers are locked.`;

  return (
    <main className="game-shell">
      <div className={`connection-pill ${connectionState !== "connected" ? "connection-warning" : ""}`} role="status" aria-live="polite">
        {connectionState === "connected" ? <Signal size={14} /> : <SignalZero size={14} />} {connectionText}
      </div>
      <section className="room-banner">
        <div><span>ROOM CODE</span><strong>{snapshot.roomCode}</strong></div>
        <div className="room-actions">
          <button className="small-button" type="button" onClick={() => void copyCode()} aria-label="Copy room code">{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}</button>
          <button className="small-button" type="button" onClick={() => void shareRoom()}><Share2 size={16} /> Share</button>
          <button className="small-button" type="button" onClick={() => setShowHowTo(true)}><CircleHelp size={16} /> Rules</button>
          <button className="small-button leave-button" type="button" onClick={() => void onLeave()}><LogOut size={16} /> Leave</button>
        </div>
      </section>
      <section className="lobby-layout">
        <div>
          <div className="section-title">
            <div><p>GAME READY</p><h1>Lobby</h1></div>
            <span><UsersRound size={17} /> {connectedCompetitors.length} connected · {competitors.length}/7 joined</span>
          </div>
          <div className="player-list" aria-live="polite">
            {snapshot.players.map((player, index) => (
              <article className={`player-row ${player.presence === "reconnecting" ? "player-reconnecting" : ""}`} key={player.playerId} style={{ animationDelay: `${index * 80}ms` }}>
                <span className={`avatar ${index % 3 === 0 ? "mint" : index % 3 === 1 ? "coral" : "blue"}`}><UserRound size={19} /></span>
                <div className="player-identity">
                  <strong>{player.nickname}{player.playerId === currentPlayerId ? " (you)" : ""}</strong>
                  <small><i className={`presence-dot ${player.presence}`} />{presenceLabel(player.presence)}</small>
                </div>
                <span className="player-role-slot">{player.role === "host" && <em>HOST</em>}</span>
                {player.presence === "connected" ? <Check className="ready-check" size={18} aria-label="Connected" /> : <Wifi className="reconnect-icon" size={18} aria-label="Reconnecting" />}
              </article>
            ))}
            {snapshot.players.length < 8 && <div className="empty-slot">Waiting for more players to join…</div>}
          </div>
        </div>
        <aside className="lobby-aside">
          <UsersRound size={30} aria-hidden="true" />
          <h2>{lobbyHeading}</h2>
          <p>{lobbyMessage}</p>
          <button className="primary-button" type="button" aria-busy={commandBusy} disabled={!canStart || commandBusy} onClick={() => void onStart()}>{commandBusy ? "Starting…" : "Start game"} <span>→</span></button>
          <small>{!host ? "The original host was not replaced" : host.presence === "reconnecting" ? "Players are never promoted to host" : !isHost ? `Waiting for ${snapshot.hostName} to start` : connectedCompetitors.length < 1 ? "At least 1 participating player is needed" : "5 rounds · 45 seconds each"}</small>
        </aside>
      </section>
      {showHowTo && <HowToPlay onClose={() => setShowHowTo(false)} />}
    </main>
  );
}
