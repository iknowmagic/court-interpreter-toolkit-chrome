import { useEffect, useMemo, useRef, useState } from "react";
import heroImage from "@assets/img/options-hero.png";
import * as rpc from "@utils/chromeRPC";
import "@pages/options/Options.css";

const SAVE_INDICATOR_TIMEOUT_MS = 1800;

function getExtensionVersion(): string {
  try {
    const manifest = chrome.runtime?.getManifest?.();
    return manifest?.version ? `v${manifest.version}` : "v1.5.0";
  } catch {
    return "v1.5.0";
  }
}

export default function Options(): React.JSX.Element {
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const hideSavedTimer = useRef<number | null>(null);
  const versionLabel = useMemo(() => getExtensionVersion(), []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const enabled = await rpc.getCompletionAlarmSetting();
        if (!cancelled) {
          setAlarmEnabled(enabled);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load settings.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (hideSavedTimer.current !== null) {
        window.clearTimeout(hideSavedTimer.current);
      }
    };
  }, []);

  const updateAlarm = async (enabled: boolean) => {
    setAlarmEnabled(enabled);
    setError(null);

    try {
      const nextEnabled = await rpc.setCompletionAlarmSetting(enabled);
      setAlarmEnabled(nextEnabled);
      setShowSaved(true);
      if (hideSavedTimer.current !== null) {
        window.clearTimeout(hideSavedTimer.current);
      }
      hideSavedTimer.current = window.setTimeout(() => {
        setShowSaved(false);
      }, SAVE_INDICATOR_TIMEOUT_MS);
    } catch (updateError) {
      setAlarmEnabled((previous) => !previous);
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Failed to update setting.",
      );
    }
  };

  return (
    <div className="options-page">
      <header className="options-header">
        <h1 className="header-title">Court Interpreter Toolkit</h1>
        <div className="header-sub">Options</div>
      </header>

      <div className="hero-frame">
        <img
          src={heroImage}
          alt="Court Interpreter Toolkit options hero"
          className="hero-image"
        />
      </div>

      <main className="options-content">
        <h2 className="section-label">Sound &amp; Feedback</h2>

        <section className="option-row" aria-busy={loading}>
          <div className="option-info">
            <h3 className="option-title">Play smooth completion alarm</h3>
            <p className="option-desc">
              A gentle chime plays each time you mark a task as done. Good for
              flow. Annoying if your cat is sleeping nearby.
            </p>
          </div>

          <div className="toggle-wrap">
            <span className="toggle-status" id="alarm-status">
              {alarmEnabled ? "On" : "Off"}
            </span>
            <label className="toggle" aria-label="Play smooth completion alarm">
              <input
                type="checkbox"
                checked={alarmEnabled}
                disabled={loading}
                onChange={(event) => {
                  void updateAlarm(event.target.checked);
                }}
              />
              <span className="track" />
              <span className="thumb" />
            </label>
          </div>
        </section>

        <div
          className={`save-status${showSaved ? " visible" : ""}`}
          role="status"
          aria-live="polite"
        >
          Saved.
        </div>

        {error ? (
          <div className="options-error" role="alert">
            {error}
          </div>
        ) : null}
      </main>

      <footer className="options-footer">
        <span className="footer-name">Court Interpreter Toolkit</span>
        <span className="footer-version">{versionLabel}</span>
      </footer>
    </div>
  );
}
