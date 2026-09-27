import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';
import { CircleAlert, LoaderCircle, Settings2, X } from 'lucide-react';
import { type State, initialState } from './state';
import type { Command } from './engine';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { activityLines, command, statusLabel } from './popup/shared';
import { ActivityList, BrandMark, StatusText } from './popup/parts';
import { Overview } from './popup/overview';
import { Browsers, type Confirmation } from './popup/browsers';
import { Settings } from './popup/settings';
import { Onboarding } from './popup/onboarding';
import './theme.css';

const tabs = ['overview', 'activity', 'browsers'] as const;
type Tab = (typeof tabs)[number] | 'settings';

function App() {
  const [state, setState] = useState<State>(initialState());
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reauth, setReauth] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation>();
  const [, tick] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await command({ type: 'state' });
        if (active) {
          setState(next);
          setLoaded(true);
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : String(e));
          setLoaded(true);
        }
      }
    };
    void refresh();
    const listener = (_changes: unknown, area: string) => {
      if (area === 'local') void refresh();
    };
    browser.storage.onChanged.addListener(listener);
    const time = setInterval(() => tick((t) => t + 1), 1000);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(listener);
      clearInterval(time);
    };
  }, []);
  async function act(message: Command) {
    setBusy(true);
    setError('');
    try {
      setState(await command(message));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function openConfirm(confirmation: Confirmation) {
    setError('');
    setConfirm(confirmation);
  }
  async function exportData() {
    try {
      const data = await command({ type: 'export' });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `crossmark-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(String(e));
    }
  }
  // Snapshots cached by earlier versions can hold activity kinds that are no longer shown.
  const activity = (state.snapshot?.activity ?? []).filter((e) =>
    Object.hasOwn(activityLines, e.kind),
  );
  const main = loaded && state.connected && !reauth;
  const status = statusLabel(state);
  const message = error || state.error;
  const alert = message && (
    <Alert variant="destructive" className="rounded-none border-x-0 border-t-0 px-4">
      <CircleAlert />
      <AlertDescription className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words">{message}</span>
        {error && (
          <button
            aria-label="Dismiss error"
            className="-m-1 p-1 opacity-70 hover:opacity-100"
            onClick={() => setError('')}
          >
            <X className="size-3.5" />
          </button>
        )}
      </AlertDescription>
    </Alert>
  );
  return (
    <div className="flex h-full flex-col" aria-busy={busy || !loaded}>
      <header className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <BrandMark />
        <span className="text-base font-semibold tracking-tight">crossmark</span>
        {main && (
          <span className="ml-auto">
            <StatusText
              label={status.label}
              tone={status.tone}
              pulse={state.status === 'syncing' && !state.paused}
            />
          </span>
        )}
      </header>
      {!loaded ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading
        </div>
      ) : !main ? (
        <>
          {alert}
          <Onboarding
            state={state}
            busy={busy}
            act={act}
            onNavigate={() => setError('')}
            onCancelReauth={() => setReauth(false)}
          />
        </>
      ) : (
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as Tab)}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="shrink-0 border-b px-4">
            <TabsList aria-label="Extension navigation" className="flex w-full">
              {tabs.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {t[0].toUpperCase() + t.slice(1)}
                </TabsTrigger>
              ))}
              <TabsTrigger
                value="settings"
                aria-label="Settings"
                title="Settings"
                className="ml-auto px-1 data-[state=active]:text-primary"
              >
                <Settings2 />
              </TabsTrigger>
            </TabsList>
          </div>
          {alert}
          <TabsContent value="overview" className="flex min-h-0 flex-col">
            <Overview
              state={state}
              activity={activity}
              busy={busy}
              act={act}
              onSignIn={() => setReauth(true)}
            />
          </TabsContent>
          <TabsContent value="activity" className="min-h-0">
            <ScrollArea className="h-full">
              <div className="px-4 py-1">
                <ActivityList events={activity} />
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="browsers" className="min-h-0">
            <ScrollArea className="h-full">
              <div className="px-4 py-1">
                <Browsers state={state} busy={busy} act={act} confirm={openConfirm} />
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="settings" className="min-h-0">
            <ScrollArea className="h-full">
              <div className="p-4">
                <Settings state={state} busy={busy} onExport={exportData} confirm={openConfirm} />
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      )}
      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              disabled={busy}
              onClick={async () => {
                if (confirm && (await act(confirm.command))) setConfirm(undefined);
              }}
            >
              {confirm?.label}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
