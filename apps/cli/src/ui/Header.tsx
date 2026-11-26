import { Box, Text } from "ink";
import { shortenPath } from "./format.js";
import { theme } from "./theme.js";

export interface HeaderInfo {
  version: string;
  model: string;
  shell: string;
  cwd: string;
  route: string;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Text>
      <Text color={theme.muted}>{`  ${label.padEnd(7)}`}</Text>
      {value}
    </Text>
  );
}

export function Header({ info }: { info: HeaderInfo }) {
  return (
    <Box
      borderStyle="round"
      borderColor={theme.accent}
      flexDirection="column"
      paddingX={1}
      width={64}
    >
      <Text>
        <Text color={theme.accent}>◆ </Text>
        <Text bold>Welcome to Nimbus</Text>
        <Text color={theme.muted}>{` v${info.version}`}</Text>
      </Text>
      <Text> </Text>
      <Text color={theme.muted}>{"  /help for commands · esc to stop a reply"}</Text>
      <Text> </Text>
      <Row label="cwd" value={shortenPath(info.cwd)} />
      <Row label="model" value={info.model} />
      <Row label="shell" value={info.shell} />
      <Row label="via" value={info.route} />
    </Box>
  );
}
