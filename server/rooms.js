'use strict';
const {randomBytes, randomInt} = require('node:crypto');
require('../js/deck.js');
require('../js/poker.js');
require('../js/game.js');

const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const secureRandom = () => randomInt(0, 2 ** 32) / 2 ** 32;
function normalizeNickname(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fail('닉네임은 문자열로 입력하세요.');
  const name = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length > 20) fail('닉네임은 20자 이내로 입력하세요.');
  return name;
}

class Rooms {
  constructor({clock = Date.now, turnMs = 60000, idleMs = 12 * 60 * 60 * 1000} = {}) {
    this.rooms = new Map();
    this.clock = clock;
    this.turnMs = turnMs;
    this.idleMs = idleMs;
  }
  create(count, nickname) {
    const name = normalizeNickname(nickname);
    if (![2, 3, 4].includes(count)) fail('인원은 2~4명이어야 합니다.');
    if (this.rooms.size >= 500) fail('서버의 방이 가득 찼습니다.', 503);
    let code;
    do { code = randomBytes(4).toString('hex').toUpperCase(); } while (this.rooms.has(code));
    const room = {code, count, members: [], host: 0, game: null, revision: 0, deadline: null, touched: this.clock()};
    this.rooms.set(code, room);
    return this.addMember(room, name);
  }
  get(code) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    if (!room) fail('방이 없거나 만료되었습니다.', 404);
    return room;
  }
  join(code, nickname) {
    const name = normalizeNickname(nickname);
    const room = this.get(code);
    if (room.game) fail('이미 시작된 방에는 새로 참가할 수 없습니다.');
    if (room.members.length >= room.count) fail('방이 가득 찼습니다.');
    return this.addMember(room, name);
  }
  addMember(room, nickname) {
    const member = {id: room.members.length, name: nickname || `Player ${room.members.length + 1}`, token: randomBytes(32).toString('hex'), lastSeen: this.clock()};
    room.members.push(member);
    room.touched = this.clock();
    room.revision++;
    return {code: room.code, token: member.token};
  }
  authenticate(code, token) {
    const room = this.get(code);
    const member = room.members.find(m => m.token === token);
    if (!member) fail('참가 세션이 올바르지 않습니다.', 401);
    member.lastSeen = room.touched = this.clock();
    this.tick(room);
    return {room, member};
  }
  setDeadline(room) {
    room.deadline = room.game && !room.game.finished ? this.clock() + this.turnMs : null;
  }
  tick(room) {
    if (room.deadline !== null && this.clock() >= room.deadline && !room.game.finished) {
      const game = room.game;
      game.log(`${game.players[game.actor].name}: 시간 초과 (자동 Check/Fold)`);
      game.act(game.legalActions().check ? 'check' : 'fold');
      room.revision++;
      this.setDeadline(room);
    }
  }
  sweep() {
    for (const [code, room] of this.rooms) {
      if (this.clock() - room.touched > this.idleMs) this.rooms.delete(code);
      else this.tick(room);
    }
  }
  command(room, member, body) {
    if (body.revision !== room.revision) fail('상태가 변경되었습니다. 최신 화면에서 다시 선택하세요.', 409);
    const game = room.game;
    if (['start', 'next', 'reset'].includes(body.command)) {
      if (member.id !== room.host) fail('방장만 실행할 수 있습니다.', 403);
      if (body.command === 'start') {
        if (game || room.members.length !== room.count) fail('모든 참가자가 입장한 뒤 시작하세요.');
        room.game = new Holdem.Game(room.count, {random: secureRandom, names: room.members.map(member => member.name)});
      } else if (body.command === 'next') {
        if (!game || !game.finished || game.champion !== null) fail('다음 핸드를 시작할 수 없습니다.');
        game.nextHand();
      } else {
        if (!game || !game.finished) fail('핸드 종료 후에만 새 게임을 시작할 수 있습니다.');
        room.game = new Holdem.Game(room.count, {random: secureRandom, names: room.members.map(member => member.name)});
      }
    } else if (body.command === 'act') {
      if (!game || game.finished || game.actor !== member.id) fail('자신의 턴에만 행동할 수 있습니다.', 403);
      if (body.action === 'raise' && !Number.isSafeInteger(body.amount)) fail('Raise 금액은 정수여야 합니다.');
      game.act(body.action, body.amount);
    } else fail('지원하지 않는 명령입니다.');
    room.revision++;
    this.setDeadline(room);
    // Bound history in long-running rooms; current hand history is retained in normal play.
    if (room.game.logs.length > 1000) room.game.logs = room.game.logs.slice(-1000);
  }
  view(room, member) {
    const g = room.game;
    const state = {
      code: room.code, count: room.count, you: member.id, host: room.host,
      revision: room.revision, deadline: room.deadline, serverTime: this.clock(),
      members: room.members.map(m => ({id: m.id, name: m.name, online: this.clock() - m.lastSeen < 10000})),
      game: null
    };
    if (!g) return state;
    // Explicit allowlist: never serialize the engine, deck, tokens or unrevealed hands.
    state.game = {
      phase: g.phase, handNumber: g.handNumber, board: g.board, pot: g.pot,
      currentBet: g.currentBet, dealer: g.dealer, smallBlind: g.smallBlind, bigBlind: g.bigBlind,
      actor: g.actor, finished: g.finished, champion: g.champion, awardedPot: g.awardedPot,
      showdown: Boolean(g.finished && g.showdown), results: g.results, logs: g.logs.slice(-250),
      legal: member.id === g.actor && !g.finished ? g.legalActions() : null,
      players: g.players.map(p => {
        const publicHand = Boolean(g.finished && g.showdown && p.inHand && !p.folded);
        return {id: p.id, name: p.name, chips: p.chips, inHand: p.inHand,
          folded: p.folded, allIn: p.allIn, streetBet: p.streetBet, totalBet: p.totalBet,
          lastAction: p.lastAction, cards: p.id === member.id || publicHand ? p.cards : [],
          hand: publicHand ? p.hand : null};
      })
    };
    return state;
  }
}
module.exports = {Rooms};
