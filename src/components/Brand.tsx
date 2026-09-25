import { Volume2, VolumeX } from "lucide-react";
import { useState } from "react";

export function Brand() {
  const [soundEnabled, setSoundEnabled] = useState(true);
  return (
    <header className="topbar">
      <a className="brand" href="#home" aria-label="SyncUp home">
        <span className="brand-mark" aria-hidden="true"><i /><i /></span>
        <span>SyncUp</span>
      </a>
      <button className="icon-button" type="button" aria-label={soundEnabled ? "Mute sound" : "Enable sound"} aria-pressed={!soundEnabled} onClick={() => setSoundEnabled((enabled) => !enabled)}>
        {soundEnabled ? <Volume2 size={19} aria-hidden="true" /> : <VolumeX size={19} aria-hidden="true" />}
      </button>
    </header>
  );
}
