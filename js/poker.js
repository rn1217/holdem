(() => {
  const names = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush'];
  function compare(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const difference = (a[i] || 0) - (b[i] || 0);
      if (difference) return Math.sign(difference);
    }
    return 0;
  }
  function evaluateFive(cards) {
    const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
    const counts = new Map();
    ranks.forEach(r => counts.set(r, (counts.get(r) || 0) + 1));
    const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const flush = cards.every(c => c.suit === cards[0].suit);
    const unique = [...counts.keys()];
    let straight = unique.length === 5 && unique[0] - unique[4] === 4 ? unique[0] : 0;
    if (unique.join(',') === '14,5,4,3,2') straight = 5;
    let score;
    if (flush && straight) score = straight === 14 ? [9, 14] : [8, straight];
    else if (groups[0][1] === 4) score = [7, groups[0][0], groups[1][0]];
    else if (groups[0][1] === 3 && groups[1][1] === 2) score = [6, groups[0][0], groups[1][0]];
    else if (flush) score = [5, ...ranks];
    else if (straight) score = [4, straight];
    else if (groups[0][1] === 3) score = [3, ...groups.map(g => g[0])];
    else if (groups[0][1] === 2 && groups[1][1] === 2) score = [2, ...groups.map(g => g[0])];
    else if (groups[0][1] === 2) score = [1, ...groups.map(g => g[0])];
    else score = [0, ...ranks];
    return {score, name: names[score[0]], cards};
  }
  function evaluate(cards) {
    if (cards.length < 5 || cards.length > 7) throw new Error('족보 판정에는 5~7장이 필요합니다.');
    let best;
    // At most 21 combinations: exhaustive evaluation is small and easy to audit.
    for (let a = 0; a < cards.length - 4; a++)
      for (let b = a + 1; b < cards.length - 3; b++)
        for (let c = b + 1; c < cards.length - 2; c++)
          for (let d = c + 1; d < cards.length - 1; d++)
            for (let e = d + 1; e < cards.length; e++) {
              const hand = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
              if (!best || compare(hand.score, best.score) > 0) best = hand;
            }
    return best;
  }
  Object.assign(Holdem, {evaluate, compare});
})();
