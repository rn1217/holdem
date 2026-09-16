/* Shared namespace keeps the game usable directly over file://. */
globalThis.Holdem = globalThis.Holdem || {};
(() => {
  const suits = ['♠', '♥', '♦', '♣'];
  const rankLabel = rank => ({11: 'J', 12: 'Q', 13: 'K', 14: 'A'}[rank] || String(rank));
  function createDeck() {
    return suits.flatMap(suit => Array.from({length: 13}, (_, i) => ({rank: i + 2, suit})));
  }
  function shuffle(deck, random = Math.random) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }
  function draw(deck) {
    if (!deck.length) throw new Error('덱에 카드가 없습니다.');
    return deck.pop();
  }
  Object.assign(Holdem, {createDeck, shuffle, draw, rankLabel, cardText: c => rankLabel(c.rank) + c.suit});
})();
