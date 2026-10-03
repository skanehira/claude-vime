// The conversion state machine: composing (romaji shown as kana) and converting
// (the reading split into segments, each showing a chosen candidate). Ported from
// vime.nvim lua/vime/session.lua: the run is a list of parts, and a conversion
// works on one kana part at a time.
import { toKana } from './romaji'

/** One segment of a conversion: its candidates, best first. */
export type Segment = { candidates: readonly string[] }

/** A resize of the segment at `[0]` (0-based) by `[1]` characters: +1 longer, -1 shorter. */
export type Resize = readonly [number, number]

/**
 * Kana-to-kanji conversion with no state of its own: each call converts the
 * reading again and replays the resizes so far, as one anthy-agent run does.
 */
export interface ConversionEngine {
  convert(yomi: string, resizes: readonly Resize[]): Promise<readonly Segment[]>
  /** Learns the choice made for each segment (0-based candidate indices). */
  commit(yomi: string, resizes: readonly Resize[], choices: readonly number[]): Promise<void>
}

/**
 * What the prompt box shows for the session. While converting, `before` and
 * `after` are the run's other parts as they stand, around the part converted.
 */
export type Preedit =
  | { kind: 'composing'; text: string }
  | { kind: 'converting'; before: string; segments: readonly string[]; current: number; after: string }

/** One part of the run. */
type Part = { kind: 'kana'; romaji: string }

type Conversion = {
  /** The index of the kana part being converted. */
  at: number
  yomi: string
  resizes: readonly Resize[]
  segments: readonly Segment[]
  choices: readonly number[]
  current: number
}

export class Session {
  private parts: Part[] = []
  private conversion: Conversion | undefined

  constructor(private readonly engine: ConversionEngine) {}

  preedit(): Preedit {
    const c = this.conversion
    if (c === undefined) return { kind: 'composing', text: shownOf(this.parts) }
    const before = shownOf(this.parts.slice(0, c.at))
    const after = shownOf(this.parts.slice(c.at + 1))
    return { kind: 'converting', before, segments: chosen(c), current: c.current, after }
  }

  /** The focused segment's candidates and the chosen one's index; undefined while composing. */
  candidates(): { list: readonly string[]; index: number } | undefined {
    const c = this.conversion
    if (c === undefined) return undefined
    return { list: c.segments[c.current]!.candidates, index: c.choices[c.current]! }
  }

  /** Adds one typed character; while converting, commits first and answers what was committed. */
  async input(ch: string): Promise<string> {
    const committed = this.conversion === undefined ? '' : await this.commit()
    this.kanaTail().romaji += ch
    return committed
  }

  /** Removes the last kana while composing (a youon such as きょ is one unit). */
  backspace(): void {
    const tail = this.parts.at(-1)
    if (this.conversion !== undefined || tail === undefined) return
    const before = [...toKana(tail.romaji, true)].length
    let romaji = tail.romaji
    while (romaji.length > 0) {
      romaji = romaji.slice(0, -1)
      const kana = toKana(romaji, true)
      if (!/[A-Za-z]$/.test(kana) && [...kana].length < before) break
    }
    tail.romaji = romaji
    if (romaji === '') this.parts.pop()
  }

  async startConversion(): Promise<void> {
    if (this.conversion !== undefined) return
    const at = this.parts.findIndex(part => part.kind === 'kana')
    if (at < 0) return
    const yomi = toKana(this.parts[at]!.romaji)
    if (yomi === '') return
    const segments = await this.engine.convert(yomi, [])
    if (segments.length === 0) return
    this.conversion = { at, yomi, resizes: [], segments, choices: segments.map(() => 0), current: 0 }
  }

  /** Picks the focused segment's candidate at `index`. */
  select(index: number): void {
    const c = this.conversion
    if (c === undefined) return
    this.conversion = { ...c, choices: c.choices.map((choice, i) => (i === c.current ? index : choice)) }
  }

  nextCandidate(): void {
    this.moveCandidate(1)
  }

  prevCandidate(): void {
    this.moveCandidate(-1)
  }

  nextSegment(): void {
    this.moveSegment(1)
  }

  prevSegment(): void {
    this.moveSegment(-1)
  }

  async expand(): Promise<void> {
    await this.resize(1)
  }

  async shrink(): Promise<void> {
    await this.resize(-1)
  }

  /** Ends the session's text: the chosen candidates (learned) or the kana as typed. */
  async commit(): Promise<string> {
    const c = this.conversion
    if (c === undefined) {
      const text = this.parts.map(part => toKana(part.romaji)).join('')
      this.parts = []
      return text
    }
    await this.engine.commit(c.yomi, c.resizes, c.choices)
    this.conversion = undefined
    this.parts = []
    return chosen(c).join('')
  }

  /** Converting: back to the kana as typed. Composing: drops the kana. */
  cancel(): void {
    if (this.conversion !== undefined) {
      this.conversion = undefined
      return
    }
    this.parts = []
  }

  /** The last part when it is kana, otherwise a new kana part after it. */
  private kanaTail(): Part {
    const tail = this.parts.at(-1)
    if (tail !== undefined) return tail
    const part: Part = { kind: 'kana', romaji: '' }
    this.parts.push(part)
    return part
  }

  private moveCandidate(delta: number) {
    const c = this.conversion
    if (c === undefined) return
    const n = c.segments[c.current]!.candidates.length
    const choices = c.choices.map((choice, i) => (i === c.current ? (choice + delta + n) % n : choice))
    this.conversion = { ...c, choices }
  }

  private moveSegment(delta: number) {
    const c = this.conversion
    if (c === undefined) return
    this.conversion = { ...c, current: clamp(c.current + delta, 0, c.segments.length - 1) }
  }

  private async resize(delta: number) {
    const c = this.conversion
    if (c === undefined) return
    const resizes: readonly Resize[] = [...c.resizes, [c.current, delta]]
    const segments = await this.engine.convert(c.yomi, resizes)
    if (segments.length === 0) return
    this.conversion = {
      at: c.at,
      yomi: c.yomi,
      resizes,
      segments,
      choices: segments.map(() => 0),
      current: clamp(c.current, 0, segments.length - 1),
    }
  }
}

/** The parts as the box shows them while composing: kana with a trailing n held as n. */
function shownOf(parts: readonly Part[]): string {
  return parts.map(part => toKana(part.romaji, true)).join('')
}

function chosen(c: Conversion): string[] {
  return c.segments.map((segment, i) => segment.candidates[c.choices[i]!]!)
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, max))
}
