import { describe, expect, test } from 'claude-code/testing'

import { candidateByNumber, candidatePage } from './band'

const TWELVE = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

describe('candidatePage', () => {
  test('shows the first nine candidates numbered from 1, the chosen one marked, and where the choice stands', () => {
    const page = candidatePage(TWELVE, 2)

    expect(page).toEqual({
      items: [
        { text: '1:一', isChosen: false },
        { text: '2:二', isChosen: false },
        { text: '3:三', isChosen: true },
        { text: '4:四', isChosen: false },
        { text: '5:五', isChosen: false },
        { text: '6:六', isChosen: false },
        { text: '7:七', isChosen: false },
        { text: '8:八', isChosen: false },
        { text: '9:九', isChosen: false },
      ],
      position: '(3/12)',
    })
  })

  test('turns to the page holding the chosen candidate once the choice moves past nine', () => {
    const page = candidatePage(TWELVE, 10)

    expect(page).toEqual({
      items: [
        { text: '1:十', isChosen: false },
        { text: '2:十一', isChosen: true },
        { text: '3:十二', isChosen: false },
      ],
      position: '(11/12)',
    })
  })
})

describe('candidateByNumber', () => {
  test('answers the candidate a number names on the page holding the chosen one, or nothing past the list', () => {
    const picks = [
      candidateByNumber(TWELVE.length, 2, 1),
      candidateByNumber(TWELVE.length, 2, 9),
      candidateByNumber(TWELVE.length, 10, 3),
      candidateByNumber(TWELVE.length, 10, 4),
    ]

    expect(picks).toEqual([0, 8, 11, undefined])
  })
})
