import { describe, expect, test } from 'claude-code/testing'

import { anthyEngine, findAgent } from './anthy'
import type { Run, RunResult } from './anthy'

const AGENT = '/nix/profile/bin/anthy-agent'

// Answers every run with one result and keeps what each run was asked.
function fakeRun(result: RunResult) {
  const calls: { argv: readonly string[]; stdin: string; timeoutMs: number }[] = []
  const run: Run = async (argv, init) => {
    calls.push({ argv, ...init })
    return result
  }
  return { run, calls }
}

// anthy-agent --egg answers in lines ending in CRLF, as observed with anthy 9100h and anthy-unicode.
const lines = (...all: string[]) => all.map(line => `${line}\r\n`).join('')
const ok = (...all: string[]): RunResult => ({ exitCode: 0, stdout: lines(...all), stderr: '' })

const HELLO = 'Anthy (Version 9100h) [] : Nice to meet you.'
const NO_SEGMENT = ['+DATA 0 -1', '']

// What the agent answers for きょうはいい converted as is: two segments, then no more.
const KYOUHAII = ok(
  HELLO,
  '+OK 0',
  '+DATA 0 0 2',
  '17 今日は きょうは',
  '18 良い いい',
  '',
  '+DATA 0 2',
  '今日は',
  'きょうは',
  '',
  '+DATA 0 2',
  '良い',
  'いい',
  '',
  ...NO_SEGMENT,
  ...NO_SEGMENT,
  ...NO_SEGMENT,
  ...NO_SEGMENT,
)

const candidateRequests = (count: number) => Array.from({ length: count }, (_, i) => `GET-CANDIDATES 0 ${i} 0 1024`)

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )

