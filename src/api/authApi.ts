import { apiClient } from "./client";

export type UserRole = "user" | "admin";

export interface AuthUser {
  id: string;
  email: string | null;
  username: string;
  balance: number;
  role: UserRole;
  /** profile picture URL, when the account has one */
  avatarUrl?: string | null;
}

interface AuthResponse {
  token: string;
  user: AuthUser;
}

export async function registerRequest(email: string, username: string, password: string) {
  const { data } = await apiClient.post<AuthResponse>("/api/auth/register", {
    email,
    username,
    password,
  });
  return data;
}

/** identifier can be either an email (self-registered players) or a username (admin-generated players). */
export async function loginRequest(identifier: string, password: string) {
  const { data } = await apiClient.post<AuthResponse>("/api/auth/login", { identifier, password });
  return data;
}

export async function meRequest() {
  const { data } = await apiClient.get<{ user: AuthUser }>("/api/auth/me");
  return data.user;
}
