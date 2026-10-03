import { describe, expect, test } from 'claude-code/testing'

import { Session } from './session'
import type { ConversionEngine, Resize, Segment } from './session'

type Call = readonly ['convert', string, readonly Resize[]] | readonly ['commit', string, readonly Resize[], readonly number[]]

// Answers convert from a table keyed by the reading and the resizes so far, and keeps every call.
class FakeEngine implements ConversionEngine {
  readonly calls: Call[] = []

  constructor(private readonly answers: Readonly<Record<string, readonly Segment[]>>) {}

  async convert(yomi: string, resizes: readonly Resize[]): Promise<readonly Segment[]> {
    this.calls.push(['convert', yomi, resizes])
    const answer = this.answers[keyOf(yomi, resizes)]
    if (answer === undefined) throw new Error(`no answer for ${keyOf(yomi, resizes)}`)
    return answer
  }

  async commit(yomi: string, resizes: readonly Resize[], choices: readonly number[]): Promise<void> {
    this.calls.push(['commit', yomi, resizes, choices])
  }
}

const keyOf = (yomi: string, resizes: readonly Resize[]) => JSON.stringify([yomi, resizes])

const KYOUHAII: readonly Segment[] = [
  { candidates: ['今日は', 'きょうは', '京は'] },
  { candidates: ['良い', 'いい'] },
]
const KYOU_HA_II: readonly Segment[] = [
  { candidates: ['今日', '京'] },
  { candidates: ['は', '葉'] },
  { candidates: ['良い', 'いい'] },
]

const ANSWERS = {
  [keyOf('きょうはいい', [])]: KYOUHAII,
  [keyOf('きょうはいい', [[0, -1]])]: KYOU_HA_II,
  [keyOf('きょうはいい', [[0, -1], [0, 1]])]: KYOUHAII,
  [keyOf('かん', [])]: [{ candidates: ['缶', '感'] }],
}

async function typed(romaji: string, engine = new FakeEngine(ANSWERS)) {
  const session = new Session(engine)
  for (const ch of romaji) await session.input(ch)
  return { session, engine }
}

describe('Session while composing', () => {
  test('typing romaji shows hiragana in the preedit, a trailing n held as n', async () => {
    const { session } = await typed('kyouhan')

    expect(session.preedit()).toEqual({ kind: 'composing', text: 'きょうはn' })
  })

  test('Backspace removes the last kana, a youon such as きょ as one unit', async () => {
    const { session } = await typed('kyou')

    session.backspace()
    const afterOne = session.preedit()
    session.backspace()

    expect([afterOne, session.preedit()]).toEqual([
      { kind: 'composing', text: 'きょ' },
      { kind: 'composing', text: '' },
    ])
  })

  test('commit answers the kana as typed, a trailing n as ん, without the engine, and empties the preedit', async () => {
    const { session, engine } = await typed('kan')

    const committed = await session.commit()

    expect({ committed, preedit: session.preedit(), calls: engine.calls }).toEqual({
      committed: 'かん',
      preedit: { kind: 'composing', text: '' },
      calls: [],
    })
  })

  test('cancel empties the preedit', async () => {
    const { session } = await typed('kyou')

    session.cancel()

    expect(session.preedit()).toEqual({ kind: 'composing', text: '' })
  })

  test('starting a conversion with nothing typed asks the engine nothing', async () => {
    const { session, engine } = await typed('')

    await session.startConversion()

    expect({ preedit: session.preedit(), calls: engine.calls }).toEqual({
      preedit: { kind: 'composing', text: '' },
      calls: [],
    })
  })
})

