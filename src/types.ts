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
  crowd_density?: number | null;
  density_updated_at?: string | null;
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

export interface AnalyticsResponse {
  total_views: number;
  unique_viewers: number;
  views_by_day: { date: string; count: number }[];
  views_by_hour: { hour: number; count: number }[];
  avg_view_duration: number;
  repeat_viewer_rate: number;
  peak_day: string | null;
  peak_hour: number | null;
}

export interface CrowdDensity {
  venue_id: number;
  people_count: number;
  density_score: number;
  analyzed_at: string;
  label: string;
}
