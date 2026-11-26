import type { Session, Usage } from "@nimbus/harness";
import { Box, Static, useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { HELP_TEXT, matchCommands } from "./commands.js";
import { emptyDraft, type Draft } from "./editor.js";
import { formatCost, formatTokens } from "./format.js";
import { Header, type HeaderInfo } from "./Header.js";
import { ItemView } from "./ItemView.js";
import { PromptInput } from "./PromptInput.js";
import { CommandMenu, StatusBar, WorkingLine } from "./StatusBar.js";
import { applyEvent, newId, settle, type Item } from "./transcript.js";

const FLUSH_MS = 50;
const EXIT_WINDOW_MS = 2000;

interface Props {
  createSession: () => Session;
  info: HeaderInfo;
  onExit: (totalCost: number) => void;
}

function usageReport(usage: Usage, cost: number): string {
  const cached = usage.inputTokens ? Math.round((usage.cachedTokens / usage.inputTokens) * 100) : 0;
  return [
    `Input ${formatTokens(usage.inputTokens)} tokens (${cached}% cached)`,
    `Output ${formatTokens(usage.outputTokens)} tokens`,
    `Cost ${formatCost(cost)}`,
  ].join(" · ");
}

export function App({ createSession, info, onExit }: Props) {
  const { exit } = useApp();
  const session = useRef<Session>(null as unknown as Session);
  if (!session.current) session.current = createSession();
  const spentBefore = useRef(0);

  const [done, setDone] = useState<Item[]>(() => [{ kind: "header", id: newId() }]);
  const [live, setLive] = useState<Item[]>([]);
  const [staticKey, setStaticKey] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [menuIndex, setMenuIndex] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [exitArmed, setExitArmed] = useState(false);
  const [usage, setUsage] = useState<Usage>({ ...session.current.usage });
  const [cost, setCost] = useState(0);

  const controller = useRef<AbortController | null>(null);
  const working = useRef<Item[]>([]);
  const flushTimer = useRef<NodeJS.Timeout | null>(null);

  const flush = useCallback((final = false) => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const { done: settled, live: rest } = final
      ? { done: working.current, live: [] }
      : settle(working.current);
    working.current = rest;
    if (settled.length) setDone((prev) => [...prev, ...settled]);
    setLive(rest);
  }, []);

  const append = useCallback((item: Item) => setDone((prev) => [...prev, item]), []);

  const quit = useCallback(async () => {
    controller.current?.abort();
    await session.current.dispose();
    onExit(spentBefore.current + session.current.cost);
    exit();
  }, [exit, onExit]);

  const runTurn = useCallback(
    async (text: string) => {
      const current = session.current;
      const abort = new AbortController();
      controller.current = abort;
      setRunningSince(Date.now());
      append({ kind: "user", id: newId(), text });
      working.current = [];
      for await (const event of current.send(text, abort.signal)) {
        working.current = applyEvent(working.current, event);
        if (event.type === "text_delta") {
          if (!flushTimer.current) flushTimer.current = setTimeout(() => flush(), FLUSH_MS);
        } else {
          flush();
        }
        setUsage({ ...current.usage });
        setCost(current.cost);
      }
      flush(true);
      controller.current = null;
      setRunningSince(null);
    },
    [append, flush],
  );

  const runCommand = useCallback(
    (name: string) => {
      switch (name) {
        case "/help":
          append({ kind: "assistant", id: newId(), text: HELP_TEXT });
          return;
        case "/usage":
          append({
            kind: "notice",
            id: newId(),
            text: usageReport(session.current.usage, session.current.cost),
            tone: "info",
          });
          return;
        case "/clear": {
          const old = session.current;
          spentBefore.current += old.cost;
          void old.dispose();
          session.current = createSession();
          process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
          setDone([{ kind: "header", id: newId() }]);
          setStaticKey((key) => key + 1);
          setUsage({ ...session.current.usage });
          setCost(0);
          return;
        }
        case "/exit":
          void quit();
          return;
        default:
          append({
            kind: "notice",
            id: newId(),
            text: `Unknown command ${name}. Try /help.`,
            tone: "error",
          });
      }
    },
    [append, createSession, quit],
  );

  const submit = useCallback(
    (text: string) => {
      setDraft(emptyDraft);
      setHistory((prev) => (prev.at(-1) === text ? prev : [...prev, text]));
      if (text.startsWith("/") && !text.includes(" ")) {
        runCommand(text.toLowerCase());
        return;
      }
      if (controller.current) {
        setQueued(text);
        return;
      }
      void runTurn(text);
    },
    [runCommand, runTurn],
  );

  // Send a queued message once the turn ends
  useEffect(() => {
    if (runningSince === null && queued) {
      setQueued(null);
      void runTurn(queued);
    }
  }, [runningSince, queued, runTurn]);

  // New text, menu starts from the top
  useEffect(() => setMenuIndex(0), [draft.value]);

  useEffect(() => {
    if (!exitArmed) return;
    const timer = setTimeout(() => setExitArmed(false), EXIT_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [exitArmed]);

  useInput((input, key) => {
    if (key.escape) {
      if (controller.current) controller.current.abort();
      else if (queued) setQueued(null);
      else setDraft(emptyDraft);
      return;
    }
    if (key.ctrl && input === "c") {
      if (controller.current) {
        controller.current.abort();
      } else if (draft.value) {
        setDraft(emptyDraft);
      } else if (exitArmed) {
        void quit();
      } else {
        setExitArmed(true);
      }
    }
  });

  const menu = matchCommands(draft.value);
  const selected = Math.min(menuIndex, Math.max(menu.length - 1, 0));

  const hint = exitArmed
    ? "Press Ctrl+C again to exit"
    : queued
      ? `Queued: ${queued.slice(0, 40)} (esc to drop)`
      : "/help for commands";

  return (
    <Box flexDirection="column">
      <Static key={staticKey} items={done}>
        {(item) =>
          item.kind === "header" ? (
            <Header key={item.id} info={info} />
          ) : (
            <ItemView key={item.id} item={item} />
          )
        }
      </Static>
      {live.map((item) => (item.kind === "header" ? null : <ItemView key={item.id} item={item} />))}
      {runningSince !== null && <WorkingLine since={runningSince} />}
      <Box marginTop={1} flexDirection="column">
        <PromptInput
          draft={draft}
          onChange={setDraft}
          onSubmit={submit}
          history={history}
          placeholder="Ask Nimbus to read, fix or build something"
          menu={menu}
          selected={selected}
          onSelect={setMenuIndex}
        />
        {menu.length > 0 ? (
          <CommandMenu commands={menu} selected={selected} />
        ) : (
          <StatusBar model={info.model} usage={usage} cost={cost} hint={hint} />
        )}
      </Box>
    </Box>
  );
}
