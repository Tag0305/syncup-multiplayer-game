export interface PlayerSession {
  roomCode: string;
  playerId: string;
  reconnectToken: string;
}

const SESSION_KEY = "syncup:active-session:v1";

export function loadSession(): PlayerSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlayerSession>;
    if (!parsed.roomCode || !parsed.playerId || !parsed.reconnectToken) return null;
    return parsed as PlayerSession;
  } catch {
    return null;
  }
}

export function saveSession(session: PlayerSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}
