import { apiClient } from "./client";
import { UserRole } from "./authApi";

export interface AdminUser {
  _id: string;
  email: string;
  username: string;
  balance: number;
  role: UserRole;
  createdAt: string;
}

export async function listUsersRequest(): Promise<AdminUser[]> {
  const { data } = await apiClient.get<{ users: AdminUser[] }>("/api/admin/users");
  return data.users;
}

export async function setUserBalanceRequest(userId: string, balance: number): Promise<AdminUser> {
  const { data } = await apiClient.patch<{ user: AdminUser }>(`/api/admin/users/${userId}/balance`, {
    balance,
  });
  return data.user;
}
