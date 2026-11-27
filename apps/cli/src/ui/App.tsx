import { cacheSavings, type ContextUsage, type Session, type Usage } from "@nimbus/harness";
import type { AuthController } from "../auth/controller.js";
import type { BillingController } from "../billing/controller.js";
import type { Route } from "../settings.js";
import { Box, Static, useApp, useInput, useWindowSize } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { HELP_TEXT, matchCommands, parseCommand } from "./commands.js";
import { emptyDraft, fromText, type Draft } from "./editor.js";
import { formatCost, formatTokens } from "./format.js";
import { Header, type HeaderInfo } from "./Header.js";
import { ItemView } from "./ItemView.js";
import { BillingPanel, type BillingPanelState } from "./BillingPanel.js";
import { LoginPanel, type LoginPhase } from "./LoginPanel.js";
import { PromptInput } from "./PromptInput.js";
import { CommandMenu, StatusBar, WorkingLine, type RetryInfo } from "./StatusBar.js";
import type { SavedSession, SessionHistory } from "../store/sqlite.js";
import { ResumePanel, type ResumePicker } from "./ResumePanel.js";
import { timeAgo, transcriptFrom } from "./resume.js";
import { applyEvent, newId, settle, type Item } from "./transcript.js";
import { WidthContext } from "./width.js";

const FLUSH_MS = 50;
const EXIT_WINDOW_MS = 2000;

interface Props {
  // With a saved session, continues it under the same id
  createSession: (saved?: SavedSession) => Session;
  info: HeaderInfo;
  auth: AuthController;
  loginOnStart?: boolean;
  inviteCode?: string;
  // Picks Nimbus credit or the user's own key
  billing: BillingController;
  // Saved conversations; missing when the store could not open
  sessions?: SessionHistory;
  // --continue passes a session, --resume opens the picker
  resumeOnStart?: SavedSession | "pick";
}

function resumedItems(saved: SavedSession): Item[] {
  return [
    { kind: "header", id: newId() },
    ...transcriptFrom(saved),
    {
      kind: "notice",
      id: newId(),
      text: `Resumed this conversation from ${timeAgo(saved.updatedAt)}.`,
      tone: "info",
    },
  ];
}

const BAR_WIDTH = 20;

