import { apiClient, resolveApiBaseUrl } from "../../../api/client";

export type JackpotTierKey = "jackpot" | "mega" | "major" | "mini";

export interface JackpotTierInfo {
  key: JackpotTierKey;
  label: string;
  /** What the tier has collected so far — this is what the winner gets. */
  amount: number;
  /** The admin's cap: the tier stops filling here and its share goes to the others. */
  max: number;
}

/** A jackpot hit that's ready for this player right now — the game should force its feature on
 * the next spin and claim this hit when the feature ends. `amount` is what's collected now; the
 * claim pays whatever is collected when it lands. */
export interface JackpotPending {
  hitId: string;
  tier: JackpotTierKey;
  label: string;
  amount: number;
}

/** Pushed by the jackpot stream whenever it changes. */
export interface JackpotInfo {
  inPool: boolean;
  tiers: JackpotTierInfo[];
  /** Share of every bet going into the pool right now, in percent — the base game gives this up. */
  contributionPercent: number;
  pending: JackpotPending | null;
}

export interface JackpotClaimResult {
  tier: JackpotTierKey;
  label: string;
  amount: number;
}

/** Short-lived, single-use ticket for opening the jackpot stream (EventSource can't send the
 * Bearer header). */
export async function jackpotStreamTicketRequest(): Promise<string> {
  const { data } = await apiClient.get<{ ticket: string }>("/api/jackpot/stream-ticket");
  return data.ticket;
}

/** `canDeliver`: this game can force its feature and pay a jackpot. Games that can't yet only
 * show the bar, and are never picked as a random winner's game. */
export function jackpotStreamUrl(ticket: string, gameId: string, canDeliver: boolean): string {
  const params = new URLSearchParams({ ticket, gameId, canDeliver: canDeliver ? "1" : "0" });
  return `${resolveApiBaseUrl()}/api/jackpot/stream?${params}`;
}

export async function jackpotClaimRequest(hitId: string, gameId: string): Promise<JackpotClaimResult> {
  const { data } = await apiClient.post<JackpotClaimResult>("/api/jackpot/claim", { hitId, gameId });
  return data;
}

/** "total" = every tier. */
export type JackpotRecordsTab = "total" | JackpotTierKey;

export interface JackpotRecord {
  tier: JackpotTierKey;
  label: string;
  amount: number;
  paidAt: string;
  /** Masked username, e.g. "ja****23". */
  player: string;
  isMe: boolean;
}

export async function jackpotRecordsRequest(
  tab: JackpotRecordsTab
): Promise<{ records: JackpotRecord[]; myRank: number | null }> {
  const { data } = await apiClient.get("/api/jackpot/records", { params: { tier: tab } });
  return data;
}

// Latest contribution % per open pool game, read synchronously by each game's spin logic.
const contributionByGame = new Map<string, number>();

export function setJackpotContribution(gameId: string, percent: number): void {
  contributionByGame.set(gameId, percent);
}

export function clearJackpotContribution(gameId: string): void {
  contributionByGame.delete(gameId);
}

/** Factor a pool game's winning-outcome odds are scaled by so its base game pays
 * (RTP - contribution %) — e.g. a 95% game with 2% going to the pool scales by 93/95. Total RTP
 * (base game + pool) stays at the admin's target. 1 when the game isn't in the pool. */
export function getJackpotRtpScale(gameId: string, rtpPercent: number): number {
  const contribution = contributionByGame.get(gameId) ?? 0;
  if (contribution <= 0 || rtpPercent <= 0) return 1;
  return Math.max(0, (rtpPercent - contribution) / rtpPercent);
}
