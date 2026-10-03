# claude-vime

[日本語](README.ja.md)

A [Claude Code](https://claude.com/claude-code) mod for typing Japanese in the prompt box the way [vime.nvim](https://github.com/skanehira/vime.nvim) does: you type romaji, it shows kana, and Space converts it to kanji. You never switch the OS input method.

```text
type   kyouhaiitenkidane   the box shows  きょうはいいてんきだね   (underlined)
Space                      the box shows  今日は良い天気だね       (the focused segment in bold)
                           above the box  1:今日は 2:きょうは 3:凶は … (1/17)
Enter                      the box keeps  今日は良い天気だね       (committed, not sent)
```

## Requirements

- **Claude Code 2.1.288.** This is the version the mod was tested with. Mods are early access, and their API can change between releases.
- **Neovim 0.10 or later, on `PATH` as `nvim`.** Kana-to-kanji conversion runs in `nvim --headless -l bridge/bridge.lua`, which calls libanthy through LuaJIT FFI.
- **libanthy, preferably [anthy-unicode](https://github.com/fujiwarat/anthy-unicode).** It is ABI compatible with the original anthy 9100h.
- **Hooks allowed.** A mod runs as plugin hooks, so it stays off where your settings or your organization's policy turn hooks off.

How to install libanthy (from the vime.nvim README):

| Environment     | Install                                                        |
| --------------- | -------------------------------------------------------------- |
| Fedora          | `sudo dnf install anthy-unicode`                               |
| Debian / Ubuntu | `sudo apt install libanthy-dev`                                |
| Arch (AUR)      | `anthy-unicode`                                                |
| Nix             | `nix profile install nixpkgs#anthy`                            |
| macOS           | build from source as below, or `nix profile install nixpkgs#anthy` |

Building anthy-unicode from source on macOS (installed under `~/.local`, where the mod finds it):

```sh
git clone https://github.com/fujiwarat/anthy-unicode && cd anthy-unicode
meson setup build --prefix=$HOME/.local --sysconfdir=$HOME/.local/etc -Demacs=disabled
meson compile -C build && meson install -C build
```

`--sysconfdir` must be an absolute path; with a relative one, `anthy_init` fails.

The bridge looks for the library in this order and uses the first file that exists. In each directory, `libanthy-unicode` comes before `libanthy` (`.dylib` on macOS, `.so` elsewhere).

1. `$VIME_ANTHY_LIB`
2. `~/.local/lib`
3. `~/.nix-profile/lib`
4. `/run/current-system/sw/lib`
5. `/opt/homebrew/lib`
6. `/usr/local/lib`
7. `/usr/lib`, `/usr/lib64`, `/usr/lib/x86_64-linux-gnu`, `/usr/lib/aarch64-linux-gnu`
8. `/nix/store/*-anthy*/lib`

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

| Key                    | While nothing is being composed           | While composing kana                         | While converting                               |
| ---------------------- | ----------------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| ctrl+j or `/vime`      | turns Japanese input on or off            | commits the kana, then turns it off          | commits the conversion, then turns it off      |
| `a`–`z` `,` `.` `-` `/` `[` `]` | starts composing kana              | adds to the kana                             | commits the conversion, then starts new kana   |
| Space                  | types a space                             | converts the kana                            | picks the next candidate of the focused segment |
| down or ctrl+n / up or ctrl+p | (as without the mod)               | commits the kana, then acts as usual         | picks the next / previous candidate            |
| left / right           | moves the cursor                          | commits the kana, then moves the cursor      | focuses the previous / next segment            |
| shift+left / shift+right | (as without the mod)                    | commits the kana, then acts as usual         | shortens / lengthens the focused segment       |
| Backspace              | deletes a character                       | deletes the last kana (きょ counts as one)   | goes back to the kana                          |
| Enter                  | sends the prompt                          | commits the kana (the prompt is not sent)    | commits the conversion (the prompt is not sent) |
| any other key          | (as without the mod)                      | commits the kana, then acts as usual         | commits the conversion, then acts as usual     |

Digits and `'` also go into kana that is being composed (`3ji` becomes `3じ`). A trailing `n` shows as `n` until the next key decides between ん and な-row; committing turns it into ん, and `nn` always gives ん.

A slash command's name typed at the start of the box goes in as typed, so `/vime` and other commands work while Japanese input is on; after the name and a space, romaji composes kana again.

Several characters arriving as one edit (keys typed faster than the box redraws, or a paste) are taken one at a time when they are all romaji, and otherwise commit the kana and go in as they came.

If Enter does not reach the mod in your terminal, Enter sends the prompt as usual, with the kana or the conversion committed into it.

## Behaviour to know

### Each conversion starts a process

Space, shift+left and shift+right, and committing a conversion each start `nvim --headless -l bridge/bridge.lua` once. On the machine the mod was tested on, one round trip took 70–80 ms. Keys you press while it runs are dropped, so the box does not change under the conversion. Typing kana starts no process.

### Learning

Committing a conversion has anthy learn the candidates you chose, in anthy's own records: `$XDG_CONFIG_HOME/anthy`, or `~/.config/anthy` when `XDG_CONFIG_HOME` is unset (anthy-unicode). The mod keeps nothing of its own.

### What is not there

- **Esc does not commit.** Esc cancels in Claude Code and never reaches a mod.
- **Uppercase letters do not start English text.** They commit the kana and go in as typed; type English with Japanese input off.
- **No katakana or alphabet commit (vime.nvim's F7 / F10), no dictionary registration, no SKK dictionary import, no completion.**
- **The nix anthy 9100h build (`/nix/store/*-anthy-9100h`) crashes in conversion** (exit 139) on the machine the mod was tested on. Use anthy-unicode, or point `VIME_ANTHY_LIB` at it.

## Troubleshooting

When a conversion fails, the mod shows the reason as a toast and leaves the kana in place:

| Toast                                         | What to do                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| `vime: libanthy not found`                    | Install libanthy, or set `VIME_ANTHY_LIB` to its path                      |
| `vime: the bridge exited with 1: …`           | Run `scripts/test-bridge.sh` in this repository to see the bridge's error  |

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
scripts/test-bridge.sh                              # the bridge against the real libanthy (needs nvim, jq, libanthy)
claude --plugin-dir .                               # try it in a session
tsc -p .                                            # type-check
```

`scripts/test-bridge.sh` points `XDG_CONFIG_HOME` at a temporary directory for each check, so it does not touch your anthy learning records. It leaves `HOME` alone: the bridge expands `~` when it looks for the library, and under another `HOME` it would pick a different one.
