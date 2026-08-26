import type { Venue, User, StreamKeyInfo, HoursCheck, AnalyticsResponse, CrowdDensity, CheckInCodeResponse, CheckInResponse, CheckInStats } from "./types";

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
): Promise<{ token: string; venue_id: number | null; email: string; role: string }> {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function signup(
  email: string,
  password: string,
  role: "consumer" | "venue_owner" = "consumer",
  privacyAccepted?: boolean
): Promise<{ success: boolean; role: string }> {
  return request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, role, privacyAccepted }),
  });
}

export function googleLogin(
  credential: string
): Promise<{ token: string; venue_id: number | null; email: string; role: string }> {
  return request("/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
}

export function getMe(): Promise<User> {
  return request<User>("/auth/me");
}

export function recordView(
  venueId: number
): Promise<{ view_token: string; view_window_seconds: number; cooldown_minutes: number; message: string }> {
  return request(`/venues/${venueId}/view`, {
    method: "POST",
  });
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

export function getDensity(venueId: number): Promise<CrowdDensity | null> {
  return request<CrowdDensity | null>(`/venues/${venueId}/density`);
}

export function refreshDensity(venueId: number): Promise<CrowdDensity> {
  return request<CrowdDensity>(`/venues/${venueId}/density/refresh`, {
    method: "POST",
  });
}

// ── Favorites ────────────────────────────────────────────────

export function toggleFavorite(venueId: number): Promise<{ favorited: boolean }> {
  return request<{ favorited: boolean }>(`/venues/${venueId}/favorite`, {
    method: "POST",
  });
}

export function getFavorites(): Promise<(Venue & { favorited_at: string })[]> {
  return request<(Venue & { favorited_at: string })[]>("/venues/favorites");
}

// ── Push Notifications ───────────────────────────────────────

export function subscribePush(subscription: PushSubscriptionJSON): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/push/subscribe", {
    method: "POST",
    body: JSON.stringify(subscription),
  });
}

export function unsubscribePush(endpoint: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/push/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint }),
  });
}

export function getVapidPublicKey(): Promise<{ publicKey: string }> {
  return request<{ publicKey: string }>("/push/vapid-public-key");
}

// ── Promo Overlay ────────────────────────────────────────────

export function setPromo(
  venueId: number,
  promo_text: string | null
): Promise<{ promo_text: string | null }> {
  return request<{ promo_text: string | null }>(`/venues/${venueId}/promo`, {
    method: "PATCH",
    body: JSON.stringify({ promo_text }),
  });
}

export function getPromo(venueId: number): Promise<{ promo_text: string | null }> {
  return request<{ promo_text: string | null }>(`/venues/${venueId}/promo`);
}

// ── Check-Ins ──────────────────────────────────────────────────

export function getCheckInCode(venueId: number): Promise<CheckInCodeResponse> {
  return request<CheckInCodeResponse>(`/venues/${venueId}/check-in-code`);
}

export function checkIn(code: string): Promise<CheckInResponse> {
  return request<CheckInResponse>(`/check-in/${encodeURIComponent(code)}`, {
    method: "POST",
  });
}

export function getCheckIns(venueId: number): Promise<CheckInStats> {
  return request<CheckInStats>(`/venues/${venueId}/check-ins`);
}
