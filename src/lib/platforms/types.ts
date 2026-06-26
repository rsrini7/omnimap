export interface Platform {
  /** Display name (e.g. "Claude Code") */
  name: string;
  /** CLI-facing id (e.g. "claude") */
  id: string;
  /** Is the tool binary installed on this machine? */
  detect(): boolean;
  /** Are omm skills already registered? */
  isSetup(): boolean;
  /** Check if installed skills need updating (optional — only for copy-based platforms) */
  needsUpdate?(): { needed: boolean; changes: string[] };
  /** Register omm skills/plugin */
  setup(): Promise<void>;
  /** Unregister omm skills/plugin */
  teardown(): void;
}
