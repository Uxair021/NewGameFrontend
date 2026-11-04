import { apiClient } from "./client";

export async function getBalanceRequest() {
  const { data } = await apiClient.get<{ balance: number }>("/api/users/balance");
  return data.balance;
}

export async function claimDemoCreditsRequest() {
  const { data } = await apiClient.post<{ balance: number }>("/api/users/demo-credits");
  return data.balance;
}

export interface SpinHistoryEntry {
  _id: string;
  gameId: string;
  betAmount: number;
  winAmount: number;
  reelSymbols: string[][];
  balanceAfter: number;
  tier: string | null;
  createdAt: string;
}

export async function getSpinHistoryRequest() {
  const { data } = await apiClient.get<{ history: SpinHistoryEntry[] }>("/api/users/spin-history");
  return data.history;
}

export interface BalanceHistoryEntry {
  _id: string;
  previousBalance: number;
  newBalance: number;
  delta: number;
  createdAt: string;
}

export async function getBalanceHistoryRequest() {
  const { data } = await apiClient.get<{ history: BalanceHistoryEntry[] }>("/api/users/balance-history");
  return data.history;
}