describe('Session while converting', () => {
  test('starting a conversion converts the whole reading, the trailing n as ん, and shows each segment by its first candidate', async () => {
    const { session, engine } = await typed('kan')

    await session.startConversion()

    expect({ preedit: session.preedit(), candidates: session.candidates(), calls: engine.calls }).toEqual({
      preedit: { kind: 'converting', before: '', segments: ['缶'], current: 0, after: '' },
      candidates: { list: ['缶', '感'], index: 0 },
      calls: [['convert', 'かん', []]],
    })
  })

  test('the next and previous candidate move within the focused segment and wrap around', async () => {
    const { session } = await typed('kyouhaii')
    await session.startConversion()

    session.nextCandidate()
    const second = session.candidates()
    session.nextCandidate()
    session.nextCandidate()
    const wrappedForward = session.candidates()
    session.prevCandidate()
    const wrappedBack = session.candidates()

    expect([second, wrappedForward, wrappedBack, session.preedit()]).toEqual([
      { list: ['今日は', 'きょうは', '京は'], index: 1 },
      { list: ['今日は', 'きょうは', '京は'], index: 0 },
      { list: ['今日は', 'きょうは', '京は'], index: 2 },
      { kind: 'converting', before: '', segments: ['京は', '良い'], current: 0, after: '' },
    ])
  })

  test('select picks a candidate of the focused segment by its index', async () => {
    const { session } = await typed('kyouhaii')
    await session.startConversion()

    session.select(2)

    expect({ preedit: session.preedit(), candidates: session.candidates() }).toEqual({
      preedit: { kind: 'converting', before: '', segments: ['京は', '良い'], current: 0, after: '' },
      candidates: { list: ['今日は', 'きょうは', '京は'], index: 2 },
    })
  })

    test('the next and previous segment move the focus and stop at both ends', async () => {
    const { session } = await typed('kyouhaii')
    await session.startConversion()

    session.nextSegment()
    session.nextSegment()
    const atEnd = session.preedit()
    session.nextCandidate()
    const secondChanged = session.preedit()
    session.prevSegment()
    session.prevSegment()

    expect([atEnd, secondChanged, session.preedit()]).toEqual([
      { kind: 'converting', before: '', segments: ['今日は', '良い'], current: 1, after: '' },
      { kind: 'converting', before: '', segments: ['今日は', 'いい'], current: 1, after: '' },
      { kind: 'converting', before: '', segments: ['今日は', 'いい'], current: 0, after: '' },
    ])
  })

  test('shrinking and expanding replay every resize so far and start each segment at its first candidate', async () => {
    const { session, engine } = await typed('kyouhaii')
    await session.startConversion()
    session.nextCandidate()

    await session.shrink()
    const shrunk = session.preedit()
    await session.expand()

    expect({ shrunk, expanded: session.preedit(), calls: engine.calls }).toEqual({
      shrunk: { kind: 'converting', before: '', segments: ['今日', 'は', '良い'], current: 0, after: '' },
      expanded: { kind: 'converting', before: '', segments: ['今日は', '良い'], current: 0, after: '' },
      calls: [
        ['convert', 'きょうはいい', []],
        ['convert', 'きょうはいい', [[0, -1]]],
        ['convert', 'きょうはいい', [[0, -1], [0, 1]]],
      ],
    })
  })

  test('a resize that leaves fewer segments keeps the focus on the last one', async () => {
    const answers = { ...ANSWERS, [keyOf('きょうはいい', [[0, -1], [2, 1]])]: KYOUHAII }
    const { session } = await typed('kyouhaii', new FakeEngine(answers))
    await session.startConversion()
    await session.shrink()
    session.nextSegment()
    session.nextSegment()

    await session.expand()

    expect(session.preedit()).toEqual({ kind: 'converting', before: '', segments: ['今日は', '良い'], current: 1, after: '' })
  })

  test('commit answers the chosen candidates, has the engine learn the choices, and empties the preedit', async () => {
    const { session, engine } = await typed('kyouhaii')
    await session.startConversion()
    session.nextSegment()
    session.nextCandidate()

    const committed = await session.commit()

    expect({ committed, preedit: session.preedit(), calls: engine.calls }).toEqual({
      committed: '今日はいい',
      preedit: { kind: 'composing', text: '' },
      calls: [
        ['convert', 'きょうはいい', []],
        ['commit', 'きょうはいい', [], [0, 1]],
      ],
    })
  })

  test('typing commits the conversion first and starts the next reading with that key', async () => {
    const { session } = await typed('kan')
    await session.startConversion()

    const committed = await session.input('k')

    expect({ committed, preedit: session.preedit() }).toEqual({
      committed: '缶',
      preedit: { kind: 'composing', text: 'k' },
    })
  })

  test('cancel goes back to the kana as typed', async () => {
    const { session } = await typed('kyouhaii')
    await session.startConversion()

    session.cancel()

    expect({ preedit: session.preedit(), candidates: session.candidates() }).toEqual({
      preedit: { kind: 'composing', text: 'きょうはいい' },
      candidates: undefined,
    })
  })

  test('a conversion that answers no segments leaves the kana in place', async () => {
    const { session } = await typed('kyou', new FakeEngine({ [keyOf('きょう', [])]: [] }))

    await session.startConversion()

    expect({ preedit: session.preedit(), candidates: session.candidates() }).toEqual({
      preedit: { kind: 'composing', text: 'きょう' },
      candidates: undefined,
    })
  })

  test('a conversion the engine fails leaves the kana in place', async () => {
    const { session } = await typed('kyou')

    const failed = await session.startConversion().then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )

    expect({ failed, preedit: session.preedit() }).toEqual({
      failed: 'no answer for ["きょう",[]]',
      preedit: { kind: 'composing', text: 'きょう' },
    })
  })
})

