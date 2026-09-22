import { Volume2 } from "lucide-react";

export function Brand() {
  return (
    <header className="topbar">
      <a className="brand" href="#home" aria-label="SyncUp home">
        <span className="brand-mark" aria-hidden="true"><i /><i /></span>
        <span>SyncUp</span>
      </a>
      <button className="icon-button" type="button" aria-label="Sound on">
        <Volume2 size={19} aria-hidden="true" />
      </button>
    </header>
  );
}
