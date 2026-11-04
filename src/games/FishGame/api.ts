import { apiClient, getToken, resolveApiBaseUrl } from "../../api/client";

const BASE = "/api/games/fish-game";

export interface FishGameConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  betLevels: number[];
  maxHitsPerBatch: number;
  sessionTimeoutMs: number;
  species: { id: string; name: string; multiplier: number }[];
}

export interface FishSessionSummary {
  sessionId: string;
  status: "active" | "closed";
  closeReason: "exit" | "idle" | "timeout" | "replaced" | null;
  startBalance: number;
  endBalance: number | null;
  hits: number;
  kills: number;
  wagered: number;
  won: number;
  startedAt: string;
  endedAt: string | null;
}

export interface FishHitInput {
  speciesId: string;
  betAmount: number;
}

/** Per hit, same order as sent. `rejected` = not charged (the balance couldn't cover it). */
export type FishHitResult = { killed: boolean; winAmount: number } | { rejected: true };

export interface FishBatchResponse {
  results: FishHitResult[];
  balance: number;
}

export async function getFishGameConfig(): Promise<FishGameConfigResponse> {
  const { data } = await apiClient.get<FishGameConfigResponse>(`${BASE}/config`);
  return data;
}

export async function startFishSession(): Promise<FishSessionSummary & { balance: number }> {
  const { data } = await apiClient.post(`${BASE}/session/start`);
  return data;
}

/** Sends a batch of hits (empty = heartbeat). The server rolls every kill. */
export async function sendFishHits(sessionId: string, hits: FishHitInput[]): Promise<FishBatchResponse> {
  const { data } = await apiClient.post<FishBatchResponse>(`${BASE}/session/${sessionId}/hits`, { hits });
  return data;
}

export async function endFishSession(sessionId: string, reason: "exit" | "idle"): Promise<FishSessionSummary> {
  const { data } = await apiClient.post<FishSessionSummary>(`${BASE}/session/${sessionId}/end`, { reason });
  return data;
}

/** For when the page itself is going away (tab closed/reloaded): `keepalive` lets the request
 * finish after the page unloads, which a normal axios call can't. Best effort — if it never
 * arrives, the server closes the session itself after its timeout. */
export function endFishSessionOnUnload(sessionId: string): void {
  const token = getToken();
  fetch(`${resolveApiBaseUrl()}${BASE}/session/${sessionId}/end`, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ reason: "exit" }),
  }).catch(() => {});
}
