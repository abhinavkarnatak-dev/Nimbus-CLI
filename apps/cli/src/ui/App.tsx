import type { Session, Usage } from "@nimbus/harness";
import type { AuthController } from "../auth/controller.js";
import { Box, Static, useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { HELP_TEXT, matchCommands, parseCommand } from "./commands.js";
import { emptyDraft, fromText, type Draft } from "./editor.js";
import { formatCost, formatTokens } from "./format.js";
import { Header, type HeaderInfo } from "./Header.js";
import { ItemView } from "./ItemView.js";
import { LoginPanel, type LoginPhase } from "./LoginPanel.js";
import { PromptInput } from "./PromptInput.js";
import { CommandMenu, StatusBar, WorkingLine } from "./StatusBar.js";
import { applyEvent, newId, settle, type Item } from "./transcript.js";

const FLUSH_MS = 50;
const EXIT_WINDOW_MS = 2000;

interface Props {
  createSession: () => Session;
  info: HeaderInfo;
  onExit: (totalCost: number) => void;
  // Null in direct mode, where no login is needed
  auth: AuthController | null;
  loginOnStart?: boolean;
  inviteCode?: string;
}

function usageReport(usage: Usage, cost: number): string {
  const cached = usage.inputTokens ? Math.round((usage.cachedTokens / usage.inputTokens) * 100) : 0;
  return [
    `Input ${formatTokens(usage.inputTokens)} tokens (${cached}% cached)`,
    `Output ${formatTokens(usage.outputTokens)} tokens`,
    `Cost ${formatCost(cost)}`,
  ].join(" · ");
}

export function App({
  createSession,
  info,
  onExit,
  auth,
  loginOnStart = false,
  inviteCode,
}: Props) {
  const { exit } = useApp();
  const session = useRef<Session>(null as unknown as Session);
  if (!session.current) session.current = createSession();
  const spentBefore = useRef(0);

  const [done, setDone] = useState<Item[]>(() => [{ kind: "header", id: newId() }]);
  const [live, setLive] = useState<Item[]>([]);
  const [staticKey, setStaticKey] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [menuIndex, setMenuIndex] = useState(0);
  const [browsingHistory, setBrowsingHistory] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [exitArmed, setExitArmed] = useState(false);
  const [usage, setUsage] = useState<Usage>({ ...session.current.usage });
  const [cost, setCost] = useState(0);
  const [account, setAccount] = useState<string | null>(auth?.state.email ?? null);
  const [loggedIn, setLoggedIn] = useState(auth?.state.loggedIn ?? true);
  const [login, setLogin] = useState<LoginPhase>({ phase: "idle" });
  const loginAbort = useRef<AbortController | null>(null);

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
  const notice = useCallback(
    (text: string, tone: "info" | "error" = "info") =>
      append({ kind: "notice", id: newId(), text, tone }),
    [append],
  );

  const quit = useCallback(async () => {
    controller.current?.abort();
    await session.current.dispose();
    onExit(spentBefore.current + session.current.cost);
    exit();
  }, [exit, onExit]);

  const runTurn = useCallback(
    async (text: string, echo = true) => {
      const current = session.current;
      const abort = new AbortController();
      controller.current = abort;
      setRunningSince(Date.now());
      if (echo) append({ kind: "user", id: newId(), text });
      working.current = [];
      for await (const event of current.send(text, abort.signal)) {
        // Token refused: forget it and ask to log in, keeping the message
        if (event.type === "error" && event.status === 401 && auth) {
          auth.forget();
          setLoggedIn(false);
          setAccount(null);
          setLogin({
            phase: "prompt",
            pending: text,
            reason: "Your login has expired or was revoked. Log in again to continue.",
          });
          continue;
        }
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
    [append, flush, auth],
  );

  // Browser login, then send the message that was waiting for it
  const beginLogin = useCallback(
    async (pending: string | null, code?: string) => {
      if (!auth || loginAbort.current) return;
      const abort = new AbortController();
      loginAbort.current = abort;
      setLogin({ phase: "waiting", url: null, pending });
      try {
        const email = await auth.login({
          signal: abort.signal,
          inviteCode: code,
          onUrl: (url) => setLogin((prev) => (prev.phase === "waiting" ? { ...prev, url } : prev)),
        });
        setAccount(email);
        setLoggedIn(true);
        notice(`✓ Logged in as ${email}`);
        setLogin({ phase: "idle" });
        if (pending) void runTurn(pending, false);
      } catch (error) {
        setLogin({ phase: "idle" });
        notice((error as Error).message, abort.signal.aborted ? "info" : "error");
        if (pending) setDraft(fromText(pending));
      } finally {
        loginAbort.current = null;
      }
    },
    [auth, notice, runTurn],
  );

  const runCommand = useCallback(
    (name: string, arg = "") => {
      switch (name) {
        case "/help":
          append({ kind: "assistant", id: newId(), text: HELP_TEXT });
          return;
        case "/usage": {
          const report = usageReport(session.current.usage, session.current.cost);
          if (!auth?.state.loggedIn) {
            notice(report);
            return;
          }
          void auth
            .account()
            .then((account) =>
              notice(
                account
                  ? `${report}\nTrial credit: ${formatCost(account.spentMicroUsd / 1e6)} of ${formatCost(account.quotaMicroUsd / 1e6)} used`
                  : report,
              ),
            );
          return;
        }
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
        case "/login":
          if (!auth) notice("No login needed: Nimbus is using your own OpenAI key.");
          else void beginLogin(null, arg || undefined);
          return;
        case "/logout":
          if (!auth) {
            notice("No login needed: Nimbus is using your own OpenAI key.");
          } else {
            void auth.logout().then(() => {
              setLoggedIn(false);
              setAccount(null);
              notice("Logged out on this computer.");
            });
          }
          return;
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
    [append, auth, beginLogin, createSession, notice, quit],
  );

  const submit = useCallback(
    (text: string) => {
      setDraft(emptyDraft);
      setHistory((prev) => (prev.at(-1) === text ? prev : [...prev, text]));
      const command = parseCommand(text);
      if (command) {
        runCommand(command.name, command.arg);
        return;
      }
      if (login.phase === "waiting") {
        notice("Finish logging in first, or press esc to cancel.");
        setDraft(fromText(text));
        return;
      }
      if (auth && !loggedIn) {
        append({ kind: "user", id: newId(), text });
        if (login.phase === "prompt") {
          void beginLogin(text);
          return;
        }
        setLogin({ phase: "prompt", pending: text, reason: "Log in to start using Nimbus." });
        return;
      }
      if (controller.current) {
        setQueued(text);
        return;
      }
      void runTurn(text);
    },
    [append, auth, beginLogin, loggedIn, login.phase, notice, runCommand, runTurn],
  );

  // nimbus login: open the browser once, right away
  const loginStarted = useRef(false);
  useEffect(() => {
    if (!loginOnStart || loginStarted.current) return;
    loginStarted.current = true;
    void beginLogin(null, inviteCode);
  }, [loginOnStart, beginLogin, inviteCode]);

  // A token from NIMBUS_TOKEN has no saved email yet
  useEffect(() => {
    if (auth && loggedIn && !account) {
      void auth.refreshEmail().then((email) => email && setAccount(email));
    }
  }, [auth, loggedIn, account]);

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
    if (login.phase === "prompt" && key.return && !draft.value) {
      void beginLogin(login.pending);
      return;
    }
    if (key.escape && login.phase === "waiting") {
      loginAbort.current?.abort();
      return;
    }
    if (key.escape && login.phase === "prompt") {
      if (login.pending) setDraft(fromText(login.pending));
      setLogin({ phase: "idle" });
      return;
    }
    if (key.escape) {
      if (controller.current) controller.current.abort();
      else if (queued) setQueued(null);
      else setDraft(emptyDraft);
      return;
    }
    if (key.ctrl && input === "c") {
      if (loginAbort.current) {
        loginAbort.current.abort();
      } else if (controller.current) {
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

  // A recalled "/login" should not open the menu and take over the arrows
  const menu = browsingHistory ? [] : matchCommands(draft.value);
  const selected = Math.min(menuIndex, Math.max(menu.length - 1, 0));

  const hint = exitArmed
    ? "Press Ctrl+C again to exit"
    : queued
      ? `Queued: ${queued.slice(0, 40)} (esc to drop)`
      : auth && !loggedIn
        ? "not logged in · /login"
        : account
          ? `${account} · /help for commands`
          : "/help for commands";

  return (
    <Box flexDirection="column">
      <Static key={staticKey} items={done}>
        {(item) =>
          item.kind === "header" ? (
            <Header
              key={item.id}
              info={info}
              account={auth ? (account ?? (loggedIn ? undefined : "not logged in")) : undefined}
            />
          ) : (
            <ItemView key={item.id} item={item} />
          )
        }
      </Static>
      {live.map((item) => (item.kind === "header" ? null : <ItemView key={item.id} item={item} />))}
      {runningSince !== null && <WorkingLine since={runningSince} />}
      <LoginPanel login={login} />
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
          onBrowsingChange={setBrowsingHistory}
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
