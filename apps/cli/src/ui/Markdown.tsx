import chalk from "chalk";
import { Text, useWindowSize } from "ink";
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { memo } from "react";
import { theme } from "./theme.js";

const accent = chalk.hex(theme.accent);
const cache = new Map<number, Marked>();

function parserFor(width: number): Marked {
  let parser = cache.get(width);
  if (!parser) {
    parser = new Marked(
      markedTerminal({
        width,
        reflowText: true,
        showSectionPrefix: false,
        tab: 2,
        emoji: false,
        heading: accent.bold,
        firstHeading: accent.bold,
        strong: chalk.bold,
        em: chalk.italic,
        codespan: accent,
        link: accent,
        href: accent.underline,
        blockquote: chalk.gray.italic,
        del: chalk.dim.strikethrough,
        hr: chalk.gray,
      }),
    );
    // Inline formatting inside list items
    parser.use({
      renderer: {
        text(token) {
          return "tokens" in token && token.tokens ? this.parser.parseInline(token.tokens) : false;
        },
      },
    });
    cache.set(width, parser);
  }
  return parser;
}

export function renderMarkdown(text: string, width: number): string {
  const output = parserFor(Math.max(width, 20)).parse(text, { async: false });
  // eslint-disable-next-line no-control-regex -- list bullets end in a color reset
  return output.replace(/^(\s*)\* (?=\x1b\[0m)/gm, "$1• ").trimEnd();
}

export const Markdown = memo(function Markdown({
  text,
  indent = 2,
}: {
  text: string;
  indent?: number;
}) {
  const { columns } = useWindowSize();
  return <Text>{renderMarkdown(text, columns - indent - 1)}</Text>;
});
