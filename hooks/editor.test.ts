import { describe, expect, test } from 'claude-code/testing'

import { Composer } from './editor'
import type { Answer, Edit, KeyEvent } from './editor'
import type { ConversionEngine, Resize, Segment } from './session'

type Call = readonly ['convert', string, readonly Resize[]] | readonly ['commit', string, readonly Resize[], readonly number[]]

const keyOf = (yomi: string, resizes: readonly Resize[]) => JSON.stringify([yomi, resizes])

class FakeEngine implements ConversionEngine {
  readonly calls: Call[] = []
  // While set, convert waits for it, as an anthy-agent process still running does.
  gate: Promise<void> | undefined

  constructor(private readonly answers: Readonly<Record<string, readonly Segment[]>>) {}

  async convert(yomi: string, resizes: readonly Resize[]): Promise<readonly Segment[]> {
    this.calls.push(['convert', yomi, resizes])
    if (this.gate !== undefined) await this.gate
    const answer = this.answers[keyOf(yomi, resizes)]
    if (answer === undefined) throw new Error(`no answer for ${keyOf(yomi, resizes)}`)
    return answer
  }

  async commit(yomi: string, resizes: readonly Resize[], choices: readonly number[]): Promise<void> {
    this.calls.push(['commit', yomi, resizes, choices])
  }
}

const ANSWERS = {
  [keyOf('きょうはいい', [])]: [
    { candidates: ['今日は', 'きょうは'] },
    { candidates: ['良い', 'いい'] },
  ],
  [keyOf('きょうはいい', [[0, -1]])]: [
    { candidates: ['今日', '京'] },
    { candidates: ['は', '葉'] },
    { candidates: ['良い', 'いい'] },
  ],
}

// The prompt box as the editor holds it: each edit goes through the composer,
// and an edit it passes is spliced in as the engine's own editor does.
class Box {
  text: string
  cursor: number
  decorations: unknown[] = []

  constructor(
    readonly composer: Composer,
    text = '',
  ) {
    this.text = text
    this.cursor = text.length
  }

  async edit(edit: Omit<Edit, 'text' | 'cursor'>): Promise<Answer> {
    const answer = await this.composer.edit({ ...edit, text: this.text, cursor: this.cursor })
    this.apply(answer, { ...edit, text: this.text, cursor: this.cursor })
    return answer
  }

  apply(answer: Answer, edit: Edit) {
    if (answer.kind === 'box') {
      this.text = answer.box.text
      this.cursor = answer.box.cursor
      this.decorations = answer.box.decorations
      return
    }
    const e = answer.edit ?? edit
    this.text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    this.cursor = e.start + e.inputText.length
    this.decorations = []
  }

  async type(chars: string) {
    for (const ch of chars) await this.edit({ start: this.cursor, end: this.cursor, inputText: ch, key: { key: ch } })
  }

  /** A burst of keys or a paste: one edit carrying several characters and no key. */
  async insert(text: string) {
    await this.edit({ start: this.cursor, end: this.cursor, inputText: text })
  }

  async press(key: KeyEvent) {
    if (key.key === 'backspace') {
      await this.edit({ start: this.cursor - 1, end: this.cursor, inputText: '', key })
      return
    }
    const isBack = key.key === 'left' || (key.ctrl === true && key.key === 'b')
    const isForward = key.key === 'right' || (key.ctrl === true && key.key === 'f')
    // ctrl+a and ctrl+e move to the start and the end of the (one-line) box.
    const isLineStart = key.ctrl === true && key.key === 'a'
    const isLineEnd = key.ctrl === true && key.key === 'e'
    const landing = isLineStart ? 0 : isLineEnd ? this.text.length : isBack ? this.cursor - 1 : isForward ? this.cursor + 1 : this.cursor
    await this.edit({ start: landing, end: landing, inputText: '', key })
  }

  shown() {
    return { text: this.text, cursor: this.cursor, decorations: this.decorations }
  }
}

async function boxOn(text = '', engine = new FakeEngine(ANSWERS)) {
  const composer = new Composer(engine)
  await composer.toggle()
  return { box: new Box(composer, text), engine, composer }
}

