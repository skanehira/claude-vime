import { describe, expect, test } from 'claude-code/testing'

import { Composer } from './editor'
import type { Answer, Edit, KeyEvent } from './editor'
import type { ConversionEngine, Resize, Segment } from './session'

type Call = readonly ['convert', string, readonly Resize[]] | readonly ['commit', string, readonly Resize[], readonly number[]]

const keyOf = (yomi: string, resizes: readonly Resize[]) => JSON.stringify([yomi, resizes])

class FakeEngine implements ConversionEngine {
  readonly calls: Call[] = []
  // While set, convert waits for it, as a bridge process still running does.
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
    { yomi: 'きょうは', candidates: ['今日は', 'きょうは'] },
    { yomi: 'いい', candidates: ['良い', 'いい'] },
  ],
  [keyOf('きょうはいい', [[0, -1]])]: [
    { yomi: 'きょう', candidates: ['今日', '京'] },
    { yomi: 'は', candidates: ['は', '葉'] },
    { yomi: 'いい', candidates: ['良い', 'いい'] },
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

  async press(key: KeyEvent) {
    if (key.key === 'backspace') {
      await this.edit({ start: this.cursor - 1, end: this.cursor, inputText: '', key })
      return
    }
    const landing = key.key === 'left' ? this.cursor - 1 : key.key === 'right' ? this.cursor + 1 : this.cursor
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

const CTRL_J: KeyEvent = { key: 'j', ctrl: true }
const RETURN: KeyEvent = { key: 'return' }
const BACKSPACE: KeyEvent = { key: 'backspace' }
const LEFT: KeyEvent = { key: 'left' }
const RIGHT: KeyEvent = { key: 'right' }
const SHIFT_LEFT: KeyEvent = { key: 'left', shift: true }

describe('Composer off', () => {
  test('typing passes through as typed', async () => {
    const box = new Box(new Composer(new FakeEngine(ANSWERS)))

    await box.type('ka')

    expect(box.shown()).toEqual({ text: 'ka', cursor: 2, decorations: [] })
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

  test('Enter commits the kana, a trailing n as ん, and keeps the box from being submitted', async () => {
    const { box } = await boxOn()
    await box.type('kan')

    const answer = await box.edit({ start: 3, end: 3, inputText: '', key: RETURN })

    expect({ kind: answer.kind, shown: box.shown() }).toEqual({ kind: 'box', shown: { text: 'かん', cursor: 2, decorations: [] } })
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
        cursor: 7,
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

    expect(box.text).toBe('きょうは良い')
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
        cursor: 5,
        decorations: [
          { start: 0, end: 3, underline: true, bold: true },
          { start: 3, end: 5, underline: true },
        ],
      },
    ])
  })

  test('shift+left shrinks the focused segment', async () => {
    const { box } = await boxOn()
    await box.type('kyouhaii')
    await box.type(' ')

    await box.press(SHIFT_LEFT)

    expect(box.shown()).toEqual({
      text: '今日は良い',
      cursor: 5,
      decorations: [
        { start: 0, end: 2, underline: true, bold: true },
        { start: 2, end: 3, underline: true },
        { start: 3, end: 5, underline: true },
      ],
    })
  })

  test('Enter commits the conversion, the engine learning the choices', async () => {
    const { box, engine } = await boxOn()
    await box.type('kyouhaii')
    await box.type(' ')
    await box.press(RIGHT)
    await box.type(' ')

    await box.press(RETURN)

    expect({ shown: box.shown(), learned: engine.calls.at(-1) }).toEqual({
      shown: { text: '今日はいい', cursor: 5, decorations: [] },
      learned: ['commit', 'きょうはいい', [], [0, 1]],
    })
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
