// What one edit of the prompt box does while Japanese input is on: the run of
// kana (or its conversion) lives in the box's own text, underlined, between
// `anchor` and `anchor + shown.length`, and each edit either changes the run,
// commits it, or passes through to the engine's editor.
import { candidateByNumber } from './band'
import { Session } from './session'
import type { ConversionEngine } from './session'

export type KeyEvent = { key: string; ctrl?: true; shift?: true; meta?: true }

/** One edit as `prompt.edit` hands it: the box before it and the splice. */
export type Edit = { text: string; cursor: number; start: number; end: number; inputText: string; key?: KeyEvent }

export type Decoration = { start: number; end: number; underline: true; bold?: true }

export type BoxAnswer = { text: string; cursor: number; decorations: Decoration[] }

/**
 * `box`: the composer answers the edit itself with this box (the key is consumed).
 * `pass`: the editor applies the edit as usual, to `edit` when the composer
 * rewrote the box first (a commit that turned a trailing n into ん).
 */
export type Answer = { kind: 'box'; box: BoxAnswer; error?: string } | { kind: 'pass'; edit?: Edit }

// A run starts on a lowercase letter or Japanese punctuation, and goes on with digits and ' too.
const STARTS_RUN = /^[a-z,.\-/[\]]$/
const CONTINUES_RUN = /^[a-z0-9,.\-/[\]']$/

// Key shapes as a terminal delivers them to prompt.edit (observed on Claude Code 2.1.288):
// ctrl+j, once unbound from chat:newline, puts in a newline and arrives as `enter` (through
// tmux) or as `j` with ctrl (a terminal that reports modifiers), while
// a plain Enter never arrives (it submits); option+arrows arrive with `meta`, ctrl+arrows
// with `ctrl`, and shift+arrows not reliably at all.
const isToggle = (e: Edit) => e.key?.key === 'enter' || (e.key?.ctrl === true && e.key.key === 'j')
const isCtrl = (key: KeyEvent | undefined, name: string) => key?.ctrl === true && key.key === name
const isResize = (key: KeyEvent | undefined) => key?.meta === true || key?.ctrl === true

// A slash command's name being typed at the start of the box goes in as typed.
const isSlashCommandName = (before: string) => /^\/\S*$/.test(before)

// What the editor does with an edit the composer lets through.
function applied(answer: Answer, e: Edit): { text: string; cursor: number } {
  if (answer.kind === 'box') return answer.box
  const edit = answer.edit ?? e
  return { text: edit.text.slice(0, edit.start) + edit.inputText + edit.text.slice(edit.end), cursor: edit.start + edit.inputText.length }
}

export class Composer {
  private session: Session
  private on = false
  private isBusy = false
  private anchor = 0
  /** The run as it stands in the box; '' when there is none. */
  private shown = ''
  /**
   * The last box this composer answered, and the box the engine guessed before
   * the answer came: keys typed while an answer was pending arrive on the guess.
   */
  private last: { answered: { text: string; cursor: number }; guessed: { text: string; cursor: number } } | undefined
  /**
   * Keys the engine put in raw (it applies keys typed while an answer was pending
   * itself, whatever the hook answers), and the box it put them into.
   */
  private raw: { box: string; text: string } | undefined

  constructor(private readonly engine: ConversionEngine) {
    this.session = new Session(engine)
  }

  get isOn(): boolean {
    return this.on
  }

  /** The focused segment's candidates while converting. */
  candidates() {
    return this.session.candidates()
  }

  /** Turns Japanese input on, or off committing the run (the box keeps what it shows). */
  async toggle(): Promise<void> {
    if (this.on) {
      await this.session.commit()
      this.shown = ''
    }
    this.on = !this.on
  }

  async edit(input: Edit): Promise<Answer> {
    if (this.isBusy) return { kind: 'box', box: { text: input.text, cursor: input.cursor, decorations: this.decorations() } }
    const last = this.last
    this.last = undefined
    if (last !== undefined && input.text === last.guessed.text && input.text !== last.answered.text) {
      // Typed while the last answer was pending: the engine puts these keys in itself.
      if (input.start === input.end && input.inputText !== '') this.raw = { box: last.answered.text, text: input.inputText }
      else this.forget()
      return { kind: 'pass' }
    }
    this.isBusy = true
    try {
      // Raw keys taken back out leave a run, so a pass from here always carries the repaired box.
      const e = await this.repaired(input)
      if (this.shown !== '' && e.text.slice(this.anchor, this.anchor + this.shown.length) !== this.shown) this.forget()
      const answer = await this.answer(e)
      if (answer.kind === 'box') this.last = { answered: answer.box, guessed: applied({ kind: 'pass' }, input) }
      return answer
    } catch (error) {
      // The run stays as it was (a failed conversion changes nothing), so it keeps its underline.
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'box', box: { text: input.text, cursor: input.cursor, decorations: this.decorations() }, error: message }
    } finally {
      this.isBusy = false
    }
  }

  /** The prompt about to be sent, with the run committed into it (learned when it was converted). */
  async commitForSubmit(sent: string): Promise<string> {
    const found = this.findRaw(sent)
    const text = found === undefined ? sent : (await this.replay(found)).text
    // A prompt that no longer holds the run goes as it is; the next edit starts over.
    if (this.shown === '' || text.slice(this.anchor, this.anchor + this.shown.length) !== this.shown) return text
    return (await this.commitInto(text)).text
  }

  /**
   * The edit with any raw keys the engine put in taken back out of its box and
   * replayed as typed; the edit's own offsets past them move with the result.
   */
  private async repaired(input: Edit): Promise<Edit> {
    const found = this.findRaw(input.text)
    if (found === undefined) return input
    const replayed = await this.replay(found)
    const rawEnd = found.at + found.text.length
    const moved = (at: number) => (at >= rawEnd ? at + replayed.cursor - rawEnd : at)
    return { ...input, text: replayed.text, cursor: moved(input.cursor), start: moved(input.start), end: moved(input.end) }
  }

  /** Where the engine put the raw keys, when `text` is the box it showed with them in. */
  private findRaw(text: string): { box: string; at: number; text: string } | undefined {
    const raw = this.raw
    this.raw = undefined
    if (raw === undefined || text.length !== raw.box.length + raw.text.length) return undefined
    let common = 0
    while (common < raw.box.length && text[common] === raw.box[common]) common++
    for (let at = Math.max(0, common - raw.text.length); at <= common; at++) {
      if (text.slice(at, at + raw.text.length) === raw.text && text.slice(0, at) + text.slice(at + raw.text.length) === raw.box) {
        return { box: raw.box, at, text: raw.text }
      }
    }
    return undefined
  }

  /** The raw keys typed again on the box they went into. */
  private async replay(found: { box: string; at: number; text: string }): Promise<{ text: string; cursor: number }> {
    const typed: Edit = { text: found.box, cursor: found.at, start: found.at, end: found.at, inputText: found.text }
    return applied(await this.answer(typed), typed)
  }

  private async answer(e: Edit): Promise<Answer> {
    if (isToggle(e)) {
      // A commit keeps the run's length (only a trailing n becomes ん), so the cursor stays.
      const text = this.on ? (await this.commitInto(e.text)).text : e.text
      this.on = !this.on
      return { kind: 'box', box: { text, cursor: e.cursor, decorations: [] } }
    }
    if (!this.on) return { kind: 'pass' }
    // A burst of keys or a paste comes with no key; a key that puts in text of its own (ctrl+y) is not one.
    if (e.key === undefined && e.start === e.end && e.inputText.length > 1 && [...e.inputText].every(c => CONTINUES_RUN.test(c))) {
      return this.burst(e)
    }

    const ch = e.start === e.end ? e.inputText : ''
    if (this.shown === '') {
      if (!STARTS_RUN.test(ch) || isSlashCommandName(e.text.slice(0, e.start) + ch)) return { kind: 'pass' }
      this.anchor = e.start
      await this.session.input(ch)
      return this.render(e.text)
    }

    const end = this.anchor + this.shown.length
    const isAtEnd = e.start === end && e.end === end
    const key = e.key?.key
    const candidates = this.session.candidates()

    if (isCtrl(e.key, 'k')) {
      // Commits without sending (Japanese input stays on), and kills none of the text after it.
      const { text, end: cursor } = await this.commitInto(e.text)
      return { kind: 'box', box: { text, cursor, decorations: [] } }
    }

    if (candidates !== undefined) {
      // Converting: the cursor sits at the focused segment's end, so a key typed or a
      // Backspace anywhere in the run counts, and left/right always have room to move.
      const isInRun = e.start >= this.anchor && e.end <= end
      const number = /^[1-9]$/.test(ch) ? candidateByNumber(candidates.list.length, candidates.index, Number(ch)) : undefined
      if (key === 'backspace' && isInRun && e.start === e.end - 1) this.session.cancel()
      else if (isInRun && ch === ' ') this.session.nextCandidate()
      else if (isInRun && /^[1-9]$/.test(ch)) {
        if (number !== undefined) this.session.select(number)
      } else if ((key === 'left' && isResize(e.key)) || isCtrl(e.key, 'a')) await this.session.shrink()
      else if ((key === 'right' && isResize(e.key)) || isCtrl(e.key, 'e')) await this.session.expand()
      else if (key === 'left' || isCtrl(e.key, 'b')) this.session.prevSegment()
      else if (key === 'right' || isCtrl(e.key, 'f')) this.session.nextSegment()
      else if (isInRun && CONTINUES_RUN.test(ch)) return this.continueAfterCommit(e.text, ch)
      // Anything else typed in the run goes in after all of it, as a kana key would.
      else if (isInRun && e.start === e.end) return this.commitAndPass({ ...e, cursor: end, start: end, end })
      else return this.commitAndPass(e)
      return this.render(e.text)
    }
    if (key === 'backspace' && e.end === end && e.start === end - 1) {
      this.session.backspace()
      return this.render(e.text)
    }
    if (isAtEnd && ch === ' ') {
      await this.session.startConversion()
      return this.render(e.text)
    }
    if (isAtEnd && CONTINUES_RUN.test(ch)) {
      await this.session.input(ch)
      return this.render(e.text)
    }
    return this.commitAndPass(e)
  }

  /** Several characters in one edit (a burst of keys, or a paste of romaji): one at a time. */
  private async burst(e: Edit): Promise<Answer> {
    let box = { text: e.text, cursor: e.start }
    for (const ch of e.inputText) {
      const one: Edit = { text: box.text, cursor: box.cursor, start: box.cursor, end: box.cursor, inputText: ch }
      box = applied(await this.answer(one), one)
    }
    return { kind: 'box', box: { ...box, decorations: this.decorations() } }
  }

  /** Replaces the run in `text` with the session's preedit, and answers that box. */
  private render(text: string): Answer {
    const preedit = this.preeditText()
    const next = text.slice(0, this.anchor) + preedit + text.slice(this.anchor + this.shown.length)
    this.shown = preedit
    return { kind: 'box', box: { text: next, cursor: this.cursor(), decorations: this.decorations() } }
  }

  /** Composing: after the kana. Converting: after the focused segment. */
  private cursor(): number {
    const p = this.session.preedit()
    if (p.kind === 'composing') return this.anchor + p.text.length
    return this.anchor + p.before.length + p.segments.slice(0, p.current + 1).join('').length
  }

  private async continueAfterCommit(text: string, ch: string): Promise<Answer> {
    const committed = await this.session.input(ch)
    const before = text.slice(0, this.anchor) + committed + text.slice(this.anchor + this.shown.length)
    this.anchor += committed.length
    this.shown = ''
    return this.render(before)
  }

  /**
   * Commits the run, then lets `edit` through (the edit as received, or moved by the
   * caller); the run keeps its length, so the edit's offsets hold.
   */
  private async commitAndPass(edit: Edit): Promise<Answer> {
    const { text } = await this.commitInto(edit.text)
    return { kind: 'pass', edit: { ...edit, text } }
  }

  /** Commits the run: `text` with the committed text in its place, and where that text ends. */
  private async commitInto(text: string): Promise<{ text: string; end: number }> {
    const committed = await this.session.commit()
    const next = text.slice(0, this.anchor) + committed + text.slice(this.anchor + this.shown.length)
    this.shown = ''
    return { text: next, end: this.anchor + committed.length }
  }

  /** The run was changed from outside (sent, cleared, edited): start over without learning. */
  private forget() {
    this.session = new Session(this.engine)
    this.shown = ''
  }

  private preeditText(): string {
    const p = this.session.preedit()
    return p.kind === 'composing' ? p.text : p.before + p.segments.join('') + p.after
  }

  private decorations(): Decoration[] {
    const p = this.session.preedit()
    if (p.kind === 'composing') {
      return p.text === '' ? [] : [{ start: this.anchor, end: this.anchor + p.text.length, underline: true }]
    }
    // The parts around the conversion stay underlined as composing kana are.
    const around = (start: number, text: string): Decoration[] => (text === '' ? [] : [{ start, end: start + text.length, underline: true }])
    let at = this.anchor + p.before.length
    const segments = p.segments.map((segment, i): Decoration => {
      const run: Decoration = { start: at, end: at + segment.length, underline: true }
      at += segment.length
      return i === p.current ? { ...run, bold: true } : run
    })
    return [...around(this.anchor, p.before), ...segments, ...around(at, p.after)]
  }
}
