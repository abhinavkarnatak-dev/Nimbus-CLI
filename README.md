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

Changed your mind about an edit? Just ask Nimbus to undo or revert it. It puts the files back from saved copies and keeps any edits you made yourself. Changes made by commands it ran cannot be undone.

If your internet drops for a moment, Nimbus tries again by itself, up to 5 times, and shows a countdown. Press `Esc` to stop waiting.

## Paying for model calls

Invited accounts start with free Nimbus credit. You can also use your own OpenAI key: add it with `/key` inside Nimbus. The key stays on your computer and model calls go straight to OpenAI. Switch between the two with `/use`.

## Commands and shortcuts

Type `/` inside Nimbus to see every command, or `/help` for the full list.

- `Enter` sends, `Shift+Enter` or `Ctrl+J` adds a new line
- `Esc` stops the current reply
- `Ctrl+L` clears the screen, `/clear` starts a new conversation, `/resume` opens an earlier one
- For bigger tasks Nimbus keeps a checklist you can watch as it works; `/todo` shows it
- The status bar shows how full the conversation is, and `/context` shows what fills it
- Long conversations shrink by themselves when they get full; `/compact` does it now
- Nimbus reads your project's `AGENTS.md` (or `CLAUDE.md`) every session; `/init` writes one for you
- Tell Nimbus to remember something and it will know it next time; `/memory` shows what it remembers
- Nimbus asks before it edits files or runs commands; `/permissions` lets it edit without asking, or stop asking (it still asks before git pushes, commits and anything touching secret files like `.env`, which it never reads)
- `/model` picks the model (GPT-6.2 Astra, GPT-6.2 Sol, GPT-6.1 Terra, GPT-6 Luna and older ones) and how much it thinks before answering; your choice is saved
- `/commit` writes a commit message for your staged changes and commits after you approve it (it never pushes)
- `/trace` shows each model call of the last reply: tokens, cache, cost, time and the tools it used (`/trace 3` for reply 3)
- `/usage` shows what this session cost, and `/budget 0.50` makes Nimbus ask before spending more
- `Ctrl+C` twice quits

## Skills

A skill is a set of saved instructions for one kind of task, like reviewing changes or writing release notes. Nimbus uses a skill by itself when your request fits it, and you can run one yourself by typing `/` and its name, with optional text after it (`/review the auth files`).

Each skill is a folder with a `SKILL.md` file:

- `.nimbus/skills/<name>/SKILL.md` in a project, for that project
- `~/.nimbus/skills/<name>/SKILL.md` in your home folder, for every project

```
---
name: review
description: Review the staged changes against our checklist before a commit
---
Look at the staged changes with git diff --staged and check ...
```

The description tells Nimbus when to use the skill. Add `disable-model-invocation: true` under it if only you should run it. `$ARGUMENTS` in the instructions is replaced by the text you type after the name.

The easiest way to make one is `/create-skill`, or just ask Nimbus to make a skill. `/skills` lists them all. New skills show up after `/clear` or in your next session.

## License

MIT
