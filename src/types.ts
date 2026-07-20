export interface Venue {
  id: number;
  name: string;
  location: string;
  description: string;
  category: string;
  thumbnail_url: string;
  is_live: number;
  viewer_count: number;
  owner_email: string;
  business_hours: string;
  stream_key?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StreamKeyInfo {
  stream_key: string;
  rtmp_url: string;
  stream_url: string;
  instructions: {
    obs: string;
    ip_camera: string;
  };
}

export interface HoursCheck {
  is_open: boolean;
  reason: string;
  today?: string;
  hours?: { open: string; close: string };
  current_time?: string;
}

export interface User {
  id: number;
  email: string;
  venue_id: number | null;
}

export interface BusinessHours {
  [day: string]: { open: string; close: string };
}

export const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