// As observed: ctrl+j (unbound from chat:newline) puts in a newline and arrives as `enter` through
// tmux, as `j` with ctrl in a terminal that reports modifiers; a plain Enter never reaches
// prompt.edit (it submits).
const CTRL_J: KeyEvent = { key: 'enter' }
const CTRL_J_REPORTED: KeyEvent = { key: 'j', ctrl: true }
const OPTION_RETURN: KeyEvent = { key: 'return', meta: true }
const BACKSPACE: KeyEvent = { key: 'backspace' }
const LEFT: KeyEvent = { key: 'left' }
const RIGHT: KeyEvent = { key: 'right' }
const OPTION_LEFT: KeyEvent = { key: 'left', meta: true }
const OPTION_RIGHT: KeyEvent = { key: 'right', meta: true }
const CTRL_F: KeyEvent = { key: 'f', ctrl: true }
const CTRL_B: KeyEvent = { key: 'b', ctrl: true }
const CTRL_A: KeyEvent = { key: 'a', ctrl: true }
const CTRL_E: KeyEvent = { key: 'e', ctrl: true }
const CTRL_Y: KeyEvent = { key: 'y', ctrl: true }

describe('Composer off', () => {
  test('typing passes through as typed', async () => {
    const box = new Box(new Composer(new FakeEngine(ANSWERS)))

    await box.type('ka')

    expect(box.shown()).toEqual({ text: 'ka', cursor: 2, decorations: [] })
  })

  test('ctrl+j reported as j with ctrl turns it on and off without putting in a newline', async () => {
    const box = new Box(new Composer(new FakeEngine(ANSWERS)), 'x')

    await box.edit({ start: 1, end: 1, inputText: '\n', key: CTRL_J_REPORTED })
    const isOnAfterFirst = box.composer.isOn
    await box.type('ka')
    await box.edit({ start: 2, end: 2, inputText: '\n', key: CTRL_J_REPORTED })
    await box.type('b')

    expect({ isOnAfterFirst, isOn: box.composer.isOn, shown: box.shown() }).toEqual({
      isOnAfterFirst: true,
      isOn: false,
      shown: { text: 'xかb', cursor: 3, decorations: [] },
    })
  })

  test('ctrl+j turns it on without changing the box, and typing then composes kana', async () => {
    const box = new Box(new Composer(new FakeEngine(ANSWERS)), 'x')

    await box.edit({ start: 1, end: 1, inputText: '\n', key: CTRL_J })
    const afterToggle = box.shown()
    await box.type('ka')

    expect([afterToggle, box.shown(), box.composer.isOn]).toEqual([
      { text: 'x', cursor: 1, decorations: [] },
      { text: 'xか', cursor: 2, decorations: [{ start: 1, end: 2, underline: true }] },
      true,
    ])
  })
})

