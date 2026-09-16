'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Rooms} = require('../server/rooms');
const {createServer} = require('../server');

function table(count = 2, options) {
  const rooms = new Rooms(options);
  const sessions = [rooms.create(count)];
  for (let i=1;i<count;i++) sessions.push(rooms.join(sessions[0].code));
  const room=rooms.get(sessions[0].code);
  const send=(id,command,extra={})=>rooms.command(room,room.members[id],{command,revision:room.revision,...extra});
  const view=id=>rooms.view(room,room.members[id]);
  return {rooms,sessions,room,send,view};
}
for(const count of [2,3,4]) test(`${count} separate sessions, start, personalized cards, full hand and next`,()=>{
  const t=table(count);t.send(0,'start');
  for(let id=0;id<count;id++) {
    const state=t.view(id);
    assert.equal(state.game.players[id].cards.length,2);
    state.game.players.filter(p=>p.id!==id).forEach(p=>{assert.deepEqual(p.cards,[]);assert.equal(p.hand,null);});
    assert.equal('deck' in state.game,false);assert.equal('token' in state.members[0],false);
  }
  while(!t.room.game.finished) {const g=t.room.game;t.send(g.actor,'act',{action:g.legalActions().check?'check':'call'});}
  assert(t.view(0).game.players.every(p=>p.cards.length===2&&p.hand));
  assert.equal(t.room.game.players.reduce((s,p)=>s+p.chips,0),count*10000);
  t.send(0,'next');assert.equal(t.view(0).game.handNumber,2);
  assert.deepEqual(t.view(0).game.players[1].cards,[]);
});
test('Room capacity, isolation, missing rooms, and token authentication',()=>{
  const t=table();assert.throws(()=>t.rooms.join(t.room.code),/가득/);
  const other=t.rooms.create(2);
  assert.throws(()=>t.rooms.authenticate(t.room.code,other.token),/세션/);
  assert.throws(()=>t.rooms.authenticate('MISSING',t.sessions[0].token),/없거나/);
  assert.equal(t.rooms.authenticate(t.room.code,t.sessions[0].token).member.id,0);
  assert.throws(()=>t.rooms.create(5));
});
test('Host-only commands, full lobby requirement and no mid-hand reset',()=>{
  const rooms=new Rooms();const s=rooms.create(3),r=rooms.get(s.code);
  assert.throws(()=>rooms.command(r,r.members[0],{command:'start',revision:r.revision}));
  const t=table();assert.throws(()=>t.send(1,'start'),/방장/);t.send(0,'start');
  assert.throws(()=>t.send(0,'reset'),/종료/);assert.throws(()=>t.send(0,'next'));
  assert.throws(()=>t.rooms.join(t.room.code),/시작/);
  t.send(0,'act',{action:'fold'});assert.throws(()=>t.send(1,'next'),/방장/);
  t.send(0,'reset');assert.equal(t.room.game.handNumber,1);assert.equal(t.room.game.pot,300);
});
test('Wrong seat, invalid actions and stale/replayed requests do not mutate chips',()=>{
  const t=table();t.send(0,'start');const before=JSON.stringify(t.room.game.players);
  assert.throws(()=>t.send(1,'act',{action:'allin'}),/자신의 턴/);
  assert.throws(()=>t.send(0,'act',{action:'raise',amount:999999}));
  assert.throws(()=>t.send(0,'act',{action:'raise',amount:'600'}));
  assert.equal(JSON.stringify(t.room.game.players),before);
  const revision=t.room.revision;t.send(0,'act',{action:'call'});
  assert.throws(()=>t.rooms.command(t.room,t.room.members[0],{command:'act',action:'call',revision}),/변경/);
});
test('Folded hole cards remain secret even after showdown',()=>{
  const t=table(3);t.send(0,'start');t.send(0,'act',{action:'fold'});
  while(!t.room.game.finished){const g=t.room.game;t.send(g.actor,'act',{action:g.legalActions().check?'check':'call'});}
  assert.deepEqual(t.view(1).game.players[0].cards,[]);assert.equal(t.view(1).game.players[0].hand,null);
  assert.equal(t.view(0).game.players[0].cards.length,2);
});
test('Timeout auto-fold/check; same token reconnects to same seat; idle rooms expire',()=>{
  let now=0;const t=table(2,{clock:()=>now,turnMs:60000,idleMs:1000000});t.send(0,'start');
  const token=t.sessions[0].token;now=61000;t.rooms.sweep();assert(t.room.game.finished);assert(t.room.game.players[0].folded);
  const recovered=t.rooms.authenticate(t.room.code,token);assert.equal(recovered.member.id,0);assert(t.view(0).game.finished);
  t.send(0,'next');t.send(t.room.game.actor,'act',{action:'call'});
  now+=61000;t.rooms.sweep();assert.equal(t.room.game.phase,'Flop');
  assert(t.room.game.logs.some(log=>log.includes('Check')));
  now+=1000001;t.rooms.sweep();assert.throws(()=>t.rooms.get(t.room.code),/없거나/);
});