describe('anthyEngine', () => {
  test('convert runs anthy-agent in egg mode and asks each segment its reading could hold for its candidates', async () => {
    const { run, calls } = fakeRun(KYOUHAII)

    const segments = await anthyEngine(run, AGENT).convert('きょうはいい', [])

    expect({ segments, calls }).toEqual({
      segments: [{ candidates: ['今日は', 'きょうは'] }, { candidates: ['良い', 'いい'] }],
      calls: [
        {
          argv: [AGENT, '--egg', '--utf8'],
          stdin: lines('NEW-CONTEXT INPUT=#18 OUTPUT=#18', 'CONVERT 0 きょうはいい', ...candidateRequests(6), 'QUIT').replaceAll('\r', ''),
          timeoutMs: 5000,
        },
      ],
    })
  })

  test('a resize goes to the agent as its direction flag: 1 to shorten, 0 to lengthen', async () => {
    const { run, calls } = fakeRun(ok(HELLO, '+OK 0', '+DATA 0 0 1', '1 きょう きょう', '', '+DATA 0 1 1', '1 きょう きょう', '', '+DATA 0 1 1', '1 きょう きょう', '', '+DATA 0 1', 'きょう', '', ...NO_SEGMENT, ...NO_SEGMENT))

    await anthyEngine(run, AGENT).convert('きょう', [[0, -1], [0, 1]])

    expect(calls[0]?.stdin.split('\n').filter(line => line.startsWith('RESIZE-SEGMENT'))).toEqual(['RESIZE-SEGMENT 0 0 1', 'RESIZE-SEGMENT 0 0 0'])
  })

  test('convert replays the resizes before reading the candidates', async () => {
    const { run, calls } = fakeRun(
      ok(
        HELLO,
        '+OK 0',
        '+DATA 0 0 2',
        '17 今日は きょうは',
        '18 良い いい',
        '',
        '+DATA 0 2 3',
        '106 今日 きょう',
        '3 は は',
        '18 良い いい',
        '',
        '+DATA 0 1',
        '今日',
        '',
        '+DATA 0 1',
        'は',
        '',
        '+DATA 0 1',
        '良い',
        '',
        ...NO_SEGMENT,
        ...NO_SEGMENT,
        ...NO_SEGMENT,
      ),
    )

    const segments = await anthyEngine(run, AGENT).convert('きょうはいい', [[0, -1]])

    expect({ segments, stdin: calls[0]?.stdin }).toEqual({
      segments: [{ candidates: ['今日'] }, { candidates: ['は'] }, { candidates: ['良い'] }],
      stdin: lines('NEW-CONTEXT INPUT=#18 OUTPUT=#18', 'CONVERT 0 きょうはいい', 'RESIZE-SEGMENT 0 0 1', ...candidateRequests(6), 'QUIT').replaceAll('\r', ''),
    })
  })

  test('commit converts, replays the resizes, selects each segment’s choice and commits so the agent learns it', async () => {
    const { run, calls } = fakeRun(ok(HELLO, '+OK 0', '+DATA 0 0 2', '17 今日は きょうは', '18 良い いい', '', '+OK', '+OK', '+OK'))

    await anthyEngine(run, AGENT).commit('きょうはいい', [], [0, 1])

    expect(calls.map(call => call.stdin)).toEqual([
      lines('NEW-CONTEXT INPUT=#18 OUTPUT=#18', 'CONVERT 0 きょうはいい', 'SELECT-CANDIDATE 0 0 0', 'SELECT-CANDIDATE 0 1 1', 'COMMIT 0 0', 'QUIT').replaceAll('\r', ''),
    ])
  })

  test('a commit whose answer stops before the COMMIT answer rejects', async () => {
    const { run } = fakeRun(ok(HELLO, '+OK 0', '+DATA 0 0 2', '17 今日は きょうは', '18 良い いい', '', '+OK', '+OK'))

    const failed = await failureOf(anthyEngine(run, AGENT).commit('きょうはいい', [], [0, 1]))

    expect(failed).toBe('vime: anthy-agent answered something unexpected: (nothing)')
  })

  test('an error the agent answers rejects with that line', async () => {
    const { run } = fakeRun(ok(HELLO, '+OK 0', '-ERR 1 convert failed.'))

    const failed = await failureOf(anthyEngine(run, AGENT).convert('きょう', []))

    expect(failed).toBe('vime: anthy-agent: -ERR 1 convert failed.')
  })

  test('an agent that exits non-zero rejects with its exit code and the first line it wrote to stderr', async () => {
    const { run } = fakeRun({ exitCode: 1, stdout: '', stderr: 'Segmentation fault\nmore\n' })

    const failed = await failureOf(anthyEngine(run, AGENT).convert('きょう', []))

    expect(failed).toBe('vime: anthy-agent exited with 1: Segmentation fault')
  })

  test('an answer cut short rejects, naming what came instead', async () => {
    const { run } = fakeRun(ok(HELLO, '+OK 0'))

    const failed = await failureOf(anthyEngine(run, AGENT).convert('きょう', []))

    expect(failed).toBe('vime: anthy-agent answered something unexpected: (nothing)')
  })

  test('a reading too long for one egg command line rejects without starting the agent', async () => {
    const { run, calls } = fakeRun(KYOUHAII)

    const failed = await failureOf(anthyEngine(run, AGENT).convert('あ'.repeat(167), []))

    expect({ failed, calls }).toEqual({
      failed: 'vime: the reading is too long to convert at once (over 500 bytes)',
      calls: [],
    })
  })

  test('with no agent found, each conversion rejects with how to get one', async () => {
    const { run, calls } = fakeRun(KYOUHAII)

    const failed = await failureOf(anthyEngine(run, undefined).convert('きょう', []))

    expect({ failed, calls }).toEqual({
      failed: 'vime: anthy-agent not found: install anthy-unicode (anthy-agent-unicode) or anthy (anthy-agent), or set VIME_ANTHY_AGENT',
      calls: [],
    })
  })
})

describe('findAgent', () => {
  // Answers `--version` only for the commands listed, and keeps what was asked.
  function probing(...present: string[]) {
    const asked: (readonly string[])[] = []
    const probe = async (argv: readonly string[]) => {
      asked.push(argv)
      return present.includes(argv[0]!)
    }
    return { probe, asked }
  }

  test('prefers anthy-agent-unicode, then anthy-agent, by whether they answer --version', async () => {
    const both = probing('anthy-agent-unicode', 'anthy-agent')
    const plain = probing('anthy-agent')

    const found = [await findAgent(both.probe, undefined), await findAgent(plain.probe, undefined)]

    expect({ found, asked: [both.asked, plain.asked] }).toEqual({
      found: ['anthy-agent-unicode', 'anthy-agent'],
      asked: [
        [['anthy-agent-unicode', '--version']],
        [
          ['anthy-agent-unicode', '--version'],
          ['anthy-agent', '--version'],
        ],
      ],
    })
  })

  test('VIME_ANTHY_AGENT names the only agent tried', async () => {
    const custom = probing('/opt/anthy/bin/anthy-agent')
    const missing = probing('anthy-agent-unicode')

    const found = [await findAgent(custom.probe, '/opt/anthy/bin/anthy-agent'), await findAgent(missing.probe, '/nowhere/anthy-agent')]

    expect({ found, asked: missing.asked }).toEqual({
      found: ['/opt/anthy/bin/anthy-agent', undefined],
      asked: [['/nowhere/anthy-agent', '--version']],
    })
  })
})