describe('Composer composing', () => {
  test('typed romaji shows as underlined kana where it was typed, the text around it kept', async () => {
    const { box } = await boxOn('ab')
    box.cursor = 1

    await box.type('kyou')

    expect(box.shown()).toEqual({ text: 'aきょうb', cursor: 4, decorations: [{ start: 1, end: 4, underline: true }] })
  })

  test('Backspace removes the last kana of the run', async () => {
    const { box } = await boxOn()
    await box.type('kaki')

    await box.press(BACKSPACE)

    expect(box.shown()).toEqual({ text: 'か', cursor: 1, decorations: [{ start: 0, end: 1, underline: true }] })
  })

  test('Backspace with no run left passes through and deletes the character before the cursor', async () => {
    const { box } = await boxOn('ab')

    await box.press(BACKSPACE)

    expect(box.shown()).toEqual({ text: 'a', cursor: 1, decorations: [] })
  })

  test('option+Enter commits the kana, a trailing n as ん, then puts in its newline', async () => {
    const { box } = await boxOn()
    await box.type('kan')

    await box.edit({ start: 2, end: 2, inputText: '\n', key: OPTION_RETURN })

    expect(box.shown()).toEqual({ text: 'かん\n', cursor: 3, decorations: [] })
  })

  test('a character that cannot continue the run commits it, a trailing n as ん, then goes in after it', async () => {
    const { box } = await boxOn()
    await box.type('kan')

    await box.type('A')

    expect(box.shown()).toEqual({ text: 'かんA', cursor: 3, decorations: [] })
  })

  test('a character that cannot start a run passes through', async () => {
    const { box } = await boxOn()

    await box.type('A1 ')

    expect(box.shown()).toEqual({ text: 'A1 ', cursor: 3, decorations: [] })
  })

  test('a box changed under the run (sent or cleared) starts the next run afresh', async () => {
    const { box } = await boxOn()
    await box.type('ka')
    box.text = ''
    box.cursor = 0

    await box.type('ki')

    expect(box.shown()).toEqual({ text: 'き', cursor: 1, decorations: [{ start: 0, end: 1, underline: true }] })
  })

  test('a burst of romaji arriving as one edit is taken a character at a time', async () => {
    const { box } = await boxOn()
    await box.type('k')

    await box.insert('youha')

    expect(box.shown()).toEqual({ text: 'きょうは', cursor: 4, decorations: [{ start: 0, end: 4, underline: true }] })
  })

  test('a burst of romaji into an empty run starts one', async () => {
    const { box } = await boxOn('x')

    await box.insert('kana')

    expect(box.shown()).toEqual({ text: 'xかな', cursor: 3, decorations: [{ start: 1, end: 3, underline: true }] })
  })

  test('a paste that is not all romaji commits the run and goes in as pasted', async () => {
    const { box } = await boxOn()
    await box.type('kan')

    await box.insert('Hello world')

    expect(box.shown()).toEqual({ text: 'かんHello world', cursor: 13, decorations: [] })
  })

  test('a slash command typed at the start of the box goes in as typed, and its arguments compose kana', async () => {
    const { box } = await boxOn()

    await box.type('/vime')
    const command = box.shown()
    await box.type(' ka')

    expect([command, box.shown()]).toEqual([
      { text: '/vime', cursor: 5, decorations: [] },
      { text: '/vime か', cursor: 7, decorations: [{ start: 6, end: 7, underline: true }] },
    ])
  })

  test('Backspace away from the end of the run commits it and deletes as usual', async () => {
    const { box } = await boxOn('ab')
    box.cursor = 1
    await box.type('kan')

    await box.edit({ start: 0, end: 1, inputText: '', key: BACKSPACE })

    expect(box.shown()).toEqual({ text: 'かんb', cursor: 0, decorations: [] })
  })

  test('sending the prompt while composing commits the run into what is sent', async () => {
    const { box, composer } = await boxOn('> ')
    await box.type('kan')

    const sent = await composer.commitForSubmit(box.text)

    expect(sent).toBe('> かん')
  })

  test('sending a prompt that no longer holds the run sends it as it is', async () => {
    const { box, composer } = await boxOn()
    await box.type('kan')

    const sent = await composer.commitForSubmit('something else')

    expect(sent).toBe('something else')
  })

  test('ctrl+y yanks killed romaji as it was, not as typed kana', async () => {
    const { box } = await boxOn('ab')

    const answer = await box.edit({ start: 2, end: 2, inputText: 'cd', key: CTRL_Y })

    expect({ answer, text: box.text }).toEqual({ answer: { kind: 'pass' }, text: 'abcd' })
  })

  test('ctrl+j turns it off, committing the kana as it stands', async () => {
    const { box } = await boxOn()
    await box.type('kan')

    await box.edit({ start: 3, end: 3, inputText: '\n', key: CTRL_J })
    await box.type('a')

    expect({ shown: box.shown(), isOn: box.composer.isOn }).toEqual({
      shown: { text: 'かんa', cursor: 3, decorations: [] },
      isOn: false,
    })
  })
})

