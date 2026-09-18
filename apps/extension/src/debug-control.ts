import type { DebugLog } from './debug';
interface DebugStorage {
  local: {
    get(key: string): Promise<Record<string, unknown>>;
    set(value: Record<string, unknown>): Promise<unknown>;
  };
  onChanged: {
    addListener(
      listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void,
    ): void;
  };
}
export function configureDebug(log: DebugLog, storage: DebugStorage) {
  let changed = false;
  storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('crossmarkDebugEnabled' in changes)) return;
    changed = true;
    log.setEnabled(changes.crossmarkDebugEnabled.newValue);
  });
  const ready = storage.local
    .get('crossmarkDebugEnabled')
    .then((saved) => {
      if (!changed) log.setEnabled(saved.crossmarkDebugEnabled);
    })
    .catch(() => {
      /* Storage failure leaves diagnostics disabled. */
    });
  return {
    ready,
    controls: {
      async setEnabled(enabled: boolean) {
        await ready;
        await storage.local.set({ crossmarkDebugEnabled: enabled === true });
        log.setEnabled(enabled);
      },
      export: () => log.export(),
      clear: () => log.clear(),
    },
  };
}
