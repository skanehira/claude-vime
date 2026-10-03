// Romaji to hiragana (wapuro romaji), ported from vime.nvim lua/vime/romaji.lua.

const TABLE: Record<string, string> = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  sa: 'さ', si: 'し', shi: 'し', su: 'す', se: 'せ', so: 'そ',
  za: 'ざ', zi: 'じ', ji: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  ta: 'た', ti: 'ち', chi: 'ち', tu: 'つ', tsu: 'つ', te: 'て', to: 'と',
  da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', hu: 'ふ', fu: 'ふ', he: 'へ', ho: 'ほ',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  wa: 'わ', wo: 'を', wi: 'うぃ', wu: 'う', we: 'うぇ',
  kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ',
  gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
  sya: 'しゃ', syu: 'しゅ', syo: 'しょ',
  sha: 'しゃ', shu: 'しゅ', sho: 'しょ', she: 'しぇ',
  ja: 'じゃ', ju: 'じゅ', jo: 'じょ', je: 'じぇ',
  jya: 'じゃ', jyi: 'じぃ', jyu: 'じゅ', jye: 'じぇ', jyo: 'じょ',
  zya: 'じゃ', zyu: 'じゅ', zyo: 'じょ',
  tya: 'ちゃ', tyu: 'ちゅ', tyo: 'ちょ', tye: 'ちぇ',
  cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ', che: 'ちぇ',
  cya: 'ちゃ', cyu: 'ちゅ', cyo: 'ちょ',
  dya: 'ぢゃ', dyu: 'ぢゅ', dyo: 'ぢょ',
  nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ',
  hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ',
  bya: 'びゃ', byu: 'びゅ', byo: 'びょ',
  pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ',
  mya: 'みゃ', myu: 'みゅ', myo: 'みょ',
  rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',
  vu: 'ゔ',
  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ',
  la: 'ぁ', li: 'ぃ', lu: 'ぅ', le: 'ぇ', lo: 'ぉ',
  xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ',
  lya: 'ゃ', lyu: 'ゅ', lyo: 'ょ',
  xtu: 'っ', ltu: 'っ', xtsu: 'っ', ltsu: 'っ',
  xwa: 'ゎ', lwa: 'ゎ',
  xn: 'ん',
  ye: 'いぇ',
  '-': 'ー',
  ',': '、', '.': '。', '/': '・', '[': '「', ']': '」',
  zh: '←', zj: '↓', zk: '↑', zl: '→',
  'z-': '〜', 'z,': '‥', 'z.': '…', 'z/': '・', 'z[': '『', 'z]': '』',
}

const VOWELS = ['a', 'i', 'u', 'e', 'o'] as const
type Vowel = (typeof VOWELS)[number]

// Small a-row (ふぁ, つぁ, くぁ ...) and small ya-row (てゃ, でゃ, ふゃ ...).
const SMALL_A: Record<Vowel, string> = { a: 'ぁ', i: 'ぃ', u: 'ぅ', e: 'ぇ', o: 'ぉ' }
const SMALL_Y: Record<Vowel, string> = { a: 'ゃ', i: 'ぃ', u: 'ゅ', e: 'ぇ', o: 'ょ' }

// "Consonant glide + vowel" becomes "base kana + small vowel"; a skipped vowel has a base sound of its own.
function expand(prefix: string, base: string, small: Record<Vowel, string>, skip: readonly Vowel[] = []) {
  for (const v of VOWELS) {
    if (!skip.includes(v)) TABLE[prefix + v] = base + small[v]
  }
}

expand('f', 'ふ', SMALL_A, ['u'])
expand('v', 'ゔ', SMALL_A, ['u'])
expand('ts', 'つ', SMALL_A, ['u'])
expand('wh', 'う', SMALL_A, ['u'])
expand('kw', 'く', SMALL_A)
expand('gw', 'ぐ', SMALL_A)
expand('tw', 'と', SMALL_A)
expand('dw', 'ど', SMALL_A)
expand('q', 'く', SMALL_A)
expand('qw', 'く', SMALL_A)
expand('th', 'て', SMALL_Y)
expand('dh', 'で', SMALL_Y)
expand('fy', 'ふ', SMALL_Y)
expand('vy', 'ゔ', SMALL_Y)

const isConsonant = (ch: string) => /^[bcdfghjkmpqrstvwxyz]$/.test(ch)
const isVowel = (ch: string) => /^[aeiou]$/.test(ch)

/**
 * Converts romaji to hiragana, uppercase read as lowercase.
 *
 * With `isInProgress`, a trailing single `n` stays `n` (the next key decides
 * between な-row and ん, as a real IME shows it while typing); without it, it
 * resolves to ん, which is what a commit takes.
 *
 * Order: the table's longest match (4 to 1 characters), then ん by look-ahead,
 * then っ for a doubled consonant (or tch), and anything else passes through.
 */
export function toKana(input: string, isInProgress = false): string {
  const s = input.toLowerCase()
  let out = ''
  let i = 0
  while (i < s.length) {
    const matched = matchTable(s, i)
    if (matched !== undefined) {
      out += matched.kana
      i += matched.length
      continue
    }
    const c = s[i]!
    const nx = s[i + 1] ?? ''
    if (c === 'n') {
      if (nx === 'n') {
        out += 'ん'
        i += 2
        continue
      }
      const isHeld = nx === '' ? isInProgress : isVowel(nx) || nx === 'y'
      if (!isHeld) {
        out += 'ん'
        i += 1
        continue
      }
    }
    if (isConsonant(c) && (nx === c || (c === 't' && nx === 'c' && s[i + 2] === 'h'))) {
      out += 'っ'
      i += 1
      continue
    }
    out += c
    i += 1
  }
  return out
}

function matchTable(s: string, at: number): { kana: string; length: number } | undefined {
  for (let length = 4; length >= 1; length--) {
    const kana = TABLE[s.slice(at, at + length)]
    if (kana !== undefined) return { kana, length }
  }
  return undefined
}