describe('Composer converting', () => {
  test('Space converts the run, each segment underlined and the focused one bold', async () => {
    const { box, composer } = await boxOn('> ')
    await box.type('kyouhaii')

    await box.type(' ')

    expect({ shown: box.shown(), candidates: composer.candidates() }).toEqual({
      shown: {
        text: '> 今日は良い',
        cursor: 5,
        decorations: [
          { start: 2, end: 5, underline: true, bold: true },
          { start: 5, end: 7, underline: true },
        ],
      },
      candidates: { list: ['今日は', 'きょうは'], index: 0 },
    })
  })

  test('Space again picks the next candidate of the focused segment', async () => {
    const { box } = await boxOn()
    await box.type('kyouhaii')
    await box.type(' ')

    await box.type(' ')

    expect(box.shown()).toEqual({
      text: 'きょうは良い',
      cursor: 4,
      decorations: [
        { start: 0, end: 4, underline: true, bold: true },
        { start: 4, end: 6, underline: true },
      ],
    })
  })

  test('right and left move the focus between segments', async () => {
    const { box } = await boxOn()
    await box.type('kyouhaii')
    await box.type(' ')

    await box.press(RIGHT)
    await box.type(' ')
    const onSecond = box.shown()
    await box.press(LEFT)

    expect([onSecond, box.shown()]).toEqual([
      {
        text: '今日はいい',
        cursor: 5,
        decorations: [
          { start: 0, end: 3, underline: true },
          { start: 3, end: 5, underline: true, bold: true },
        ],
      },
      {
        text: '今日はいい',
        cursor: 3,
        decorations: [
          { start: 0, end: 3, underline: true, bold: true },
          { start: 3, end: 5, underline: true },
        ],
      },
    ])
  })

  test('ctrl+f and ctrl+b move the focus between segments, as in vime.nvim', async () => {
    const { box, composer } = await boxOn()
    await box.type('kyouhaii')
    await box.type(' ')

    await box.press(CTRL_F)
    await box.type(' ')
    const onSecond = box.text
    await box.press(CTRL_B)
    await box.type(' ')

    expect({ onSecond, text: box.text, candidates: composer.candidates() }).toEqual({
      onSecond: '今日はいい',
      text: 'きょうはいい',
      candidates: { list: ['今日は', 'きょうは'], index: 1 },
    })
  })

  test('ctrl+a shortens and ctrl+e lengthens the focused segment', async () => {
    const { box, engine } = await boxOn()
    await box.type('kyouhaii')
    await box.type(' ')

    await box.press(CTRL_A)
    const shortened = box.shown()
    await box.press(CTRL_E)

    expect({ shortened, text: box.text, converted: engine.calls.slice(1) }).toEqual({
      shortened: {
        text: '今日は良い',
        cursor: 2,
        decorations: [
          { start: 0, end: 2, underline: true, bold: true },
          { start: 2, end: 3, underline: true },
          { start: 3, end: 5, underline: true },
        ],
      },
      text: '今日は良い',
      converted: [
        ['convert', 'きょうはいい', [[0, -1]]],
        ['convert', 'きょうはいい', [[0, -1], [0, 1]]],
      ],
    })
  })

  test('option+left shrinks the focused segment', async () => {
    const { box } = await boxOn()
    await box.type('kyouhaii')
    await box.type(' ')

    await box.press(OPTION_LEFT)

    expect(box.shown()).toEqual({
      text: '今日は良い',
      cursor: 2,
      decorations: [
        { start: 0, end: 2, underline: true, bold: true },
        { start: 2, end: 3, underline: true },
        { start: 3, end: 5, underline: true },
      ],
    })
  })

  test('option+right lengthens the focused segment', async () => {
    const answers = { ...ANSWERS, [keyOf('きょうはいい', [[0, -1], [0, 1]])]: ANSWERS[keyOf('きょうはいい', [])]! }
    const { box, engine } = await boxOn('', new FakeEngine(answers))
    await box.type('kyouhaii')
    await box.type(' ')
    await box.press(OPTION_LEFT)

    await box.press(OPTION_RIGHT)

    expect({ text: box.text, convert: engine.calls.at(-1) }).toEqual({
      text: '今日は良い',
      convert: ['convert', 'きょうはいい', [[0, -1], [0, 1]]],
    })
  })

  test('a number picks that candidate of the band, Space the next one', async () => {
    const answers = { [keyOf('かん', [])]: [{ candidates: ['缶', '感', '管'] }] }
    const { box, composer } = await boxOn('', new FakeEngine(answers))
    await box.type('kan')
    await box.type(' ')

    const indices: (number | undefined)[] = []
    for (const key of ['3', ' ', '2', '9']) {
      await box.type(key)
      indices.push(composer.candidates()?.index)
    }

    expect({ indices, text: box.text }).toEqual({ indices: [2, 0, 1, 1], text: '感' })
  })

  test('any other key commits the conversion, then goes in as usual', async () => {
    const { box, engine } = await boxOn()
    await box.type('kyouhaii')
    await box.type(' ')

    await box.type('A')

    expect({ shown: box.shown(), learned: engine.calls.at(-1) }).toEqual({
      shown: { text: '今日は良いA', cursor: 6, decorations: [] },
      learned: ['commit', 'きょうはいい', [], [0, 0]],
    })
  })

  test('a conversion the engine fails keeps the kana underlined and answers the error', async () => {
    const { box } = await boxOn()
    await box.type('kyou')

    const answer = await box.edit({ start: 3, end: 3, inputText: ' ', key: { key: ' ' } })

    expect(answer).toEqual({
      kind: 'box',
      box: { text: 'きょう', cursor: 3, decorations: [{ start: 0, end: 3, underline: true }] },
      error: 'no answer for ["きょう",[]]',
    })
  })

  test('sending the prompt while converting sends the conversion, the engine learning the choices', async () => {
    const { box, engine, composer } = await boxOn()
    await box.type('kyouhaii')
    await box.type(' ')
    await box.press(RIGHT)
    await box.type(' ')

    const sent = await composer.commitForSubmit(box.text)

    expect({ sent, learned: engine.calls.at(-1) }).toEqual({
      sent: '今日はいい',
      learned: ['commit', 'きょうはいい', [], [0, 1]],
    })
  })

  // As observed in a terminal: keys typed while a conversion ran reach prompt.edit afterwards as one
  // edit on the engine's own guess of the box (Space put in); the engine then puts them in raw at
  // the end of the box it shows, whatever the hook answers.
  async function typedWhileConverting(box: Box, keys: string) {
    const guessed: Edit = { text: box.text, cursor: box.cursor, start: box.cursor, end: box.cursor, inputText: ' ' }
    const answer = await box.composer.edit(guessed)
    box.apply(answer, guessed)
    const queued: Edit = { text: guessed.text + ' ', cursor: guessed.cursor + 1, start: guessed.cursor + 1, end: guessed.cursor + 1, inputText: keys }
    const ignored = await box.composer.edit(queued)
    box.text = box.text + keys
    box.cursor = box.text.length
    box.decorations = []
    return ignored
  }

  test('keys typed while a conversion ran, which the engine puts in raw, pass through and are taken as typed on the next key', async () => {
    const { box, engine } = await boxOn()
    await box.type('kyouhaii')

    const ignored = await typedWhileConverting(box, 'ka')
    const raw = box.text
    await box.type('i')

    expect({ ignored, raw, shown: box.shown(), learned: engine.calls.at(-1) }).toEqual({
      ignored: { kind: 'pass' },
      raw: '今日は良いka',
      shown: { text: '今日は良いかい', cursor: 7, decorations: [{ start: 5, end: 7, underline: true }] },
      learned: ['commit', 'きょうはいい', [], [0, 0]],
    })
  })

  test('a key that cannot continue the run, after raw keys, answers the whole box with the raw keys taken as typed', async () => {
    const { box } = await boxOn()
    await box.type('kyouhaii')
    await typedWhileConverting(box, 'ka')

    await box.type('A')

    expect(box.shown()).toEqual({ text: '今日は良いかA', cursor: 7, decorations: [] })
  })

  test('keys typed while a conversion ran are taken as typed when the prompt is sent next', async () => {
    const { box, composer } = await boxOn()
    await box.type('kyouhaii')
    await typedWhileConverting(box, 'ka')

    const sent = await composer.commitForSubmit(box.text)

    expect(sent).toBe('今日は良いか')
  })

  test('with the focus on the first segment, typing commits the conversion and starts the next run after all of it', async () => {
    const { box } = await boxOn('', new FakeEngine(ANSWERS))
    await box.type('kyouhaii')
    await box.type(' ')

    await box.type('k')

    expect(box.shown()).toEqual({ text: '今日は良いk', cursor: 6, decorations: [{ start: 5, end: 6, underline: true }] })
  })

  test('typing commits the conversion and starts the next run after it', async () => {
    const { box } = await boxOn()
    await box.type('kyouhaii')
    await box.type(' ')

    await box.type('ka')

    expect(box.shown()).toEqual({ text: '今日は良いか', cursor: 6, decorations: [{ start: 5, end: 6, underline: true }] })
  })

  test('Backspace goes back to the kana', async () => {
    const { box } = await boxOn()
    await box.type('kyouhaii')
    await box.type(' ')

    await box.press(BACKSPACE)

    expect(box.shown()).toEqual({ text: 'きょうはいい', cursor: 6, decorations: [{ start: 0, end: 6, underline: true }] })
  })

  test('edits arriving while a conversion runs are consumed and leave the box as it was', async () => {
    const engine = new FakeEngine(ANSWERS)
    const { box } = await boxOn('', engine)
    await box.type('kyouhaii')
    let open = () => {}
    engine.gate = new Promise(resolve => {
      open = resolve
    })

    const converting = box.type(' ')
    const during = await box.composer.edit({ text: box.text, cursor: box.cursor, start: 6, end: 6, inputText: 'x', key: { key: 'x' } })
    open()
    await converting

    expect({ during, shown: box.text }).toEqual({
      during: { kind: 'box', box: { text: 'きょうはいい', cursor: 6, decorations: [{ start: 0, end: 6, underline: true }] } },
      shown: '今日は良い',
    })
  })
})
