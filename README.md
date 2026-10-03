# claude-vime

[日本語](README.ja.md)

A [Claude Code](https://claude.com/claude-code) mod for typing Japanese in the prompt box the way [vime.nvim](https://github.com/skanehira/vime.nvim) does: you type romaji, it shows kana, and Space converts it to kanji. You never switch the OS input method.

```text
type          kyouhaiitenkidane   the box shows  きょうはいいてんきだね   (underlined)
Space                             the box shows  今日配位天気だね         (the focused segment 今日 in bold)
                                  above the box  1:今日 2:きょう 3:凶 … (1/165)
option+right                      the box shows  今日は良い天気だね       (the focused segment lengthened to 今日は)
ctrl+j                            the box keeps  今日は良い天気だね       (committed, Japanese input off)
```

The candidates depend on anthy's version and on what it has learned.

## Requirements

- **Claude Code 2.1.288.** This is the version the mod was tested with. Mods are early access, and their API can change between releases.
- **anthy's command-line agent:** `anthy-agent-unicode` from [anthy-unicode](https://github.com/fujiwarat/anthy-unicode), or `anthy-agent` from the original anthy 9100h. The mod runs it in egg mode for each conversion.
- **Hooks allowed.** A mod runs as plugin hooks, so it stays off where your settings or your organization's policy turn hooks off.

The mod was tested with `anthy-agent` from nixpkgs' `anthy` (9100h) and with `anthy-agent-unicode` from an anthy-unicode source build, both on macOS. A distribution's anthy package is expected to ship one of them, but none other was checked.

| Where             | How                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------- |
| Nix               | `nix profile install nixpkgs#anthy`, or `pkgs.anthy` in your configuration (anthy-agent) |
| Source (macOS too) | build anthy-unicode as below (anthy-agent-unicode)                                      |

```sh
git clone https://github.com/fujiwarat/anthy-unicode && cd anthy-unicode
meson setup build --prefix=$HOME/.local --sysconfdir=$HOME/.local/etc -Demacs=disabled
meson compile -C build && meson install -C build
```

`--sysconfdir` must be an absolute path; with a relative one, anthy fails to start. Put `~/.local/bin` on the `PATH` Claude Code starts with.

When a session starts, the mod picks the agent in this order and checks each with `--version`:

1. `$VIME_ANTHY_AGENT` alone, when it is set (a command name or a path)
2. `anthy-agent-unicode` on `PATH`
3. `anthy-agent` on `PATH`

## Install

```text
/plugin marketplace add skanehira/claude-vime
/plugin install vime@claude-vime
/reload-plugins
```

To check that it is loaded, type `/vi`: `/vime` is offered with the description "Turn Japanese (romaji to kana and kanji) input on or off".

To turn Japanese input on and off with ctrl+j, free ctrl+j from its default action (a new line) in `~/.claude/keybindings.json`:

```json
{
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+j": null
      }
    }
  ]
}
```

## Keys

While Japanese input is on, the status line shows `あ`.

| Key                                   | While nothing is being composed | While composing kana                      | While converting                                         |
| ------------------------------------- | ------------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| ctrl+j or `/vime`                     | turns Japanese input on or off  | commits the kana, then turns it off       | commits the conversion, then turns it off                |
| `a`–`z` `,` `.` `-` `/` `[` `]`       | starts composing kana           | adds to the kana                          | commits the conversion and starts new kana after it      |
| Space                                 | types a space                   | converts the kana                         | picks the next candidate of the focused segment          |
| `1`–`9`                               | types the digit                 | adds the digit to the kana (`3ji` → `3じ`) | picks the candidate the band numbers so                  |
| left / right, ctrl+b / ctrl+f         | moves the cursor                | commits the kana, then moves the cursor   | focuses the previous / next segment                      |
| option+left / option+right            | (as without the mod)            | commits the kana, then acts as usual      | shortens / lengthens the focused segment                 |
| Backspace                             | deletes a character             | deletes the last kana (きょ counts as one) | goes back to the kana                                    |
| Enter                                 | sends the prompt                | sends it with the kana committed          | sends it with the conversion committed                   |
| any other key                         | (as without the mod)            | commits the kana, then acts as usual      | commits the conversion, then goes in after it            |

ctrl+left and ctrl+right shorten and lengthen a segment too, where the terminal passes them on (macOS takes them for switching spaces by default).

A trailing `n` shows as `n` until the next key decides between ん and な-row; committing turns it into ん, and `nn` always gives ん. `'` also goes into kana that is being composed.

While converting, the cursor sits at the end of the focused segment. That keeps room on both sides for left and right: at the edge of the box, an arrow key that cannot move the cursor never reaches the mod.

A slash command's name typed at the start of the box goes in as typed, so `/vime` and other commands work while Japanese input is on; after the name and a space, romaji composes kana again.

Several characters arriving as one edit (a paste, or keys Claude Code folds together) are taken one at a time when they are all romaji, and otherwise commit the kana and go in as they came.

## Behaviour to know

### Each conversion starts the agent

Space while composing and option+left / option+right each run the agent once and wait for it: about 10 ms on the machine the mod was tested on. Committing a conversion runs it once more to have anthy learn your choices, after the key has been answered, so typing never waits on it. Typing kana runs nothing.

A key typed while a conversion runs can reach the box afterwards, raw: `今日は良いka`. The next key you type takes it back out and treats it as typed, so the box becomes `今日は良いかい` on `i`. Sending the prompt right away does the same.

A reading over 500 bytes (about 166 kana) is too long for one agent command line, and converting it shows an error instead.

### Learning

anthy keeps records of the conversions and of the candidates you commit, and ranks candidates by them. The mod keeps nothing of its own.

| Agent                 | Where anthy keeps its records                                              |
| --------------------- | -------------------------------------------------------------------------- |
| `anthy-agent-unicode` | `$XDG_CONFIG_HOME/anthy`, or `~/.config/anthy` when `XDG_CONFIG_HOME` is unset |
| `anthy-agent` (9100h) | `~/.anthy` in your account's home directory, whatever `HOME` says          |

### Vim mode

In insert mode the keys work as above. Esc switches to normal mode and never reaches the mod, and normal-mode commands change the box without the mod seeing them. Back in insert mode, composing goes on where it was if the box is unchanged; if a normal-mode command changed it, the kana stays as it is and the next key starts afresh.

### The band above the prompt

While converting, the band above the prompt lists the focused segment's candidates. Another mod's band (session-brief, for example) is hidden until the conversion ends.

### What is not there

- **Esc does not commit.** Outside vim mode Esc cancels in Claude Code; in vim mode it switches to normal mode. Neither reaches a mod.
- **There is no key for the previous candidate.** ctrl+p recalls history, and up, down, ctrl+n, Tab and shift+arrows never reach a mod. Pick a candidate by its number instead.
- **Uppercase letters do not start English text.** They commit the kana and go in as typed; type English with Japanese input off.
- **No katakana or alphabet commit (vime.nvim's F7 / F10), no dictionary registration, no SKK dictionary import, no completion.**

## Troubleshooting

When a conversion fails, the mod shows the reason as a toast and leaves the kana in place:

| Toast                                                   | What to do                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `vime: anthy-agent not found: …`                        | Install an agent (see Requirements), or set `VIME_ANTHY_AGENT`, then start a new session      |
| `vime: anthy-agent exited with 1: …`                    | Run `scripts/test-agent.sh` in this repository to see how the agent fails                    |
| `vime: the reading is too long to convert at once (…)` | Convert it in shorter pieces: press Space every few words                                     |

## Uninstall

```bash
claude plugin uninstall vime@claude-vime
claude plugin marketplace remove claude-vime
```

Remove `"ctrl+j": null` from `~/.claude/keybindings.json` if you added it.

## Development

You need TypeScript 5.0 or later for `tsc`. Its settings come from `.claude-plugin/types/`, which Claude Code writes when it loads the mod from this folder, so run `claude --plugin-dir .` once after cloning (the folder is ignored by git).

```bash
claude plugin validate .claude-plugin/plugin.json   # the plugin: its manifest and its hooks module
claude plugin validate .                            # the marketplace manifest
claude plugin test .                                # hooks/*.test.ts(x) on Claude Code's own mod runtime
scripts/test-agent.sh                               # what the mod relies on in each installed agent
claude --plugin-dir .                               # try it in a session
tsc -p .                                            # type-check
```

`scripts/test-agent.sh` keeps its learning records apart from yours: anthy-unicode writes them under a temporary `XDG_CONFIG_HOME`, and anthy 9100h under a test personality in `~/.anthy`, whose files the script removes when it ends. When you try the mod in a session, the agent writes to your own records, since converting alone writes them: start the session with `XDG_CONFIG_HOME` pointing at a temporary directory to keep anthy-unicode's records apart.
