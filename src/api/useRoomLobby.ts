import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientCommand, PublicRoomSnapshot, ServerMessage } from "../protocol/messages";
import { createRoom, createSocketTicket, joinRoom, RoomApiError, socketUrl } from "./room-client";
import { clearSession, loadSession, saveSession, type PlayerSession } from "./session";

export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "offline";

export function useRoomLobby() {
  const [session, setSession] = useState<PlayerSession | null>(() => loadSession());
  const [snapshot, setSnapshot] = useState<PublicRoomSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(session ? "connecting" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const leavingRef = useRef(false);
  const pendingRef = useRef(new Map<string, (accepted: boolean) => void>());

  const acceptSession = useCallback((nextSession: PlayerSession, initialSnapshot: PublicRoomSnapshot) => {
    saveSession(nextSession);
    leavingRef.current = false;
    setSession(nextSession);
    setSnapshot(initialSnapshot);
    setError(null);
  }, []);

  const create = useCallback(async (nickname: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await createRoom(nickname);
      acceptSession(result.session, result.snapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the room.");
    } finally {
      setBusy(false);
    }
  }, [acceptSession]);

  const join = useCallback(async (nickname: string, roomCode: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await joinRoom(nickname, roomCode);
      acceptSession(result.session, result.snapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join the room.");
    } finally {
      setBusy(false);
    }
  }, [acceptSession]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const connect = async () => {
      if (cancelled || leavingRef.current) return;
      setConnectionState(reconnectAttemptRef.current ? "reconnecting" : "connecting");
      try {
        const ticket = await createSocketTicket(session);
        if (cancelled) return;
        const socket = new WebSocket(socketUrl(session, ticket));
        socketRef.current = socket;

        socket.addEventListener("open", () => {
          if (cancelled) return socket.close();
          reconnectAttemptRef.current = 0;
          setConnectionState("connected");
          setError(null);
        });
        socket.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          if (message.type === "ROOM_SNAPSHOT") {
            setSnapshot((current) => !current || message.snapshot.eventSequence >= current.eventSequence ? message.snapshot : current);
          } else if (message.type === "COMMAND_ACCEPTED") {
            pendingRef.current.get(message.commandId)?.(true);
            pendingRef.current.delete(message.commandId);
          } else if (message.type === "COMMAND_REJECTED") {
            pendingRef.current.get(message.commandId)?.(false);
            pendingRef.current.delete(message.commandId);
            setError(message.message);
          }
        });
        socket.addEventListener("close", () => {
          if (cancelled || leavingRef.current) return;
          setConnectionState(navigator.onLine ? "reconnecting" : "offline");
          reconnectAttemptRef.current += 1;
          const delay = Math.min(4_000, 300 * 2 ** reconnectAttemptRef.current) + Math.floor(Math.random() * 200);
          reconnectTimerRef.current = window.setTimeout(connect, delay);
        });
        socket.addEventListener("error", () => socket.close());
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof RoomApiError && [401, 404, 410].includes(caught.status)) {
          clearSession();
          setSession(null);
          setSnapshot(null);
          setConnectionState("idle");
          setError(caught.message);
          return;
        }
        setConnectionState(navigator.onLine ? "reconnecting" : "offline");
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(connect, Math.min(4_000, 400 * 2 ** reconnectAttemptRef.current));
      }
    };

    void connect();
    return () => {
      cancelled = true;
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [session]);

  const sendCommand = useCallback((type: ClientCommand["type"], payload: Record<string, unknown> = {}): Promise<boolean> => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !session || !snapshot) return Promise.resolve(false);
    const commandId = crypto.randomUUID();
    return new Promise((resolve) => {
      pendingRef.current.set(commandId, resolve);
      socket.send(JSON.stringify({ type, commandId, roomCode: session.roomCode, playerId: session.playerId, expectedPhaseVersion: snapshot.phaseVersion, ...payload }));
      window.setTimeout(() => {
        if (!pendingRef.current.has(commandId)) return;
        pendingRef.current.delete(commandId);
        resolve(false);
      }, 3_000);
    });
  }, [session, snapshot]);

  const leave = useCallback(async () => {
    leavingRef.current = true;
    await sendCommand("LEAVE_ROOM");
    socketRef.current?.close();
    clearSession();
    setSession(null);
    setSnapshot(null);
    setConnectionState("idle");
    setError(null);
  }, [sendCommand]);

  const runGameCommand = useCallback(async (type: "START_GAME" | "ADVANCE_PHASE" | "PLAY_AGAIN") => {
    setCommandBusy(true);
    setError(null);
    try { return await sendCommand(type); }
    finally { setCommandBusy(false); }
  }, [sendCommand]);

  const submitAnswer = useCallback(async (answer: string) => {
    setCommandBusy(true);
    setError(null);
    try { return await sendCommand("SUBMIT_ANSWER", { answer }); }
    finally { setCommandBusy(false); }
  }, [sendCommand]);

  return {
    session, snapshot, connectionState, error, busy, commandBusy, create, join, leave,
    startGame: () => runGameCommand("START_GAME"),
    advancePhase: () => runGameCommand("ADVANCE_PHASE"),
    playAgain: () => runGameCommand("PLAY_AGAIN"),
    submitAnswer,
  };
}
