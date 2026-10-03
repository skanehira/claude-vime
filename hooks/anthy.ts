// The conversion engine backed by anthy-agent in egg mode (shipped with anthy
// 9100h as anthy-agent, with anthy-unicode as anthy-agent-unicode). Each call
// starts the agent once, writes the whole session of commands to its standard
// input, and reads the answers back.
import type { ConversionEngine, Resize, Segment } from './session'

export type RunResult = { exitCode: number; stdout: string; stderr: string }

/** Starts a host command and resolves once it exited; the hooks module passes `$.process.run`. */
export type Run = (argv: readonly string[], init: { stdin: string; timeoutMs: number }) => Promise<RunResult>

const TIMEOUT_MS = 5000
// More candidates than any segment has: the agent clamps the request to what there is.
const MAX_CANDIDATES = 1024
// egg reads a command line into 512 bytes, its newline included; "CONVERT 0 " takes 10.
const MAX_READING_BYTES = 500
const AGENTS = ['anthy-agent-unicode', 'anthy-agent'] as const
const NOT_FOUND =
  'vime: anthy-agent not found: install anthy-unicode (anthy-agent-unicode) or anthy (anthy-agent), or set VIME_ANTHY_AGENT'

/**
 * The agent to run: `custom` (VIME_ANTHY_AGENT) alone when set, otherwise the
 * first of anthy-agent-unicode and anthy-agent that answers `--version`.
 */
export async function findAgent(
  probe: (argv: readonly string[]) => Promise<boolean>,
  custom: string | undefined,
): Promise<string | undefined> {
  for (const agent of custom === undefined ? AGENTS : [custom]) {
    if (await probe([agent, '--version'])) return agent
  }
  return undefined
}

type Commit = ConversionEngine['commit']

/**
 * A commit that answers at once and has the agent learn in the background, one
 * commit after another: learning changes nothing on screen, and a key typed
 * while a hook waits is one the engine handles on its own.
 */
export function learnLater(commit: Commit, report: (message: string) => void): Commit {
  let queue = Promise.resolve()
  return async (yomi, resizes, choices) => {
    queue = queue
      .then(() => commit(yomi, resizes, choices))
      .catch((error: unknown) => report(error instanceof Error ? error.message : String(error)))
  }
}

export function anthyEngine(run: Run, agent: string | undefined): ConversionEngine {
  // --utf8 is anthy 9100h's switch away from EUC-JP; anthy-unicode speaks UTF-8 and ignores it.
  const session = async (yomi: string, commands: readonly string[]): Promise<string[]> => {
    if (agent === undefined) throw new Error(NOT_FOUND)
    if (new TextEncoder().encode(yomi).length > MAX_READING_BYTES) {
      throw new Error(`vime: the reading is too long to convert at once (over ${MAX_READING_BYTES} bytes)`)
    }
    const script = ['NEW-CONTEXT INPUT=#18 OUTPUT=#18', `CONVERT 0 ${yomi}`, ...commands, 'QUIT']
    const ran = await run([agent, '--egg', '--utf8'], { stdin: script.map(line => `${line}\n`).join(''), timeoutMs: TIMEOUT_MS })
    if (ran.exitCode !== 0) {
      const reason = ran.stderr.split('\n')[0]
      throw new Error(`vime: anthy-agent exited with ${ran.exitCode}${reason ? `: ${reason}` : ''}`)
    }
    const lines = ran.stdout.split('\n').map(line => line.replace(/\r$/, ''))
    // The last answer ends in a newline, which leaves one empty piece past it.
    if (lines.at(-1) === '') lines.pop()
    return lines
  }
  // RESIZE-SEGMENT's last field is a direction flag, not an amount: 0 lengthens, anything else shortens.
  const resizesOf = (resizes: readonly Resize[]) =>
    resizes.map(([segment, delta]) => `RESIZE-SEGMENT 0 ${segment} ${delta < 0 ? 1 : 0}`)

  return {
    async convert(yomi, resizes) {
      // A reading of n characters holds at most n segments; a request past the last answers -1.
      const requests = Array.from({ length: [...yomi].length }, (_, i) => `GET-CANDIDATES 0 ${i} 0 ${MAX_CANDIDATES}`)
      const answers = new Answers(await session(yomi, [...resizesOf(resizes), ...requests]))
      answers.skip(2 + resizes.length) // NEW-CONTEXT and CONVERT, then each RESIZE-SEGMENT
      return requests
        .map(() => answers.candidates())
        .filter(candidates => candidates !== undefined)
        .map((candidates): Segment => ({ candidates }))
    },
    async commit(yomi, resizes, choices) {
      const selections = choices.map((choice, segment) => `SELECT-CANDIDATE 0 ${segment} ${choice}`)
      const answers = new Answers(await session(yomi, [...resizesOf(resizes), ...selections, 'COMMIT 0 0']))
      answers.skip(2 + resizes.length + selections.length)
      answers.expect('+OK')
    },
  }
}

/** The agent's answers, read in the order the commands went in. */
class Answers {
  private at = 0

  constructor(private readonly lines: readonly string[]) {
    // The greeting comes first.
    this.at = 1
  }

  /** Reads past the answers to `count` commands. */
  skip(count: number): void {
    for (let i = 0; i < count; i++) this.next()
  }

  /** One GET-CANDIDATES answer: the candidates, or undefined past the last segment. */
  candidates(): string[] | undefined {
    const head = this.line()
    const match = /^\+DATA (\d+) (-?\d+)$/.exec(head)
    if (match === null) throw unexpected(head)
    const count = Number(match[2]) - Number(match[1])
    const list = count < 0 ? [] : Array.from({ length: count }, () => this.line())
    this.blank()
    return count < 0 ? undefined : list
  }

  expect(prefix: string): void {
    const head = this.line()
    if (!head.startsWith(prefix)) throw unexpected(head)
  }

  /** Reads past one answer of any kind. */
  private next(): void {
    const head = this.line()
    const segments = /^\+DATA \d+ \d+ (\d+)$/.exec(head)
    if (segments !== null) {
      for (let i = 0; i < Number(segments[1]); i++) this.line()
      this.blank()
      return
    }
    if (!head.startsWith('+OK')) throw unexpected(head)
  }

  private blank(): void {
    const line = this.line()
    if (line !== '') throw unexpected(line)
  }

  private line(): string {
    const line = this.lines[this.at]
    this.at += 1
    if (line === undefined) throw unexpected('(nothing)')
    if (line.startsWith('-ERR')) throw new Error(`vime: anthy-agent: ${line}`)
    return line
  }
}

function unexpected(line: string): Error {
  return new Error(`vime: anthy-agent answered something unexpected: ${line}`)
}
