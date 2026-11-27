# Nimbus

[![CI](https://github.com/abhinavkarnatak-dev/Nimbus-CLI/actions/workflows/ci.yml/badge.svg)](https://github.com/abhinavkarnatak-dev/Nimbus-CLI/actions/workflows/ci.yml)

Nimbus is an AI agent that runs in your terminal. Ask it anything: it searches the web, works through your files, runs commands and writes the code to get it done.

Website: [nimbus.abhinavkarnatak.com](https://nimbus.abhinavkarnatak.com)

> Nimbus is in early access and invite only. It is not on npm yet, so it runs from source.

## Requirements

- Node.js 24 or newer
- pnpm
- Git

## Get started

```sh
git clone https://github.com/abhinavkarnatak-dev/Nimbus-CLI.git
cd Nimbus-CLI
pnpm install --filter "@nimbus/cli..."
pnpm nimbus login --code <your code>
```

A browser tab opens to log in with Google. After that, start Nimbus in any project:

```sh
pnpm nimbus <path to your project>
```

Conversations are saved on your computer. Pick up an earlier one with `--resume`, or the latest one in that folder with `--continue`:

```sh
pnpm nimbus --resume <path to your project>
pnpm nimbus --continue <path to your project>
```

If your internet drops for a moment, Nimbus tries again by itself, up to 5 times, and shows a countdown. Press `Esc` to stop waiting.

## Paying for model calls

Invited accounts start with free Nimbus credit. You can also use your own OpenAI key: add it with `/key` inside Nimbus. The key stays on your computer and model calls go straight to OpenAI. Switch between the two with `/use`.

## Commands and shortcuts

Type `/` inside Nimbus to see every command, or `/help` for the full list.

- `Enter` sends, `Shift+Enter` or `Ctrl+J` adds a new line
- `Esc` stops the current reply
- `Ctrl+L` clears the screen, `/clear` starts a new conversation, `/resume` opens an earlier one
- `Ctrl+C` twice quits

## License

MIT
