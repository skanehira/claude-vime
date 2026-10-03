# claude-vime

[English](README.md)

[Claude Code](https://claude.com/claude-code) のプロンプト欄で、[vime.nvim](https://github.com/skanehira/vime.nvim) と同じ方法で日本語を入力する mod です。ローマ字を打つとかなが表示され、Space で漢字に変換します。OS の IME を切り替える必要はありません。

```text
入力   kyouhaiitenkidane   欄の表示  きょうはいいてんきだね   (下線付き)
Space                      欄の表示  今日は良い天気だね       (注目文節は太字)
                           欄の上    1:今日は 2:きょうは 3:凶は … (1/17)
Enter                      欄の表示  今日は良い天気だね       (確定。送信はしない)
```

## 必要環境

- **Claude Code 2.1.288。** 動作を確認したバージョンです。mod は早期アクセスで、API はリリース間で変わることがあります。
- **Neovim 0.10 以上 (`nvim` として `PATH` にあること)。** かな漢字変換は `nvim --headless -l bridge/bridge.lua` の中で動き、LuaJIT FFI で libanthy を呼びます。
- **libanthy。[anthy-unicode](https://github.com/fujiwarat/anthy-unicode) を推奨します。** 原 anthy 9100h と ABI 互換です。
- **hooks が許可されていること。** mod はプラグインの hooks として動くので、設定や組織のポリシーで hooks を止めている環境では動きません。

libanthy の導入方法 (vime.nvim の README より):

| 環境            | 導入                                                          |
| --------------- | ------------------------------------------------------------- |
| Fedora          | `sudo dnf install anthy-unicode`                              |
| Debian / Ubuntu | `sudo apt install libanthy-dev`                               |
| Arch (AUR)      | `anthy-unicode`                                               |
| Nix             | `nix profile install nixpkgs#anthy`                           |
| macOS           | 下記のソースビルド、または `nix profile install nixpkgs#anthy` |

macOS でのソースビルド (`~/.local` に入れれば mod が自動で見つけます):

```sh
git clone https://github.com/fujiwarat/anthy-unicode && cd anthy-unicode
meson setup build --prefix=$HOME/.local --sysconfdir=$HOME/.local/etc -Demacs=disabled
meson compile -C build && meson install -C build
```

`--sysconfdir` は絶対パスで指定してください。相対パスだと `anthy_init` が失敗します。

bridge は次の順にライブラリを探し、最初に存在したファイルを使います。各ディレクトリでは `libanthy-unicode` を `libanthy` より先に探します (拡張子は macOS で `.dylib`、それ以外で `.so`)。

1. `$VIME_ANTHY_LIB`
2. `~/.local/lib`
3. `~/.nix-profile/lib`
4. `/run/current-system/sw/lib`
5. `/opt/homebrew/lib`
6. `/usr/local/lib`
7. `/usr/lib`、`/usr/lib64`、`/usr/lib/x86_64-linux-gnu`、`/usr/lib/aarch64-linux-gnu`
8. `/nix/store/*-anthy*/lib`

## 導入

```text
/plugin marketplace add skanehira/claude-vime
/plugin install vime@claude-vime
/reload-plugins
```

読み込まれたかは `/vi` と打って確かめます。`/vime` が「Turn Japanese (romaji to kana and kanji) input on or off」という説明付きで候補に出れば読み込まれています。

ctrl+j で日本語入力を切り替えるには、`~/.claude/keybindings.json` で ctrl+j の既定動作 (改行) を外します:

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

## キー

日本語入力が ON の間、ステータス行に `あ` が出ます。

| キー                   | 何も入力していないとき       | かなを入力中                           | 変換中                                   |
| ---------------------- | ---------------------------- | -------------------------------------- | ---------------------------------------- |
| ctrl+j または `/vime`  | 日本語入力を ON / OFF        | かなを確定して OFF                     | 変換を確定して OFF                       |
| `a`–`z` `,` `.` `-` `/` `[` `]` | かなの入力を始める  | かなに追加                             | 変換を確定して、新しいかなの入力を始める |
| Space                  | 空白を入力                   | かなを変換                             | 注目文節の次の候補                       |
| 下 または ctrl+n / 上 または ctrl+p | (mod が無いときと同じ) | かなを確定してから通常の動作      | 次の候補 / 前の候補                      |
| 左 / 右                | カーソル移動                 | かなを確定してからカーソル移動         | 前 / 次の文節に注目を移す                |
| shift+左 / shift+右    | (mod が無いときと同じ)       | かなを確定してから通常の動作           | 注目文節を縮める / 伸ばす                |
| Backspace              | 1 文字削除                   | 最後のかなを削除 (きょ は 1 単位)      | かなに戻す                               |
| Enter                  | プロンプトを送信             | かなを確定 (送信しない)                | 変換を確定 (送信しない)                  |
| その他のキー           | (mod が無いときと同じ)       | かなを確定してから通常の動作           | 変換を確定してから通常の動作             |

数字と `'` も、入力中のかなに続けて入ります (`3ji` は `3じ`)。末尾の `n` は、次のキーで ん か な行かが決まるまで `n` のまま表示します。確定すると ん になり、`nn` は常に ん です。

欄の先頭で打つスラッシュコマンドの名前は、打ったとおりに入ります。日本語入力が ON のままでも `/vime` などのコマンドを使えます。名前の後に空白を打つと、そこからはローマ字がまたかなになります。

1 回の編集で複数の文字が届いた場合 (欄の再描画より速く打ったとき、またはペースト) は、全文字がローマ字なら 1 文字ずつ処理します。それ以外は、かなを確定してから届いたとおりに入れます。

お使いの端末で Enter が mod に届かない場合、Enter は通常どおりプロンプトを送信し、かなや変換は確定した状態で送られます。

## 知っておくべき挙動

### 変換のたびにプロセスを起動する

Space、shift+左 / shift+右、変換の確定のたびに `nvim --headless -l bridge/bridge.lua` を 1 回起動します。動作確認したマシンでは 1 往復 70〜80 ms でした。その間に押したキーは捨てるので、変換中に欄が変わることはありません。かなの入力ではプロセスを起動しません。

### 学習

変換を確定すると、選んだ候補を anthy が自分の記録に学習します。記録先は `$XDG_CONFIG_HOME/anthy` で、`XDG_CONFIG_HOME` が未設定なら `~/.config/anthy` です (anthy-unicode の場合)。mod 自体は何も保存しません。

### できないこと

- **Esc では確定しません。** Esc は Claude Code の取消キーで、mod には届きません。
- **大文字で英字入力は始まりません。** 大文字はかなを確定してからそのまま入ります。英文は日本語入力を OFF にして打ってください。
- **カタカナ確定・英字確定 (vime.nvim の F7 / F10)、辞書登録、SKK 辞書の取り込み、補完はありません。**
- **nix の anthy 9100h (`/nix/store/*-anthy-9100h`) は変換で異常終了します** (exit 139。動作確認したマシンで発生)。anthy-unicode を使うか、`VIME_ANTHY_LIB` で anthy-unicode を指定してください。

## うまくいかないとき

変換に失敗すると、理由をトーストで出し、かなはそのまま残します:

| トースト                                | 対処                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| `vime: libanthy not found`              | libanthy を導入するか、`VIME_ANTHY_LIB` にそのパスを設定する         |
| `vime: the bridge exited with 1: …`     | このリポジトリで `scripts/test-bridge.sh` を実行して bridge のエラーを見る |

## アンインストール

```bash
claude plugin uninstall vime@claude-vime
claude plugin marketplace remove claude-vime
```

`~/.claude/keybindings.json` に `"ctrl+j": null` を追加していたら削除してください。

## 開発

`tsc` には TypeScript 5.0 以上が必要です。設定は `.claude-plugin/types/` から読みます。このディレクトリは Claude Code がこのフォルダから mod を読み込むときに書き出すので、clone 後に一度 `claude --plugin-dir .` を実行してください (git の管理対象外です)。

```bash
claude plugin validate .claude-plugin/plugin.json   # プラグイン: manifest と hooks module
claude plugin validate .                            # marketplace の manifest
claude plugin test .                                # hooks/*.test.ts(x) を Claude Code 自身の mod 実行環境で走らせる
scripts/test-bridge.sh                              # 実際の libanthy で bridge を検査 (nvim・jq・libanthy が必要)
claude --plugin-dir .                               # セッションで試す
tsc -p .                                            # 型チェック
```

`scripts/test-bridge.sh` は検査ごとに `XDG_CONFIG_HOME` を一時ディレクトリへ向けるので、手元の anthy の学習記録には触れません。`HOME` は差し替えません。bridge はライブラリを探すときに `~` を展開するので、別の `HOME` では別のライブラリを拾ってしまうためです。
