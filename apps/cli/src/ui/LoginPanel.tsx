import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { theme } from "./theme.js";

export type LoginPhase =
  | { phase: "idle" }
  | { phase: "prompt"; pending: string | null; reason: string }
  | { phase: "waiting"; url: string | null; pending: string | null };

// Login prompt and the wait for the browser
export function LoginPanel({ login }: { login: LoginPhase }) {
  if (login.phase === "idle") return null;
  if (login.phase === "prompt") {
    return (
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={theme.accent}
        paddingX={1}
        flexDirection="column"
      >
        <Text>
          <Text color={theme.accent}>◆ </Text>
          {login.reason}
        </Text>
        <Text color={theme.muted}>
          Press <Text color="white">Enter</Text> to log in with Google ·{" "}
          <Text color="white">esc</Text> to cancel
        </Text>
      </Box>
    );
  }
  return (
    <Box marginTop={1} flexDirection="column">
      <Text>
        <Text color={theme.accent}>
          <Spinner type="dots" />
        </Text>{" "}
        Waiting for Google login in your browser
        <Text color={theme.muted}> (esc to cancel)</Text>
      </Text>
      {login.url && (
        <Text color={theme.muted} wrap="wrap">
          {"  "}Browser did not open? Visit {login.url}
        </Text>
      )}
    </Box>
  );
}