test('Nicknames survive start, next hand, reset and reconnection',()=>{
  const rooms=new Rooms();const first=rooms.create(2,'  홀덤왕  ');const second=rooms.join(first.code,'친구: 김');
  const room=rooms.get(first.code);
  const send=(command,extra={})=>rooms.command(room,room.members[0],{command,revision:room.revision,...extra});
  send('start');assert.equal(room.game.players[0].name,'홀덤왕');assert.equal(room.game.players[1].name,'친구: 김');
  assert(room.game.logs.some(log=>log.includes('홀덤왕')));
  send('act',{action:'fold'});send('next');assert.equal(room.game.players[1].name,'친구: 김');
  rooms.command(room,room.members[room.game.actor],{command:'act',action:'fold',revision:room.revision});
  send('reset');assert.equal(room.game.players[0].name,'홀덤왕');
  assert.equal(rooms.authenticate(first.code,second.token).member.name,'친구: 김');
});
test('Blank nicknames default to seat names; malformed and oversized values rejected',()=>{
  const rooms=new Rooms();const first=rooms.create(3,' \t\n ');rooms.join(first.code,'\u200b ');rooms.join(first.code);
  assert.deepEqual(rooms.get(first.code).members.map(member=>member.name),['Player 1','Player 2','Player 3']);
  assert.throws(()=>rooms.create(2,'a'.repeat(21)),/20/);
  assert.throws(()=>rooms.create(2,{name:'bad'}),/문자열/);
  assert.equal(rooms.rooms.size,1);
});
test('Names remain plain data, including markup and punctuation',()=>{
  const rooms=new Rooms();const first=rooms.create(2,'<b>나</b>');rooms.join(first.code,'나: Check');
  const room=rooms.get(first.code);rooms.command(room,room.members[0],{command:'start',revision:room.revision});
  assert.equal(rooms.view(room,room.members[1]).game.players[0].name,'<b>나</b>');
});
test('HTTP integration: independent clients, authorization, privacy, duplicate action, assets',async()=>{
  const {server}=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(route,body,token) {
    const headers={};if(body) headers['Content-Type']='application/json';if(token) headers.Authorization=`Bearer ${token}`;
    const response=await fetch(base+route,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  }
  try {
    const a=(await request('/api/create',{count:2,nickname:'방장'})).data;
    const b=(await request('/api/join',{code:a.code,nickname:'  '})).data;
    const statePath=`/api/state?code=${a.code}`,commandPath=`/api/command?code=${a.code}`;
    assert.equal((await request(statePath)).status,401);
    let state=(await request(statePath,undefined,a.token)).data;
    assert.equal((await request(commandPath,{command:'start',revision:state.revision},b.token)).status,403);
    state=(await request(commandPath,{command:'start',revision:state.revision},a.token)).data;
    const other=(await request(statePath,undefined,b.token)).data;
    assert.equal(state.game.players[0].name,'방장');assert.equal(other.game.players[1].name,'Player 2');
    assert.equal(state.game.players[0].cards.length,2);assert.deepEqual(state.game.players[1].cards,[]);
    assert.equal(other.game.players[1].cards.length,2);assert.deepEqual(other.game.players[0].cards,[]);
    const move={command:'act',action:'call',revision:state.revision};
    const results=await Promise.all([request(commandPath,move,a.token),request(commandPath,move,a.token)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const cross=await fetch(base+commandPath,{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'});assert.equal(cross.status,403);
    for(const asset of ['/','/style.css','/js/ui.js']) assert.equal((await fetch(base+asset)).status,200);
    for(const secret of ['/server.js','/server/rooms.js','/js/game.js','/README.md']) assert.equal((await fetch(base+secret)).status,404);
    const malformed=await fetch(base+'/api/create',{method:'POST',headers:{'Content-Type':'application/json'},body:'null'});assert.equal(malformed.status,400);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
