import { useState } from "react";
import { api } from "../api";
import { Chip } from "../components";
import type { SinkConfig, SinkTestResult } from "../types";

const HINTS: Record<string, string> = {
  overseerr: "Requests with per-user attribution — recommended",
  radarr: "Adds movies directly",
  sonarr: "Adds series directly",
};

/**
 * One configurable sink: URL + API key, a connection test (which also loads
 * quality profiles and root folders for Radarr/Sonarr), then Save.
 */
export function SinkCard({
  name,
  config,
  onSaved,
  onToast,
}: {
  name: "overseerr" | "radarr" | "sonarr";
  config: SinkConfig | null;
  onSaved: () => void;
  onToast: (msg: string, err?: boolean) => void;
}) {
  const isArr = name !== "overseerr";
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(config?.url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [profileId, setProfileId] = useState<number | undefined>(config?.qualityProfileId);
  const [rootFolder, setRootFolder] = useState<string | undefined>(config?.rootFolderPath);
  const [test, setTest] = useState<SinkTestResult | null>(null);
  const [busy, setBusy] = useState(false);

  const label = name.charAt(0).toUpperCase() + name.slice(1);
  // The test must pass before an *arr sink can be saved: its dropdown values
  // (profile, root folder) come from the test response.
  const canSave = Boolean(url) && (config?.apiKeySet || apiKey) && (!isArr || (test?.ok && profileId && rootFolder));

  async function runTest() {
    setBusy(true);
    try {
      const result = await api<SinkTestResult>(`/api/test/${name}`, {
        method: "POST",
        body: JSON.stringify({ url: url || undefined, apiKey: apiKey || undefined }),
      });
      setTest(result);
      if (result.ok && isArr) {
        if (!profileId && result.qualityProfiles?.[0]) setProfileId(result.qualityProfiles[0].id);
        if (!rootFolder && result.rootFolders?.[0]) setRootFolder(result.rootFolders[0]);
      }
    } catch (err) {
      setTest({ ok: false, detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const fields: Record<string, unknown> = { url };
      if (apiKey) fields.apiKey = apiKey;
      if (isArr) {
        fields.qualityProfileId = profileId;
        fields.rootFolderPath = rootFolder;
      }
      await api("/api/config", { method: "PUT", body: JSON.stringify({ sinks: { [name]: fields } }) });
      onToast(`${label} saved`);
      setEditing(false);
      setApiKey("");
      onSaved();
    } catch (err) {
      onToast(`Save failed: ${(err as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="form-row">
        <div className="form-label">
          <div className="name">{label}</div>
          <div className="hint">{HINTS[name]}</div>
        </div>
        {config ? (
          <>
            <input className="input input-grow" type="text" value={config.url} readOnly aria-label={`${label} URL`} />
            <Chip tone="ok">active</Chip>
          </>
        ) : (
          <Chip tone="muted">not configured</Chip>
        )}
        <button
          className="btn"
          onClick={() => {
            setUrl(config?.url ?? "");
            setProfileId(config?.qualityProfileId);
            setRootFolder(config?.rootFolderPath);
            setEditing(true);
          }}
        >
          {config ? "Edit" : "Configure"}
        </button>
      </div>
    );
  }

  return (
    <div className="form-row sink-edit">
      <div className="form-label">
        <div className="name">{label}</div>
        <div className="hint">{HINTS[name]}</div>
      </div>
      <div className="sink-fields">
        <div className="sink-line">
          <input
            className="input input-grow"
            type="text"
            placeholder={`http://${name}:${name === "overseerr" ? 5055 : name === "radarr" ? 7878 : 8989}`}
            value={url}
            aria-label={`${label} URL`}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            className="input input-grow"
            type="password"
            placeholder={config?.apiKeySet ? "API key unchanged" : "API key"}
            value={apiKey}
            aria-label={`${label} API key`}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        {isArr && test?.ok && (
          <div className="sink-line">
            <select
              className="input"
              value={profileId ?? ""}
              aria-label="Quality profile"
              onChange={(e) => setProfileId(Number(e.target.value))}
            >
              {test.qualityProfiles?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={rootFolder ?? ""}
              aria-label="Root folder"
              onChange={(e) => setRootFolder(e.target.value)}
            >
              {test.rootFolders?.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="sink-line">
          <button className="btn" onClick={() => void runTest()} disabled={busy}>
            Test
          </button>
          {test && <Chip tone={test.ok ? "ok" : "err"}>{test.detail}</Chip>}
          <div style={{ flex: 1 }} />
          <button
            className="btn"
            onClick={() => {
              setEditing(false);
              setTest(null);
              setApiKey("");
              setUrl(config?.url ?? "");
            }}
          >
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!canSave || busy}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
