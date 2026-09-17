const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Rooms} = require('../server/rooms');

function table(count = 3) {
  let now = 0;
  const rooms = new Rooms({clock: () => now});
  const session = rooms.create(count);
  for (let i = 1; i < count; i++) rooms.join(session.code);
  const room = rooms.get(session.code);
  const send = (id, command, extra = {}) => rooms.command(room, room.members[id], {command, revision: room.revision, ...extra});
  send(0, 'start');
  return {rooms, room, send,
    at(time, connected) { now = time; connected.forEach(id => {room.members[id].lastSeen = now;}); rooms.sweep(); },
    total() {return room.game.pot + room.game.players.reduce((sum,p) => sum+p.chips, 0);}
  };
}
function finish(t) {
  let actions = 0;
  while (!t.room.game.finished) {
    assert(++actions < 100);
    const game = t.room.game;
    t.send(game.actor, 'act', {action: game.legalActions().check ? 'check' : 'call'});
  }
}
test('Short disconnect and refresh within grace do not retire a player', () => {
  const t = table();t.at(19000,[1,2]);
  t.rooms.authenticate(t.room.code,t.room.members[0].token);
  t.at(21000,[1,2]);
  assert(!t.room.members[0].retired);assert.equal(t.room.game.actor,0);
});
test('Disconnected actor folds automatically and host transfers', () => {
  const t = table();t.at(20001,[1,2]);
  assert(t.room.game.players[0].retired);assert(t.room.game.players[0].folded);
  assert.equal(t.room.game.actor,1);assert.equal(t.room.host,1);assert.equal(t.total(),30000);
  assert.equal(t.room.deadline,80001);
});
test('Disconnected future actor folds on its next action, then blinds skip it', () => {
  const t = table();t.at(20001,[0,2]);
  assert(t.room.game.players[1].retired);assert(!t.room.game.players[1].folded);
  t.send(0,'act',{action:'call'});
  assert(t.room.game.players[1].folded);assert.equal(t.room.game.actor,2);
  finish(t);t.send(0,'next');
  assert.equal(t.room.game.dealer,2);assert.equal(t.room.game.smallBlind,2);assert.equal(t.room.game.bigBlind,0);
  assert.equal(t.room.game.players[1].cards.length,0);assert.equal(t.room.game.players[1].inHand,false);
  assert.equal(t.total(),30000);
});
test('Retirement stays permanent across reconnect and reset', () => {
  const t = table();t.at(20001,[0,2]);
  const {member} = t.rooms.authenticate(t.room.code,t.room.members[1].token);
  assert(member.retired);assert.throws(()=>t.send(1,'act',{action:'call'}),/리타이어/);
  finish(t);t.send(0,'reset');
  assert(t.room.game.players[1].retired);assert(!t.room.game.players[1].inHand);
  assert.equal(t.room.game.players[1].cards.length,0);
});
test('Heads-up departure finishes the game; remaining player is champion', () => {
  const t = table(2);t.at(20001,[1]);
  assert(t.room.game.finished);assert.equal(t.room.game.champion,1);assert.equal(t.room.host,1);
  assert(t.rooms.view(t.room,t.room.members[1]).game.tournamentOver);
  assert.throws(()=>t.send(1,'next'));assert.throws(()=>t.send(1,'reset'));
  assert.equal(t.total(),20000);
});
test('Everyone disconnecting terminates without zero-contender settlement', () => {
  const t = table(4);t.at(20001,[]);
  assert(t.room.game.finished);assert.equal(t.room.game.champion,null);
  assert(t.rooms.view(t.room,t.room.members[0]).game.tournamentOver);
  assert.equal(t.total(),40000);
});
test('Already all-in player has no further action; current pot eligibility is retained', () => {
  const t = table();t.send(0,'act',{action:'allin'});t.at(20001,[1,2]);
  assert(t.room.game.players[0].retired);assert(t.room.game.players[0].allIn);assert(!t.room.game.players[0].folded);
  finish(t);assert(t.room.game.finished);assert.equal(t.total(),30000);
  assert(t.room.game.players[0].retired);
});
test('Disconnect between hands excludes the player before the next deal', () => {
  const t=table();finish(t);t.at(20001,[1,2]);t.send(1,'next');
  assert.equal(t.room.host,1);assert(!t.room.game.players[0].inHand);
  assert.equal(t.room.game.players[0].cards.length,0);assert.equal(t.total(),30000);
});
