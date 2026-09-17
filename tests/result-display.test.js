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
test('Surrendered pot recipients are not displayed as victorious players', () => {
  const winners=summarize({players:[{id:0,name:'A',retired:true},{id:1,name:'B'}],results:[
    {amount:300,winners:[0],name:'Flush'},{amount:200,winners:[1],name:'One Pair'}
  ]});
  assert.equal(winners.length,1);assert.equal(winners[0].player.id,1);
});
test('Champion appearing after a finished hand opens a final victory once', () => {
  const elements=new Map(),timers=new Map();let nextId=0;const shown=[];
  const get=id=>{if(!elements.has(id))elements.set(id,{open:false,hidden:true,textContent:'',close(){this.open=false;}});return elements.get(id);};
  const runtime=vm.createContext({$:get,state:null,connected:false,offset:0,render(){},
    setTimeout(fn){const id=++nextId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
    capture(game){shown.push(game);}
  });
  vm.runInContext(source.slice(source.indexOf('  const actionNotices ='),source.indexOf('  function card(c,')),runtime);
  vm.runInContext('showWinner = capture;',runtime);
  const flush=()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn();}};
  const hand={code:'ROOM',revision:1,serverTime:0,game:{handNumber:1,finished:true,champion:null,logs:[]}};
  runtime.update(hand);flush();assert.equal(shown.length,1);
  const final={...hand,revision:2,game:{...hand.game,champion:0}};
  runtime.update(final);assert.equal(shown.length,1);flush();
  assert.equal(shown.length,2);assert.equal(shown[1].finalVictoryOnly,true);
  runtime.update(final);flush();assert.equal(shown.length,2);
});
