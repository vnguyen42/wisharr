export interface Status {
  version: string;
  startedAt: string;
  running: boolean;
  nextRunAt: string | null;
  intervalMinutes: number;
  plex: {
    tokenSource: "config" | "auto-detected";
    profiles: number;
    managed: number;
    friends: number;
    errors: number;
  };
  rss: "off" | "active" | "unavailable";
  sinks: { name: string }[];
  lastCycle: {
    startedAt: string;
    durationMs: number;
    newItems: number;
    seeded: number;
  } | null;
  totals: { trackedItems: number; requests7d: number };
}

export interface ApiUser {
  plexId: number | null;
  title: string;
  admin: boolean;
  managed: boolean;
  guest: boolean;
  friend: boolean;
  protected: boolean;
  excluded: boolean;
  items: number | null;
  seeded: number;
  added: { title: string; sink: string }[];
  removed: { title: string; sink: string }[];
  error?: string;
  tokenCached: "owner" | "cached" | "none" | "n/a";
  overseerrUserId: number | null;
}

export interface ActivityEntry {
  user: string;
  title: string;
  sink: string;
  seeded: boolean;
  at: string;
}

export interface LogEntry {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  msg: string;
}

export interface SinkConfig {
  url: string;
  apiKeySet: boolean;
  qualityProfileId?: number;
  rootFolderPath?: string;
  seasonMonitoring?: string;
}

export interface ApiConfig {
  plex: {
    tokenSource: "config" | "auto-detected";
    excludeUsers: string[];
    pinnedProfiles: string[];
  };
  sync: {
    intervalMinutes: number;
    includeOwner: boolean;
    seedOnFirstRun: boolean;
    friends: boolean;
    rss: boolean;
    rssIntervalSeconds: number;
    removal: boolean;
  };
  sinks: {
    overseerr: SinkConfig | null;
    radarr: SinkConfig | null;
    sonarr: SinkConfig | null;
  };
}

export interface SinkTestResult {
  ok: boolean;
  detail: string;
  qualityProfiles?: { id: number; name: string }[];
  rootFolders?: string[];
}