// What /context shows
export function contextReport(context: ContextUsage, usage: Usage, model: string): string {
  const percent = Math.round((context.tokens / context.limit) * 100);
  const filled = Math.min(BAR_WIDTH, Math.round((context.tokens / context.limit) * BAR_WIDTH));
  const number = (count: number) => count.toLocaleString("en-US");
  const row = (label: string, count: number) => `${label.padEnd(18)}${number(count).padStart(9)}`;
  const { parts } = context;
  const lines = [
    `Context  ${number(context.tokens)} of ${number(context.limit)} tokens (${percent}%)${context.estimated ? ", estimated" : ""}`,
    "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled),
    "",
    row("System prompt", parts.system),
    row("Tools", parts.tools),
    row("Conversation", parts.conversation),
    row("Tool calls", parts.toolCalls),
    row("Reasoning", parts.reasoning),
    "",
  ];
  if (usage.inputTokens === 0) {
    lines.push("Cache    no model calls yet");
  } else {
    const hit = Math.round((usage.cachedTokens / usage.inputTokens) * 100);
    const saved = cacheSavings(model, usage);
    lines.push(
      `Cache    ${hit}% of this session's input came from the cache` +
        (saved > 0 ? `, saved ${formatCost(saved)}` : ""),
    );
  }
  // Notices indent only their first line
  return lines.map((line, index) => (index === 0 ? line : `   ${line}`)).join("\n");
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
  auth,
  loginOnStart = false,
  inviteCode,
  billing,
  sessions,
  resumeOnStart,
}: Props) {
  const { exit } = useApp();
  const initial = typeof resumeOnStart === "object" ? resumeOnStart : undefined;
  const session = useRef<Session>(null as unknown as Session);
  if (!session.current) session.current = createSession(initial);
  const [contextUsage, setContextUsage] = useState(() => session.current.context());
  const refreshContext = useCallback(() => setContextUsage(session.current.context()), []);

  const [done, setDone] = useState<Item[]>(() =>
    initial ? resumedItems(initial) : [{ kind: "header", id: newId() }],
  );
  const [picker, setPicker] = useState<ResumePicker | null>(null);
  const [live, setLive] = useState<Item[]>([]);
  const [staticKey, setStaticKey] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [menuIndex, setMenuIndex] = useState(0);
  const [browsingHistory, setBrowsingHistory] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const { columns } = useWindowSize();
  const [retryWait, setRetryWait] = useState<RetryInfo | null>(null);
  const waiting = useRef(false);
  const [queued, setQueued] = useState<string | null>(null);
  const [exitArmed, setExitArmed] = useState(false);
  const [account, setAccount] = useState<string | null>(auth.state.email);
  const [loggedIn, setLoggedIn] = useState(auth.state.loggedIn);
  const [login, setLogin] = useState<LoginPhase>({ phase: "idle" });
  const loginAbort = useRef<AbortController | null>(null);
  const [route, setRoute] = useState<Route>(billing.state.route);
  const [panel, setPanel] = useState<BillingPanelState>({ kind: "none" });

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

  // Change who pays; encrypted reasoning cannot cross accounts
  const switchRoute = useCallback(
    (next: Route, message?: string) => {
      if (billing.use(next)) session.current.forgetReasoning();
      setRoute(billing.state.route);
      if (message) notice(message);
    },
    [billing, notice],
  );

  // Wipe the terminal; the conversation itself stays
  const clearScreen = useCallback(() => {
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    setDone([{ kind: "header", id: newId() }]);
    setStaticKey((key) => key + 1);
  }, []);

  // Earlier conversations in this folder, newest first
  const openPicker = useCallback(() => {
    if (controller.current) {
      notice("Wait for the reply to finish, or press esc to stop it, then /resume.");
      return;
    }
    if (!sessions) {
      notice("Saved conversations are not available on this computer.", "error");
      return;
    }
    const options = sessions
      .list(info.cwd)
      .filter((option) => option.id !== session.current.id && option.turns > 0);
    if (options.length === 0) {
      notice("No earlier conversations in this folder.");
      return;
    }
    setDraft(emptyDraft);
    setPicker({ options, selected: 0 });
  }, [info.cwd, notice, sessions]);

  // Swap in a saved conversation and redraw it
  const openSaved = useCallback(
    (id: string) => {
      const saved = sessions?.load(id);
      if (!saved) {
        notice("That conversation could not be opened.", "error");
        return;
      }
      void session.current.dispose();
      session.current = createSession(saved);
      refreshContext();
      process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
      setDone(resumedItems(saved));
      setStaticKey((key) => key + 1);
    },
    [createSession, notice, sessions, refreshContext],
  );

  const quit = useCallback(async () => {
    controller.current?.abort();
    await session.current.dispose();
    exit();
  }, [exit]);

  const runTurn = useCallback(
    async (
      text: string,
      { echo = true, retry: again = false, switched = false } = {},
    ): Promise<void> => {
      const current = session.current;
      const abort = new AbortController();
      controller.current = abort;
      setRunningSince(Date.now());
      if (echo) append({ kind: "user", id: newId(), text });
      working.current = [];
      let retry = false;
      // A retry continues the failed turn instead of sending the message again
      const events = again ? current.retry(abort.signal) : current.send(text, abort.signal);
      for await (const event of events) {
        // Back to normal once anything else arrives
        if (waiting.current && event.type !== "retrying") {
          waiting.current = false;
          setRetryWait(null);
        }
        if (event.type === "retrying") {
          waiting.current = true;
          setRetryWait({
            until: Date.now() + event.delayMs,
            attempt: event.attempt,
            maxRetries: event.maxRetries,
            reason: event.reason,
          });
        }
        const onKey = billing.state.route === "key";
        // Out of money on one side: switch to the other once and resend
        if (event.type === "error" && !switched) {
          const nimbusOut = !onKey && event.status === 402 && billing.state.hasKey;
          const keyOut =
            onKey &&
            auth.state.loggedIn &&
            (event.status === 401 || (event.status === 429 && event.code === "insufficient_quota"));
          if (nimbusOut) {
            switchRoute("key", "Nimbus credit used up, switched to your OpenAI key.");
            retry = true;
            continue;
          }
          if (keyOut) {
            switchRoute(
              "nimbus",
              event.status === 401
                ? "OpenAI rejected your key, switched to Nimbus credit."
                : "Your OpenAI key is out of credit, switched to Nimbus credit.",
            );
            retry = true;
            continue;
          }
        }
        const keyProblem =
          onKey &&
          event.type === "error" &&
          (event.status === 401 || (event.status === 429 && event.code === "insufficient_quota"));
        if (keyProblem) {
          working.current = applyEvent(working.current, event);
          working.current = applyEvent(working.current, {
            type: "error",
            message: "Update your key with /key, or switch to Nimbus credit with /use nimbus.",
          });
          flush();
          continue;
        }
        if (event.type === "error" && event.status === 402 && !onKey) {
          working.current = applyEvent(working.current, event);
          working.current = applyEvent(working.current, {
            type: "error",
            message: billing.state.hasKey
              ? "Switch to your own OpenAI key with /use key."
              : "Add your own OpenAI key with /key to keep going.",
          });
          flush();
          continue;
        }
        // Token refused: forget it and ask to log in, keeping the message
        if (event.type === "error" && event.status === 401 && !onKey) {
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
          refreshContext();
        }
      }
      flush(true);
      controller.current = null;
      waiting.current = false;
      setRetryWait(null);
      setRunningSince(null);
      refreshContext();
      if (retry) await runTurn(text, { echo: false, retry: true, switched: true });
    },
    [append, flush, auth, billing, switchRoute, refreshContext],
  );

  // Browser login, then send the message that was waiting for it
  const beginLogin = useCallback(
    async (pending: string | null, code?: string) => {
      if (loginAbort.current) return;
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
        if (pending) void runTurn(pending, { echo: false, retry: session.current.canRetry });
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
        case "/context":
          notice(contextReport(session.current.context(), session.current.usage, info.model));
          return;
        case "/usage": {
          const report = usageReport(session.current.usage, session.current.cost);
          if (billing.state.route === "key") {
            notice(`${report}\nPaid with your OpenAI key (${billing.state.keyHint})`);
            return;
          }
          if (!auth.state.loggedIn) {
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
          void old.dispose();
          session.current = createSession();
          refreshContext();
          clearScreen();
          return;
        }
        case "/resume":
          openPicker();
          return;
        case "/login":
          void beginLogin(null, arg || undefined);
          return;
        case "/logout":
          void auth.logout().then(() => {
            setLoggedIn(false);
            setAccount(null);
            notice("Logged out on this computer.");
          });
          return;
        case "/key":
          if (arg === "remove") {
            const hadKey = billing.state.hasKey;
            if (billing.state.route === "key") session.current.forgetReasoning();
            billing.removeKey();
            setRoute(billing.state.route);
            notice(hadKey ? "Removed your OpenAI key. Using Nimbus credit." : "No key was saved.");
          } else {
            setDraft(emptyDraft);
            setPanel({
              kind: "key",
              current: billing.state.keyHint,
              checking: false,
              error: null,
            });
          }
          return;
        case "/use": {
          const pick = (next: Route) => {
            if (next === "key" && !billing.state.hasKey) {
              notice("No OpenAI key saved yet. Add one with /key.");
              return;
            }
            const label = next === "key" ? "your OpenAI key" : "Nimbus credit";
            switchRoute(next, `Using ${label}.`);
            if (next === "nimbus" && !auth.state.loggedIn) {
              setLogin({
                phase: "prompt",
                pending: null,
                reason: "Log in to use Nimbus credit.",
              });
            }
          };
          if (arg === "nimbus" || arg === "key") {
            pick(arg);
            return;
          }
          const state = billing.state;
          const options = [
            {
              route: "nimbus" as const,
              label: "Nimbus credit",
              detail: auth.state.loggedIn ? "checking..." : "needs login",
              current: state.route === "nimbus",
            },
            {
              route: "key" as const,
              label: "Your OpenAI key",
              detail: state.keyHint ?? "not added, use /key",
              current: state.route === "key",
            },
          ];
          setPanel({
            kind: "use",
            options,
            selected: state.route === "key" ? 1 : 0,
          });
          void auth.account().then((info) => {
            if (!info) return;
            const detail = `${formatCost(info.spentMicroUsd / 1e6)} of ${formatCost(info.quotaMicroUsd / 1e6)} used`;
            setPanel((prev) =>
              prev.kind === "use"
                ? {
                    ...prev,
                    options: prev.options.map((option) =>
                      option.route === "nimbus" ? { ...option, detail } : option,
                    ),
                  }
                : prev,
            );
          });
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
    [
      append,
      auth,
      beginLogin,
      billing,
      clearScreen,
      createSession,
      info.model,
      notice,
      openPicker,
      quit,
      refreshContext,
      switchRoute,
    ],
  );

  // Save a pasted key; a bad key keeps the old one
  const submitKey = useCallback(
    async (key: string) => {
      setPanel((prev) => (prev.kind === "key" ? { ...prev, checking: true, error: null } : prev));
      const before = billing.state.route;
      const result = await billing.setKey(key);
      if (!result.ok) {
        setPanel((prev) =>
          prev.kind === "key" ? { ...prev, checking: false, error: result.message } : prev,
        );
        return;
      }
      if (before !== billing.state.route) session.current.forgetReasoning();
      setRoute(billing.state.route);
      setPanel({ kind: "none" });
      notice(`✓ Saved your OpenAI key (${billing.state.keyHint}). Using it from now on.`);
    },
    [billing, notice],
  );

  const submit = useCallback(
    (text: string) => {
      setDraft(emptyDraft);
      // A key never goes into history or the transcript
      if (panel.kind === "key") {
        if (!panel.checking) void submitKey(text);
        return;
      }
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
      if (!loggedIn && route !== "key") {
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
    [
      append,
      beginLogin,
      loggedIn,
      login.phase,
      notice,
      panel,
      route,
      runCommand,
      runTurn,
      submitKey,
    ],
  );

  // nimbus --resume: show the list once, right away
  const pickedOnStart = useRef(false);
  useEffect(() => {
    if (resumeOnStart !== "pick" || pickedOnStart.current) return;
    pickedOnStart.current = true;
    openPicker();
  }, [resumeOnStart, openPicker]);

  // nimbus login: open the browser once, right away
  const loginStarted = useRef(false);
  useEffect(() => {
    if (!loginOnStart || loginStarted.current) return;
    loginStarted.current = true;
    void beginLogin(null, inviteCode);
  }, [loginOnStart, beginLogin, inviteCode]);

  // A token from NIMBUS_TOKEN has no saved email yet
  useEffect(() => {
    if (loggedIn && !account) {
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
    if (key.ctrl && input === "l") {
      clearScreen();
      return;
    }
    if (picker) {
      if (key.upArrow || key.downArrow) {
        const step = key.upArrow ? -1 : 1;
        const count = picker.options.length;
        setPicker({ ...picker, selected: (picker.selected + step + count) % count });
      } else if (key.return) {
        const option = picker.options[picker.selected];
        setPicker(null);
        if (option) openSaved(option.id);
      } else if (key.escape) {
        setPicker(null);
      }
      return;
    }
    if (panel.kind === "use") {
      if (key.upArrow || key.downArrow) {
        const step = key.upArrow ? -1 : 1;
        const count = panel.options.length;
        setPanel({ ...panel, selected: (panel.selected + step + count) % count });
      } else if (key.return) {
        const option = panel.options[panel.selected];
        setPanel({ kind: "none" });
        if (option && !option.current) runCommand("/use", option.route);
      } else if (key.escape) {
        setPanel({ kind: "none" });
      }
      return;
    }
    if (panel.kind === "key" && key.escape) {
      if (!panel.checking) {
        setPanel({ kind: "none" });
        setDraft(emptyDraft);
      }
      return;
    }
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
      : route === "key"
        ? "your OpenAI key · /use to switch"
        : !loggedIn
          ? "not logged in · /login"
          : account
            ? `${account} · /help for commands`
            : "/help for commands";

  return (
    <WidthContext.Provider value={columns}>
      <Box flexDirection="column">
        <Static key={staticKey} items={done}>
          {(item) =>
            item.kind === "header" ? (
              <Header
                key={item.id}
                info={route === "key" ? { ...info, route: "your OpenAI key" } : info}
                account={account ?? (loggedIn ? undefined : "not logged in")}
              />
            ) : (
              <ItemView key={item.id} item={item} />
            )
          }
        </Static>
        {live.map((item) =>
          item.kind === "header" ? null : <ItemView key={item.id} item={item} />,
        )}
        {runningSince !== null && <WorkingLine since={runningSince} retry={retryWait} />}
        <LoginPanel login={login} />
        <BillingPanel panel={panel} />
        <ResumePanel picker={picker} />
        <Box marginTop={1} flexDirection="column">
          <PromptInput
            draft={draft}
            onChange={setDraft}
            onSubmit={submit}
            history={history}
            placeholder={panel.kind === "key" ? "sk-..." : "Ask Nimbus anything"}
            menu={menu}
            selected={selected}
            onSelect={setMenuIndex}
            onBrowsingChange={setBrowsingHistory}
            mask={panel.kind === "key"}
            active={panel.kind !== "use" && !picker}
          />
          {menu.length > 0 ? (
            <CommandMenu commands={menu} selected={selected} />
          ) : (
            <StatusBar model={info.model} hint={hint} context={contextUsage} />
          )}
        </Box>
      </Box>
    </WidthContext.Provider>
  );
}
