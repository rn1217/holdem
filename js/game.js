(() => {
  class Game {
    constructor(count = 2, options = {}) {
      if (![2, 3, 4].includes(count)) throw new Error('2~4명을 선택하세요.');
      this.random = options.random || Math.random;
      this.players = Array.from({length: count}, (_, id) => ({id, name: options.names?.[id] || `Player ${id + 1}`, chips: 10000, retired: Boolean(options.retired?.[id])}));
      this.forfeitedChips = 0;
      this.forfeitRetiredChips();
      this.dealer = -1;
      this.handNumber = 0;
      this.logs = [];
      this.phase = 'Ready';
      this.finished = true;
      this.nextHand();
    }
    log(message) { this.logs.push(message); }
    forfeitRetiredChips() {
      // Unbet chips are removed, not awarded to another player or added to a pot.
      for (const player of this.players) {
        if (player.retired) {
          this.forfeitedChips += player.chips;
          player.chips = 0;
        }
      }
    }
    nextSeat(from, predicate) {
      for (let offset = 1; offset <= this.players.length; offset++) {
        const index = (from + offset + this.players.length) % this.players.length;
        if (predicate(this.players[index])) return index;
      }
      return null;
    }
    get contenders() { return this.players.filter(p => p.inHand && !p.folded); }
    get pot() { return this.players.reduce((sum, p) => sum + (p.totalBet || 0), 0); }
    pay(player, amount) {
      amount = Math.min(amount, player.chips);
      player.chips -= amount;
      player.streetBet += amount;
      player.totalBet += amount;
      player.allIn = player.chips === 0;
      return amount;
    }
    nextHand() {
      if (!this.finished) throw new Error('현재 핸드가 진행 중입니다.');
      if (this.players.filter(p => p.chips > 0 && !p.retired).length < 2) return;
      this.dealer = this.nextSeat(this.dealer, p => p.chips > 0 && !p.retired);
      this.handNumber++;
      this.finished = false;
      this.champion = null;
      this.phase = 'Pre-Flop';
      this.board = [];
      this.results = [];
      this.awardedPot = 0;
      this.deck = Holdem.shuffle(Holdem.createDeck(), this.random);
      for (const p of this.players) Object.assign(p, {inHand: p.chips > 0 && !p.retired, folded: false, allIn: false, streetBet: 0, totalBet: 0, cards: [], lastAction: '', actedAt: null, hand: null});
      const active = p => p.inHand;
      this.smallBlind = this.contenders.length === 2 ? this.dealer : this.nextSeat(this.dealer, active);
      this.bigBlind = this.nextSeat(this.smallBlind, active);
      this.log(`— Hand ${this.handNumber} · Dealer: ${this.players[this.dealer].name} —`);
      for (const [seat, amount, label] of [[this.smallBlind, 100, 'Small Blind'], [this.bigBlind, 200, 'Big Blind']]) {
        const p = this.players[seat];
        const paid = this.pay(p, amount);
        p.lastAction = `${label} ${paid}${p.allIn ? ' · All-In' : ''}`;
        this.log(`${p.name} posts ${p.lastAction}`);
      }
      let seat = this.dealer;
      for (let i = 0; i < this.contenders.length * 2; i++) {
        seat = this.nextSeat(seat, active);
        this.players[seat].cards.push(Holdem.draw(this.deck));
      }
      this.currentBet = 200; // A short big blind does not reduce the pre-flop bring-in.
      this.minRaise = 200;
      this.pending = new Set(this.contenders.filter(p => !p.allIn).map(p => p.id));
      this.resolve(this.bigBlind);
    }
    canRaise(p) {
      return this.contenders.some(other => other.id !== p.id && !other.allIn) &&
        (p.actedAt === null || p.actedAt === 0 || this.currentBet - p.actedAt >= this.minRaise);
    }
    legalActions() {
      if (this.finished || this.actor === null) return null;
      const p = this.players[this.actor];
      const due = Math.max(0, this.currentBet - p.streetBet);
      const max = p.streetBet + p.chips;
      const raiseAllowed = this.canRaise(p);
      return {due, call: Math.min(due, p.chips), min: this.currentBet + this.minRaise, max,
        check: due === 0, raise: raiseAllowed && max >= this.currentBet + this.minRaise,
        allIn: max <= this.currentBet || raiseAllowed};
    }
    act(action, total) {
      const legal = this.legalActions();
      if (!legal) throw new Error('행동할 수 있는 턴이 아닙니다.');
      const p = this.players[this.actor];
      const oldBet = this.currentBet;
      if (action === 'fold') { p.folded = true; p.lastAction = 'Fold'; }
      else if (action === 'check') {
        if (!legal.check) throw new Error('콜할 금액이 있어 Check할 수 없습니다.');
        p.lastAction = 'Check';
      } else if (action === 'call') {
        if (!legal.due) throw new Error('Check를 선택하세요.');
        const paid = this.pay(p, legal.call);
        p.lastAction = `Call ${paid}${p.allIn ? ' · All-In' : ''}`;
      } else if (action === 'raise' || action === 'allin') {
        const target = action === 'allin' ? legal.max : Number(total);
        if (action === 'allin' && !legal.allIn) throw new Error('짧은 All-In 이후에는 레이즈가 다시 열리지 않습니다.');
        if (action === 'raise' && (!legal.raise || !Number.isSafeInteger(target) || target < legal.min || target > legal.max))
          throw new Error(`Raise 총액은 ${legal.min}~${legal.max} 사이 정수여야 합니다.`);
        if (target > oldBet && !this.canRaise(p)) throw new Error('현재 레이즈할 수 없습니다.');
        this.pay(p, target - p.streetBet);
        p.lastAction = `${p.allIn ? 'All-In' : 'Raise'} to ${p.streetBet}`;
        if (p.streetBet > oldBet) {
          const increment = p.streetBet - oldBet;
          if (increment >= this.minRaise) this.minRaise = increment;
          this.currentBet = p.streetBet;
          // Short all-ins require calls but only a full cumulative raise reopens raising.
          this.contenders.filter(other => other.id !== p.id && !other.allIn && other.streetBet < this.currentBet)
            .forEach(other => this.pending.add(other.id));
        }
      } else throw new Error('알 수 없는 행동입니다.');
      p.actedAt = this.currentBet;
      this.log(`${p.name}: ${p.lastAction}`);
      this.pending.delete(p.id);
      this.resolve(p.id);
    }
    resolve(after) {
      if (this.contenders.length === 1) { this.settle(false); return; }
      for (const id of this.pending) {
        const p = this.players[id];
        if (p.folded || p.allIn) this.pending.delete(id);
      }
      const able = this.contenders.filter(p => !p.allIn);
      if (able.length === 1 && able[0].streetBet >= this.currentBet) this.pending.clear();
      if (!this.pending.size) { this.advanceStreet(); return; }
      this.actor = this.nextSeat(after, p => this.pending.has(p.id));
      // A disconnected seat folds only when its next action is due.
      if (this.players[this.actor].retired) this.act('fold');
    }
    advanceStreet() {
      if (this.phase === 'River') { this.settle(true); return; }
      Holdem.draw(this.deck); // Burn one card before each community street.
      const count = this.phase === 'Pre-Flop' ? 3 : 1;
      this.phase = this.phase === 'Pre-Flop' ? 'Flop' : this.phase === 'Flop' ? 'Turn' : 'River';
      for (let i = 0; i < count; i++) this.board.push(Holdem.draw(this.deck));
      this.log(`${this.phase}: ${this.board.map(Holdem.cardText).join(' ')}`);
      this.currentBet = 0;
      this.minRaise = 200;
      this.players.forEach(p => { p.streetBet = 0; p.actedAt = null; });
      this.pending = new Set(this.contenders.filter(p => !p.allIn).map(p => p.id));
      if (this.pending.size < 2) this.pending.clear();
      this.resolve(this.dealer);
    }
    settle(showdown) {
      this.phase = showdown ? 'Showdown' : this.phase;
      this.showdown = showdown;
      this.actor = null;
      this.finished = true;
      this.awardedPot = this.pot;
      if (showdown) for (const p of this.contenders) p.hand = Holdem.evaluate([...p.cards, ...this.board]);
      // Contribution layers include folded money, but folded players cannot win.
      const levels = [...new Set(this.players.map(p => p.totalBet).filter(Boolean))].sort((a, b) => a - b);
      let previous = 0;
      this.results = [];
      for (const level of levels) {
        const contributors = this.players.filter(p => p.totalBet >= level);
        const amount = (level - previous) * contributors.length;
        previous = level;
        if (contributors.length === 1) {
          const p = contributors[0];
          p.chips += amount;
          this.results.push({amount, winners: [p.id], refund: true, name: '미콜 베팅 반환'});
          this.log(`${p.name}: uncalled ${amount} returned`);
          continue;
        }
        let eligible = contributors.filter(p => !p.folded && p.inHand);
        if (!showdown) eligible = this.contenders;
        let winners = [eligible[0]];
        for (const p of eligible.slice(1)) {
          const comparison = Holdem.compare(p.hand.score, winners[0].hand.score);
          if (comparison > 0) winners = [p];
          else if (comparison === 0) winners.push(p);
        }
        // Odd chips go clockwise from the dealer, starting at the dealer's left.
        winners.sort((a, b) => ((a.id - this.dealer - 1 + this.players.length) % this.players.length) - ((b.id - this.dealer - 1 + this.players.length) % this.players.length));
        const share = Math.floor(amount / winners.length);
        let remainder = amount % winners.length;
        const name = showdown ? winners[0].hand.name : '상대 전원 Fold';
        for (const p of winners) {
          const prize = share + (remainder-- > 0 ? 1 : 0);
          p.chips += prize;
          this.log(`${p.name} wins ${prize.toLocaleString('en-US')} chips with ${name}`);
        }
        this.results.push({amount, winners: winners.map(p => p.id), name, refund: false});
      }
      this.players.forEach(p => { p.totalBet = 0; });
      this.forfeitRetiredChips();
      const remaining = this.players.filter(p => p.chips > 0 && !p.retired);
      this.champion = remaining.length === 1 ? remaining[0].id : null;
    }
  }
  Holdem.Game = Game;
})();