describe('Session ASCII mode (;)', () => {
  test('; opens a part kept as typed, uppercase, digits, symbols and spaces included, until ; again', async () => {
    const { session } = await typed(';A b-1')
    const open = { preedit: session.preedit(), isAscii: session.isAscii() }

    await session.input(';')

    expect([open, { preedit: session.preedit(), isAscii: session.isAscii() }]).toEqual([
      { preedit: { kind: 'composing', text: 'A b-1' }, isAscii: true },
      { preedit: { kind: 'composing', text: 'A b-1' }, isAscii: false },
    ])
  })

  test('kana typed before ; stay pending, and romaji after the closing ; start new kana', async () => {
    const { session } = await typed('ka;Re;wo')

    expect(session.preedit()).toEqual({ kind: 'composing', text: 'かReを' })
  })

  test('a conversion converts the first kana part only, the others shown as they are around it', async () => {
    const { session, engine } = await typed('kyouhaii;React;')

    await session.startConversion()

    expect({ preedit: session.preedit(), calls: engine.calls }).toEqual({
      preedit: { kind: 'converting', before: '', segments: ['今日は', '良い'], current: 0, after: 'React' },
      calls: [['convert', 'きょうはいい', []]],
    })
  })

  test('the first kana part converted may come after a latin part', async () => {
    const { session } = await typed(';React;kan')

    await session.startConversion()

    expect(session.preedit()).toEqual({ kind: 'converting', before: 'React', segments: ['缶'], current: 0, after: '' })
  })

  test('starting a conversion while in ASCII mode asks the engine nothing', async () => {
    const { session, engine } = await typed('kan;X')

    await session.startConversion()

    expect({ preedit: session.preedit(), calls: engine.calls }).toEqual({
      preedit: { kind: 'composing', text: 'かんX' },
      calls: [],
    })
  })

  test('commitStep commits the converted part and goes on to convert the next kana part, then answers the whole run', async () => {
    const { session, engine } = await typed('kyouhaii;X;kan')
    await session.startConversion()

    const first = await session.commitStep()
    const between = session.preedit()
    const last = await session.commitStep()

    expect({ first, between, last, preedit: session.preedit(), calls: engine.calls }).toEqual({
      first: undefined,
      between: { kind: 'converting', before: '今日は良いX', segments: ['缶'], current: 0, after: '' },
      last: '今日は良いX缶',
      preedit: { kind: 'composing', text: '' },
      calls: [
        ['convert', 'きょうはいい', []],
        ['commit', 'きょうはいい', [], [0, 0]],
        ['convert', 'かん', []],
        ['commit', 'かん', [], [0]],
      ],
    })
  })

  test('commit while converting one part converts and learns the other kana parts by their first candidates', async () => {
    const { session, engine } = await typed('kyouhaii;X;kan')
    await session.startConversion()

    const committed = await session.commit()

    expect({ committed, isEmpty: session.isEmpty(), calls: engine.calls.slice(1) }).toEqual({
      committed: '今日は良いX缶',
      isEmpty: true,
      calls: [
        ['commit', 'きょうはいい', [], [0, 0]],
        ['convert', 'かん', []],
        ['commit', 'かん', [], [0]],
      ],
    })
  })

  test('commit while composing answers kana, latin parts as typed, and leaves ASCII mode', async () => {
    const { session } = await typed('kan;Re')

    const committed = await session.commit()

    expect({ committed, isAscii: session.isAscii(), isEmpty: session.isEmpty() }).toEqual({ committed: 'かんRe', isAscii: false, isEmpty: true })
  })

  test('Backspace removes one latin character and stays in ASCII mode; an emptied part goes away', async () => {
    const { session } = await typed('ka;Re')

    session.backspace()
    const once = { preedit: session.preedit(), isAscii: session.isAscii() }
    session.backspace()
    const twice = session.preedit()
    session.backspace()

    expect([once, twice, session.preedit(), session.isAscii()]).toEqual([
      { preedit: { kind: 'composing', text: 'かR' }, isAscii: true },
      { kind: 'composing', text: 'か' },
      { kind: 'composing', text: '' },
      true,
    ])
  })

  test('a run holding only ASCII mode is not empty, and closing it with nothing typed empties it', async () => {
    const { session } = await typed(';')
    const opened = { isEmpty: session.isEmpty(), isLatinTail: session.isLatinTail() }

    await session.input(';')

    expect([opened, { isEmpty: session.isEmpty(), isLatinTail: session.isLatinTail() }]).toEqual([
      { isEmpty: false, isLatinTail: true },
      { isEmpty: true, isLatinTail: false },
    ])
  })

  test('typing while converting commits first, and ; then opens ASCII mode', async () => {
    const { session } = await typed('kan')
    await session.startConversion()

    const committed = await session.input(';')
    await session.input('X')

    expect({ committed, preedit: session.preedit(), isAscii: session.isAscii() }).toEqual({
      committed: '缶',
      preedit: { kind: 'composing', text: 'X' },
      isAscii: true,
    })
  })
})
