// What the band above the prompt lists while converting: the focused
// segment's candidates, nine to a page, the page holding the chosen one.

const PAGE_SIZE = 9

/** One candidate as the band shows it, `<number>:<candidate>`. */
export type CandidateItem = { text: string; isChosen: boolean }

export type CandidatePage = { items: CandidateItem[]; position: string }

export function candidatePage(list: readonly string[], index: number): CandidatePage {
  const first = Math.floor(index / PAGE_SIZE) * PAGE_SIZE
  const items = list.slice(first, first + PAGE_SIZE).map((text, i) => ({
    text: `${i + 1}:${text}`,
    isChosen: first + i === index,
  }))
  return { items, position: `(${index + 1}/${list.length})` }
}
