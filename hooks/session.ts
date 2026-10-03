// The conversion state machine: composing (romaji shown as kana) and converting
// (the reading split into segments, each showing a chosen candidate). Ported from
// the parts of vime.nvim lua/vime/session.lua a single kana run needs.
import { toKana } from './romaji'

/** One segment of a conversion: its candidates, best first. */
export type Segment = { candidates: readonly string[] }

/** A resize of the segment at `[0]` (0-based) by `[1]` characters: +1 longer, -1 shorter. */
export type Resize = readonly [number, number]

/**
 * Kana-to-kanji conversion with no state of its own: each call converts the
 * reading again and replays the resizes so far, as the bridge process does.
 */
export interface ConversionEngine {
  convert(yomi: string, resizes: readonly Resize[]): Promise<readonly Segment[]>
  /** Learns the choice made for each segment (0-based candidate indices). */
  commit(yomi: string, resizes: readonly Resize[], choices: readonly number[]): Promise<void>
}

/** What the prompt box shows for the session. */
export type Preedit =
  | { kind: 'composing'; text: string }
  | { kind: 'converting'; segments: readonly string[]; current: number }

type Conversion = {
  yomi: string
  resizes: readonly Resize[]
  segments: readonly Segment[]
  choices: readonly number[]
  current: number
}

export class Session {
  private romaji = ''
  private conversion: Conversion | undefined

  constructor(private readonly engine: ConversionEngine) {}

  preedit(): Preedit {
    const c = this.conversion
    if (c === undefined) return { kind: 'composing', text: toKana(this.romaji, true) }
    return { kind: 'converting', segments: chosen(c), current: c.current }
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
    this.romaji += ch
    return committed
  }

  /** Removes the last kana while composing (a youon such as きょ is one unit). */
  backspace(): void {
    if (this.conversion !== undefined || this.romaji === '') return
    const before = [...toKana(this.romaji, true)].length
    let romaji = this.romaji
    while (romaji.length > 0) {
      romaji = romaji.slice(0, -1)
      const kana = toKana(romaji, true)
      if (!/[A-Za-z]$/.test(kana) && [...kana].length < before) break
    }
    this.romaji = romaji
  }

  async startConversion(): Promise<void> {
    if (this.conversion !== undefined) return
    const yomi = toKana(this.romaji)
    if (yomi === '') return
    const segments = await this.engine.convert(yomi, [])
    if (segments.length === 0) return
    this.conversion = { yomi, resizes: [], segments, choices: segments.map(() => 0), current: 0 }
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
      const text = toKana(this.romaji)
      this.romaji = ''
      return text
    }
    await this.engine.commit(c.yomi, c.resizes, c.choices)
    this.conversion = undefined
    this.romaji = ''
    return chosen(c).join('')
  }

  /** Converting: back to the kana as typed. Composing: drops the kana. */
  cancel(): void {
    if (this.conversion !== undefined) {
      this.conversion = undefined
      return
    }
    this.romaji = ''
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
      yomi: c.yomi,
      resizes,
      segments,
      choices: segments.map(() => 0),
      current: clamp(c.current, 0, segments.length - 1),
    }
  }
}

function chosen(c: Conversion): string[] {
  return c.segments.map((segment, i) => segment.candidates[c.choices[i]!]!)
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, max))
}
