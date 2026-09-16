const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../js/deck');
require('../js/poker');
require('../js/game');

// Exercise the shipped presentation helpers without requiring a browser or DOM.
const source = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  function winningPots('), source.indexOf('  function showWinner(')), context);
const summarize = game => JSON.parse(JSON.stringify(context.winningPlayers(game)));

test('A folded small blind creates layers but the winner is shown only once', () => {
  const game = new Holdem.Game(3, {random: () => 0.4});
  game.act('call'); game.act('fold'); game.act('check');
  while (!game.finished) game.act(game.legalActions().check ? 'check' : 'call');
  assert.equal(game.results.length, 2);
  const before = JSON.stringify(game);
  const winners = summarize(game);
  assert.equal(winners.length, 1);
  assert.equal(winners[0].chips, 500);
  assert.equal(winners[0].pots.length, 2);
  assert.equal(JSON.stringify(game), before);
});
test('Split pots keep their individual odd chips, and refunds are not winnings', () => {
  const game = {players:[{id:0,name:'A'},{id:1,name:'B'}], results:[
    {amount:303,winners:[1,0],name:'Straight'},
    {amount:201,winners:[1,0],name:'Straight'},
    {amount:100,winners:[0],refund:true}
  ]};
  const winners = summarize(game);
  assert.equal(winners.length,2);
  assert.equal(winners.find(w=>w.player.id===1).chips,253);
  assert.equal(winners.find(w=>w.player.id===0).chips,251);
});
test('Different side-pot winners stay separate even with identical nicknames', () => {
  const game = {players:[{id:0,name:'Same'},{id:1,name:'Same'}],results:[
    {amount:300,winners:[0],name:'Flush'},
    {amount:400,winners:[1],name:'Two Pair'},
    {amount:200,winners:[1],name:'Two Pair'}
  ]};
  const winners = summarize(game);
  assert.equal(winners.length,2);
  assert.equal(winners[0].chips,300);
  assert.equal(winners[1].chips,600);
});
