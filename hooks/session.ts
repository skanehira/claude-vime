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

/** The key that opens and closes ASCII mode, as vime.nvim's ascii_toggle defaults to. */
const ASCII_TOGGLE = ';'

/**
 * One part of the run: romaji shown as kana, text kept as typed in ASCII mode
 * (`isClosed` once ; ended it), or text a step of a mixed run already committed.
 */
type Part = { kind: 'kana'; romaji: string } | { kind: 'latin'; text: string; isClosed: boolean } | { kind: 'confirmed'; text: string }

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
  private ascii = false

  constructor(private readonly engine: ConversionEngine) {}

  preedit(): Preedit {
    const c = this.conversion
    if (c === undefined) return { kind: 'composing', text: shownOf(this.parts, true) }
    const before = shownOf(this.parts.slice(0, c.at), false)
    const after = shownOf(this.parts.slice(c.at + 1), true)
    return { kind: 'converting', before, segments: chosen(c), current: c.current, after }
  }

  /** The focused segment's candidates and the chosen one's index; undefined while composing. */
  candidates(): { list: readonly string[]; index: number } | undefined {
    const c = this.conversion
    if (c === undefined) return undefined
    return { list: c.segments[c.current]!.candidates, index: c.choices[c.current]! }
  }

  /** In ASCII mode: what is typed goes in as it is, until ; again. */
  isAscii(): boolean {
    return this.ascii
  }

  /** Nothing typed and not in ASCII mode. */
  isEmpty(): boolean {
    return this.parts.length === 0 && !this.ascii
  }

  /** The run ends in a latin part: Space then goes in as a space, as vime.nvim's latin run takes it. */
  isLatinTail(): boolean {
    return this.parts.at(-1)?.kind === 'latin'
  }

  /** What is typed goes in as it is: ASCII mode, or English text an uppercase letter started. */
  isTypingLatin(): boolean {
    const tail = this.parts.at(-1)
    return this.ascii || (tail?.kind === 'latin' && !tail.isClosed)
  }

  /** Adds one typed character; while converting, commits first and answers what was committed. */
  async input(ch: string): Promise<string> {
    const committed = this.conversion === undefined ? '' : await this.commit()
    if (ch === ASCII_TOGGLE) this.toggleAscii()
    else if (this.isTypingLatin()) this.latinTail().text += ch
    else if (/^[A-Z]$/.test(ch)) {
      // vime.nvim's latin run: what is pending is committed in place, and English text starts.
      const pending = this.parts.length > 0 ? await this.commit() : ''
      this.parts.push({ kind: 'latin', text: ch, isClosed: false })
      return committed + pending
    } else this.kanaTail().romaji += ch
    return committed
  }

  /** Removes the last kana while composing (a youon such as きょ is one unit). */
  backspace(): void {
    const tail = this.parts.at(-1)
    if (this.conversion !== undefined || tail === undefined || tail.kind === 'confirmed') return
    if (tail.kind === 'latin') {
      // ASCII mode stays as it is: only ; leaves it.
      tail.text = tail.text.slice(0, -1)
      if (tail.text === '') this.parts.pop()
      return
    }
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
    if (this.conversion !== undefined || this.ascii) return
    await this.convertFrom(0)
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

  /**
   * Ends the session's text. Converting: the chosen candidates (learned), and
   * every other kana part converted and learned by its first candidates.
   * Composing: the kana and latin parts as typed.
   */
  async commit(): Promise<string> {
    if (this.conversion !== undefined) {
      await this.commitConverted()
      while (await this.convertFrom(0)) await this.commitConverted()
    }
    return this.finish()
  }

  /**
   * vime.nvim's Enter: commits the converted part and goes on to convert the next
   * kana part (answering undefined), or, with none left, ends the run and answers it.
   */
  async commitStep(): Promise<string | undefined> {
    if (this.conversion === undefined) return this.finish()
    const at = this.conversion.at
    await this.commitConverted()
    if (await this.convertFrom(at + 1)) return undefined
    return this.finish()
  }

  /** Converting: back to the kana as typed. Composing: drops the run and leaves ASCII mode. */
  cancel(): void {
    if (this.conversion !== undefined) {
      this.conversion = undefined
      return
    }
    this.parts = []
    this.ascii = false
  }

  private toggleAscii() {
    if (!this.ascii) {
      this.ascii = true
      this.latinTail()
      return
    }
    this.ascii = false
    const tail = this.parts.at(-1)
    if (tail?.kind !== 'latin') return
    if (tail.text === '') this.parts.pop()
    else tail.isClosed = true
  }

  /** The open latin part at the end, or a new one after the last part. */
  private latinTail(): Extract<Part, { kind: 'latin' }> {
    const tail = this.parts.at(-1)
    if (tail?.kind === 'latin' && !tail.isClosed) return tail
    const part = { kind: 'latin' as const, text: '', isClosed: false }
    this.parts.push(part)
    return part
  }

  /** The kana part at the end, or a new one after the last part. */
  private kanaTail(): Extract<Part, { kind: 'kana' }> {
    const tail = this.parts.at(-1)
    if (tail?.kind === 'kana') return tail
    const part = { kind: 'kana' as const, romaji: '' }
    this.parts.push(part)
    return part
  }

  /** Converts the first kana part at or after `from`; false when there is none to convert. */
  private async convertFrom(from: number): Promise<boolean> {
    const at = this.parts.findIndex((part, i) => i >= from && part.kind === 'kana' && toKana(part.romaji) !== '')
    if (at < 0) return false
    const yomi = toKana((this.parts[at] as Extract<Part, { kind: 'kana' }>).romaji)
    const segments = await this.engine.convert(yomi, [])
    if (segments.length === 0) return false
    this.conversion = { at, yomi, resizes: [], segments, choices: segments.map(() => 0), current: 0 }
    return true
  }

  /** Learns the conversion and puts its chosen text in place of its part. */
  private async commitConverted() {
    const c = this.conversion
    if (c === undefined) return
    await this.engine.commit(c.yomi, c.resizes, c.choices)
    this.parts[c.at] = { kind: 'confirmed', text: chosen(c).join('') }
    this.conversion = undefined
  }

  /** The run as committed text; the session is empty afterwards. */
  private finish(): string {
    const text = this.parts.map(part => (part.kind === 'kana' ? toKana(part.romaji) : part.text)).join('')
    this.parts = []
    this.ascii = false
    return text
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

/**
 * The parts as the box shows them while composing: a trailing n held as n only
 * in the last kana part, the one still being typed.
 */
function shownOf(parts: readonly Part[], endsRun: boolean): string {
  const last = parts.length - 1
  return parts.map((part, i) => (part.kind === 'kana' ? toKana(part.romaji, endsRun && i === last) : part.text)).join('')
}

function chosen(c: Conversion): string[] {
  return c.segments.map((segment, i) => segment.candidates[c.choices[i]!]!)
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, max))
}
