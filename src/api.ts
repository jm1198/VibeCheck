import type { Venue, User, StreamKeyInfo, HoursCheck, AnalyticsResponse } from "./types";

const BASE = "/api";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const token = localStorage.getItem("vibecheck_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function getVenues(): Promise<Venue[]> {
  return request<Venue[]>("/venues");
}

export function getVenue(id: number): Promise<Venue> {
  return request<Venue>(`/venues/${id}`);
}

export function updateVenue(
  id: number,
  data: Partial<Pick<Venue, "is_live" | "business_hours" | "description" | "name" | "location">>
): Promise<Venue> {
  return request<Venue>(`/venues/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function login(
  email: string,
  password: string
): Promise<{ token: string; venue_id: number | null; email: string }> {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function signup(email: string, password: string): Promise<{ success: boolean }> {
  return request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function getMe(): Promise<User> {
  return request<User>("/auth/me");
}

export function getStreamKey(venueId: number): Promise<StreamKeyInfo> {
  return request<StreamKeyInfo>(`/venues/${venueId}/stream-key`);
}

export function regenerateStreamKey(venueId: number): Promise<{ stream_key: string; rtmp_url: string; message: string }> {
  return request(`/venues/${venueId}/stream-key`, { method: "POST" });
}

export function checkHours(venueId: number): Promise<HoursCheck> {
  return request<HoursCheck>(`/venues/${venueId}/hours-check`);
}

export function createVenue(data: {
  name: string;
  location: string;
  description: string;
  category: string;
  business_hours: string;
}): Promise<Venue> {
  return request<Venue>("/venues", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function getAnalytics(
  venueId: number,
  period: "week" | "month" | "all" = "week"
): Promise<AnalyticsResponse> {
  return request<AnalyticsResponse>(`/venues/${venueId}/analytics?period=${period}`);
}

export function completeView(
  venueId: number,
  durationWatched: number
): Promise<{ success: boolean }> {
  return request(`/venues/${venueId}/view/complete`, {
    method: "POST",
    body: JSON.stringify({ duration_watched: durationWatched }),
  });
}
