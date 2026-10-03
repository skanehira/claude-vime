// What one edit of the prompt box does while Japanese input is on: the run of
// kana (or its conversion) lives in the box's own text, underlined, between
// `anchor` and `anchor + shown.length`, and each edit either changes the run,
// commits it, or passes through to the engine's editor.
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

const isToggle = (key: KeyEvent | undefined) => key?.ctrl === true && key.key === 'j'
const isCtrl = (key: KeyEvent | undefined, name: string) => key?.ctrl === true && key.key === name

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

  async edit(e: Edit): Promise<Answer> {
    if (this.isBusy) return { kind: 'box', box: { text: e.text, cursor: e.cursor, decorations: this.decorations() } }
    if (this.shown !== '' && e.text.slice(this.anchor, this.anchor + this.shown.length) !== this.shown) this.forget()
    this.isBusy = true
    try {
      return await this.answer(e)
    } catch (error) {
      // The run stays as it was (a failed conversion changes nothing), so it keeps its underline.
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'box', box: { text: e.text, cursor: e.cursor, decorations: this.decorations() }, error: message }
    } finally {
      this.isBusy = false
    }
  }

  /** The prompt about to be sent, with the run committed into it (learned when it was converted). */
  async commitForSubmit(text: string): Promise<string> {
    // A prompt that no longer holds the run goes as it is; the next edit starts over.
    if (this.shown === '' || text.slice(this.anchor, this.anchor + this.shown.length) !== this.shown) return text
    return (await this.commitInto(text)).text
  }

  private async answer(e: Edit): Promise<Answer> {
    if (isToggle(e.key)) {
      // A commit keeps the run's length (only a trailing n becomes ん), so the cursor stays.
      const text = this.on ? (await this.commitInto(e.text)).text : e.text
      this.on = !this.on
      return { kind: 'box', box: { text, cursor: e.cursor, decorations: [] } }
    }
    if (!this.on) return { kind: 'pass' }
    if (e.start === e.end && e.inputText.length > 1 && [...e.inputText].every(c => CONTINUES_RUN.test(c))) {
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
    const isConverting = this.session.preedit().kind === 'converting'
    const key = e.key?.key

    if (key === 'return') {
      const { text, end: cursor } = await this.commitInto(e.text)
      return { kind: 'box', box: { text, cursor, decorations: [] } }
    }
    if (key === 'backspace' && e.end === end && e.start === end - 1) {
      if (isConverting) this.session.cancel()
      else this.session.backspace()
      return this.render(e.text)
    }
    if (isConverting) {
      if ((isAtEnd && ch === ' ') || key === 'down' || isCtrl(e.key, 'n')) this.session.nextCandidate()
      else if (key === 'up' || isCtrl(e.key, 'p')) this.session.prevCandidate()
      else if (key === 'left' && e.key?.shift === true) await this.session.shrink()
      else if (key === 'right' && e.key?.shift === true) await this.session.expand()
      else if (key === 'left') this.session.prevSegment()
      else if (key === 'right') this.session.nextSegment()
      else if (isAtEnd && CONTINUES_RUN.test(ch)) return this.continueAfterCommit(e.text, ch)
      else return this.commitAndPass(e)
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
    return { kind: 'box', box: { text: next, cursor: this.anchor + preedit.length, decorations: this.decorations() } }
  }

  private async continueAfterCommit(text: string, ch: string): Promise<Answer> {
    const committed = await this.session.input(ch)
    const before = text.slice(0, this.anchor) + committed + text.slice(this.anchor + this.shown.length)
    this.anchor += committed.length
    this.shown = ''
    return this.render(before)
  }

  /** Commits the run, then lets the edit through; the run keeps its length, so the edit's offsets hold. */
  private async commitAndPass(e: Edit): Promise<Answer> {
    const { text } = await this.commitInto(e.text)
    return text === e.text ? { kind: 'pass' } : { kind: 'pass', edit: { ...e, text } }
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
    return p.kind === 'composing' ? p.text : p.segments.join('')
  }

  private decorations(): Decoration[] {
    const p = this.session.preedit()
    if (p.kind === 'composing') {
      return p.text === '' ? [] : [{ start: this.anchor, end: this.anchor + p.text.length, underline: true }]
    }
    let at = this.anchor
    return p.segments.map((segment, i) => {
      const run: Decoration = { start: at, end: at + segment.length, underline: true }
      at += segment.length
      return i === p.current ? { ...run, bold: true } : run
    })
  }
}
