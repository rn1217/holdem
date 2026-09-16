/* Run with Node.js: node tests/run-tests.js (no packages required). */
require('../js/deck.js');
require('../js/poker.js');
require('../js/game.js');
const assert = require('node:assert/strict');
const {Game, evaluate, compare, createDeck, shuffle, cardText} = Holdem;
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }
function cards(text) {
  return text.split(' ').map(value => ({rank: ({A:14,K:13,Q:12,J:11,T:10}[value.slice(0,-1)] || Number(value.slice(0,-1))), suit: value.slice(-1)}));
}
function seeded(seed = 42) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
function total(game) { return game.players.reduce((sum,p) => sum + p.chips,0) + game.pot; }
function passive(game) {
  let count = 0;
  while (!game.finished) {
    if (++count > 100) throw new Error('진행 루프');
    game.act(game.legalActions().check ? 'check' : 'call');
  }
}
test('52 unique cards and shuffle preserves the deck', () => {
  const deck = shuffle(createDeck(), seeded());
  assert.equal(deck.length,52); assert.equal(new Set(deck.map(cardText)).size,52);
});
const categories = [
 ['High Card','A♠ J♥ 9♦ 5♣ 3♠ 7♥ 2♦'],
 ['One Pair','A♠ A♥ 9♦ 5♣ 3♠ 7♥ 2♦'],
 ['Two Pair','A♠ A♥ 9♦ 9♣ 3♠ 7♥ 2♦'],
 ['Three of a Kind','A♠ A♥ A♦ 5♣ 3♠ 7♥ 2♦'],
 ['Straight','9♠ 8♥ 7♦ 6♣ 5♠ A♥ 2♦'],
 ['Flush','A♠ J♠ 9♠ 5♠ 3♠ 7♥ 2♦'],
 ['Full House','A♠ A♥ A♦ 5♣ 5♠ 7♥ 2♦'],
 ['Four of a Kind','A♠ A♥ A♦ A♣ 3♠ 7♥ 2♦'],
 ['Straight Flush','9♠ 8♠ 7♠ 6♠ 5♠ A♥ 2♦'],
 ['Royal Flush','A♠ K♠ Q♠ J♠ T♠ 7♥ 2♦']
];
for (const [name, hand] of categories) test(name, () => assert.equal(evaluate(cards(hand)).name,name));
test('Wheel is five high, and loses to six high', () => {
  const wheel = evaluate(cards('A♠ 2♥ 3♦ 4♣ 5♠ K♥ Q♦'));
  assert.deepEqual(wheel.score,[4,5]);
  assert.equal(compare(wheel.score,evaluate(cards('2♠ 3♥ 4♦ 5♣ 6♠')).score),-1);
});
test('Kickers, two trips, three pairs, flush kicker, and board tie', () => {
  assert.equal(compare(evaluate(cards('A♠ A♥ K♣ Q♦ J♣')).score,evaluate(cards('A♦ A♣ K♥ Q♥ T♣')).score),1);
  assert.deepEqual(evaluate(cards('A♠ A♥ A♦ K♠ K♥ K♦ 2♣')).score,[6,14,13]);
  assert.deepEqual(evaluate(cards('A♠ A♥ K♠ K♥ Q♠ Q♥ 2♣')).score,[2,14,13,12]);
  assert.equal(compare(evaluate(cards('A♠ J♠ 9♠ 6♠ 4♠')).score,evaluate(cards('A♥ J♥ 9♥ 6♥ 3♥')).score),1);
  const board = cards('A♠ K♠ Q♠ J♠ T♠');
  assert.equal(compare(evaluate([...board,...cards('2♦ 3♦')]).score,evaluate([...board,...cards('9♥ 9♦')]).score),0);
});
for (const count of [2,3,4]) test(`${count} players: all call/check, dealing, next hand, dealer and blinds`, () => {
  const g = new Game(count,{random:seeded()});
  assert.equal(g.dealer,0);
  assert.equal(g.smallBlind,count === 2 ? 0 : 1);
  assert.equal(g.bigBlind,count === 2 ? 1 : 2);
  assert.equal(g.actor,count === 2 ? 0 : (3 % count));
  const dealer = g.dealer;
  passive(g);
  assert.equal(g.phase,'Showdown'); assert.equal(g.board.length,5); assert.equal(total(g),count*10000);
  const dealt = [...g.board,...g.players.flatMap(p=>p.cards)];
  assert.equal(new Set(dealt.map(cardText)).size,dealt.length);
  g.nextHand(); assert.equal(g.dealer,(dealer+1)%count);
  assert.equal(g.smallBlind,count === 2 ? 1 : 2);
  assert.equal(g.bigBlind,count === 2 ? 0 : 3%count);
  assert.equal(g.board.length,0);
});
test('Big blind retains option after everyone calls; postflop starts left of dealer', () => {
  const g = new Game(3); g.act('call');g.act('call');
  assert.equal(g.actor,g.bigBlind); assert.equal(g.phase,'Pre-Flop');
  g.act('check'); assert.equal(g.phase,'Flop'); assert.equal(g.actor,1);
});
test('Raise to 600, calls and rejected illegal actions are atomic', () => {
  const g = new Game(4); const before=JSON.stringify(g.players);
  assert.throws(()=>g.act('check')); assert.throws(()=>g.act('raise',199));
  assert.throws(()=>g.act('raise',10001)); assert.throws(()=>g.act('raise',600.5));
  assert.equal(JSON.stringify(g.players),before);
  g.act('raise',600); assert.equal(g.minRaise,400);
  for(let i=0;i<3;i++) g.act('call');
  assert.equal(g.phase,'Flop');assert.equal(g.pot,2400);passive(g);assert.equal(total(g),40000);
});
test('Fold ends hand immediately, returns unmatched bet and keeps cards private', () => {
  const g = new Game(2);g.act('fold');
  assert.equal(g.finished,true);assert.equal(g.showdown,false);assert.equal(g.board.length,0);
  assert.equal(g.players[1].chips,10100); assert.equal(g.players[0].chips,9900);
  assert.equal(total(g),20000);assert(g.results.some(r=>r.refund&&r.amount===100));
});
test('Multiple folds remove players from subsequent streets', () => {
  const g = new Game(4);g.act('fold');g.act('call');g.act('fold');g.act('check');
  assert.equal(g.phase,'Flop');assert.equal(g.actor,2);passive(g);assert.equal(total(g),40000);
});
test('Short call automatically goes all-in and board runs out', () => {
  const g = new Game(2);g.players[0].chips=50;
  const bank=total(g);g.act('call');
  assert(g.players[0].allIn);assert.equal(g.finished,true);assert.equal(g.board.length,5);assert.equal(total(g),bank);
});
test('Multiple all-ins conserve chips and end game or allow another hand', () => {
  const g = new Game(4,{random:seeded(11)});
  while(!g.finished) g.act('allin');
  assert.equal(total(g),40000);assert.equal(g.board.length,5);
  if(g.champion!==null) {assert.equal(g.players[g.champion].chips,40000); const n=g.handNumber;g.nextHand();assert.equal(g.handNumber,n);}
});
function settlement(contributions, holes, board, folded = []) {
  const g = new Game(contributions.length);g.board=cards(board);g.phase='River';
  g.players.forEach((p,i)=>Object.assign(p,{chips:0,totalBet:contributions[i],streetBet:0,cards:cards(holes[i]),folded:folded.includes(i),inHand:true}));
  g.settle(true);return g;
}
test('1000/3000/5000 side pots: strongest short stack, second stack, uncalled refund', () => {
  const g = settlement([1000,3000,5000],['A♠ A♥','K♠ K♥','Q♠ Q♥'],'2♣ 3♦ 7♠ 8♥ J♣');
  assert.deepEqual(g.players.map(p=>p.chips),[3000,4000,2000]);
  assert.deepEqual(g.results.map(r=>r.amount),[3000,4000,2000]);assert.equal(total(g),9000);
});
test('Folded contributions remain in pots, folded best hand cannot win', () => {
  const g = settlement([1000,3000,3000],['A♠ A♥','K♠ K♥','Q♠ Q♥'],'2♣ 3♦ 7♠ 8♥ J♣',[1]);
  assert.deepEqual(g.players.map(p=>p.chips),[3000,0,4000]);
});
test('Tie and odd chip goes left of dealer', () => {
  const g = settlement([101,101,101],['2♠ 3♥','4♠ 5♥','6♠ 7♥'],'A♦ K♦ Q♦ J♦ T♦',[2]);
  assert.deepEqual(g.players.map(p=>p.chips),[151,152,0]);
});
test('Short raise does not reopen action; a full raise does', () => {
  const g=new Game(3);g.act('raise',600);g.players[1].chips=600;g.act('allin');
  assert.equal(g.currentBet,700);assert.equal(g.minRaise,400);g.act('call');
  assert.equal(g.actor,0);assert.equal(g.legalActions().raise,false);assert.equal(g.legalActions().allIn,false);
  assert.throws(()=>g.act('raise',1100));g.act('call');assert.equal(g.phase,'Flop');
  const h=new Game(3);h.act('raise',600);h.act('raise',1000);h.act('call');assert.equal(h.legalActions().raise,true);
});
test('Cumulative short all-ins reopen betting after a full raise increment', () => {
  const g=new Game(4);g.act('raise',400);g.players[0].chips=500;g.act('allin');
  g.players[1].chips=500;g.act('allin');g.act('call');
  assert.equal(g.currentBet,600);assert.equal(g.actor,3);assert.equal(g.legalActions().raise,true);
});
test('Checking before a short opening all-in retains raise rights', () => {
  const g=new Game(3);g.act('call');g.act('call');g.act('check');
  assert.equal(g.phase,'Flop');g.act('check');g.players[2].chips=100;g.act('allin');g.act('call');
  assert.equal(g.actor,1);assert.equal(g.currentBet,100);assert.equal(g.legalActions().raise,true);
  g.act('raise',300);assert.equal(g.currentBet,300);
});
test('Eliminated seats skipped; heads-up dealer posts small blind', () => {
  const g=new Game(4);g.finished=true;g.players.forEach((p,i)=>p.chips=[0,20000,0,20000][i]);g.dealer=0;g.nextHand();
  assert.equal(g.dealer,1);assert.equal(g.smallBlind,1);assert.equal(g.bigBlind,3);assert.equal(g.actor,1);
  assert.equal(g.players[0].cards.length,0);assert.equal(g.players[2].cards.length,0);
});
test('Short blinds and automatic all-in runout', () => {
  const g=new Game(2);g.finished=true;g.players[0].chips=50;g.players[1].chips=80;g.nextHand();
  assert.equal(g.finished,true);assert.equal(total(g),130);assert.equal(g.board.length,5);
});
test('Seeded tournament simulations: 2/3/4 players, conservation and termination', () => {
  let hands=0;
  for(let seed=1;seed<=40;seed++) for(const count of [2,3,4]) {
    const rng=seeded(seed*997+count);const g=new Game(count,{random:rng});
    for(let hand=0;hand<35;hand++) {
      let steps=0;
      while(!g.finished) {
        assert(++steps<200);const legal=g.legalActions();const r=rng();
        if(r<.1) g.act('fold');
        else if(r<.3&&legal.allIn) g.act('allin');
        else if(r<.5&&legal.raise) g.act('raise',legal.min);
        else g.act(legal.check?'check':'call');
        assert.equal(total(g),count*10000);assert(g.players.every(p=>Number.isInteger(p.chips)&&p.chips>=0));
      }
      hands++;if(g.champion!==null) break;g.nextHand();
    }
  }
  console.log(`  Simulated ${hands} hands`);
});
console.log(`\n${passed} tests passed.`);
