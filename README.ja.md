# claude-vime

[English](README.md)

[Claude Code](https://claude.com/claude-code) のプロンプト欄で、[vime.nvim](https://github.com/skanehira/vime.nvim) と同じ方法で日本語を入力する mod です。ローマ字を打つとかなが表示され、Space で漢字に変換します。OS の IME を切り替える必要はありません。

```text
入力          kyouhaiitenkidane   欄の表示  きょうはいいてんきだね   (下線付き)
Space                             欄の表示  今日配位天気だね         (注目文節「今日」は太字)
                                  欄の上    1:今日 2:きょう 3:凶 … (1/165)
option+右                         欄の表示  今日は良い天気だね       (注目文節を「今日は」に伸ばした)
ctrl+j                            欄の表示  今日は良い天気だね       (確定して日本語入力 OFF)
```

候補は anthy のバージョンと学習の状態によって変わります。

## 必要環境

- **Claude Code 2.1.288。** 動作を確認したバージョンです。mod は早期アクセスで、API はリリース間で変わることがあります。
- **anthy のコマンドライン agent。** [anthy-unicode](https://github.com/fujiwarat/anthy-unicode) の `anthy-agent-unicode`、または原 anthy 9100h の `anthy-agent` です。mod は変換のたびにこれを egg モードで動かします。
- **hooks が許可されていること。** mod はプラグインの hooks として動くので、設定や組織のポリシーで hooks を止めている環境では動きません。

動作を確認したのは、nixpkgs の `anthy` (9100h) の `anthy-agent` と、anthy-unicode をソースビルドした `anthy-agent-unicode` です。どちらも macOS で確認しました。各ディストリビューションの anthy パッケージにもどちらかが含まれているはずですが、確認はしていません。

| 入手先                 | 方法                                                                              |
| ---------------------- | --------------------------------------------------------------------------------- |
| Nix                    | `nix profile install nixpkgs#anthy`、または構成に `pkgs.anthy` (anthy-agent)       |
| ソースビルド (macOS も可) | 下記のとおり anthy-unicode をビルド (anthy-agent-unicode)                         |

```sh
git clone https://github.com/fujiwarat/anthy-unicode && cd anthy-unicode
meson setup build --prefix=$HOME/.local --sysconfdir=$HOME/.local/etc -Demacs=disabled
meson compile -C build && meson install -C build
```

`--sysconfdir` は絶対パスで指定してください。相対パスだと anthy が起動に失敗します。Claude Code を起動するときの `PATH` に `~/.local/bin` を含めてください。

mod はセッション開始時に、次の順で agent を探します。それぞれ `--version` で動くかを確かめます。

1. `$VIME_ANTHY_AGENT` (設定されていればこれだけ。コマンド名でもパスでもよい)
2. `PATH` 上の `anthy-agent-unicode`
3. `PATH` 上の `anthy-agent`

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

| キー                            | 何も入力していないとき | かなを入力中                            | 変換中                                     |
| ------------------------------- | ---------------------- | --------------------------------------- | ------------------------------------------ |
| ctrl+j または `/vime`           | 日本語入力を ON / OFF  | かなを確定して OFF                      | 変換を確定して OFF                         |
| `a`–`z` `,` `.` `-` `/` `[` `]` | かなの入力を始める     | かなに追加                              | 変換を確定し、その後ろで新しいかなを始める |
| Space                           | 空白を入力             | かなを変換                              | 注目文節の次の候補                         |
| `1`–`9`                         | 数字を入力             | かなに数字を追加 (`3ji` → `3じ`)        | 帯でその番号の候補を選ぶ                   |
| 左 / 右、ctrl+b / ctrl+f        | カーソル移動           | かなを確定してからカーソル移動          | 前 / 次の文節に注目を移す                  |
| option+左 / option+右           | (mod が無いときと同じ) | かなを確定してから通常の動作            | 注目文節を縮める / 伸ばす                  |
| Backspace                       | 1 文字削除             | 最後のかなを削除 (きょ は 1 単位)       | かなに戻す                                 |
| Enter                           | プロンプトを送信       | かなを確定して送信                      | 変換を確定して送信                         |
| その他のキー                    | (mod が無いときと同じ) | かなを確定してから通常の動作            | 変換を確定し、その後ろに入れる             |

ctrl+左 / ctrl+右 でも文節を縮める / 伸ばすことができます。ただし端末がそのキーを渡す場合に限ります (macOS は既定でデスクトップの切り替えに使います)。

末尾の `n` は、次のキーで ん か な行かが決まるまで `n` のまま表示します。確定すると ん になり、`nn` は常に ん です。`'` も入力中のかなに続けて入ります。

変換中は、カーソルを注目文節の末尾に置きます。左右どちらにも動ける余地を残すためです。欄の端でカーソルが動けない矢印キーは、mod まで届きません。

欄の先頭で打つスラッシュコマンドの名前は、打ったとおりに入ります。日本語入力が ON のままでも `/vime` などのコマンドを使えます。名前の後に空白を打つと、そこからはローマ字がまたかなになります。

1 回の編集で複数の文字が届いた場合 (ペースト、または Claude Code がまとめて渡したキー) は、全文字がローマ字なら 1 文字ずつ処理します。それ以外は、かなを確定してから届いたとおりに入れます。

## 知っておくべき挙動

### 変換のたびに agent を起動する

かな入力中の Space と、option+左 / option+右 では、agent を 1 回動かして結果を待ちます。動作確認したマシンでは約 10 ms でした。変換を確定したときも、選んだ候補を anthy に学習させるために agent をもう 1 回動かします。ただしこれはキーへの応答を返した後に行うので、打鍵が待たされることはありません。かなの入力では何も起動しません。

変換の処理中に打ったキーは、処理が終わってから生のまま欄に入ることがあります (`今日は良いka`)。次のキーを打つと、それを取り出して打ったものとして処理し直します。`i` を打てば欄は `今日は良いかい` になります。すぐにプロンプトを送信した場合も同じように処理します。

読みが 500 バイト (かなでおよそ 166 文字) を超えると、agent のコマンド 1 行に収まりません。その場合は変換せずにエラーを出します。

### 学習

anthy は、変換の記録と確定した候補の記録を残し、候補の順位に使います。mod 自体は何も保存しません。

| agent                 | anthy の記録先                                                              |
| --------------------- | --------------------------------------------------------------------------- |
| `anthy-agent-unicode` | `$XDG_CONFIG_HOME/anthy` (`XDG_CONFIG_HOME` が未設定なら `~/.config/anthy`) |
| `anthy-agent` (9100h) | アカウントのホームディレクトリの `~/.anthy` (`HOME` の値によらない)         |

### vim モード

挿入モードでは、上記のとおりにキーが働きます。Esc はノーマルモードへの切り替えに使われ、mod には届きません。ノーマルモードのコマンドは、mod を通らずに欄を変えます。挿入モードに戻ったとき、欄が変わっていなければかなの入力はそのまま続きます。ノーマルモードで欄を変えた場合は、かなはそのまま残り、次のキーから入力し直しになります。

### 欄の上の帯

変換中は、欄の上の帯に注目文節の候補を出します。その間、他の mod の帯 (session-brief など) は隠れます。

### できないこと

- **Esc では確定しません。** vim モード以外では Esc は Claude Code の取消キーで、vim モードではノーマルモードへの切り替えです。どちらも mod には届きません。
- **前の候補に戻すキーはありません。** ctrl+p は履歴の呼び出しになり、上・下・ctrl+n・Tab・shift+矢印は mod に届きません。番号で候補を選んでください。
- **大文字で英字入力は始まりません。** 大文字はかなを確定してからそのまま入ります。英文は日本語入力を OFF にして打ってください。
- **カタカナ確定・英字確定 (vime.nvim の F7 / F10)、辞書登録、SKK 辞書の取り込み、補完はありません。**

## うまくいかないとき

変換に失敗すると、理由をトーストで出し、かなはそのまま残します:

| トースト                                                | 対処                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `vime: anthy-agent not found: …`                        | agent を導入する (必要環境を参照) か `VIME_ANTHY_AGENT` を設定し、セッションを開き直す |
| `vime: anthy-agent exited with 1: …`                    | このリポジトリで `scripts/test-agent.sh` を実行し、agent の失敗のしかたを見る       |
| `vime: the reading is too long to convert at once (…)` | 数語ごとに Space を押して、短く区切って変換する                                     |

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
scripts/test-agent.sh                               # 導入済みの各 agent について mod が頼る挙動を確かめる
claude --plugin-dir .                               # セッションで試す
tsc -p .                                            # 型チェック
```

`scripts/test-agent.sh` は、学習の記録を手元の記録と分けて書きます。anthy-unicode は一時的な `XDG_CONFIG_HOME` の下に、anthy 9100h は `~/.anthy` の試験用 personality に書き、後者のファイルは終了時に削除します。セッションで試す場合は、変換するだけで agent が手元の記録に書き込みます。anthy-unicode の記録を分けたいときは、`XDG_CONFIG_HOME` を一時ディレクトリに向けてセッションを起動してください。
