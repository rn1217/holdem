/* Clients receive only their own cards and public state. Game rules run on the server. */
(() => {
  const $ = s => document.querySelector(s);
  const format = n => n.toLocaleString('en-US');
  const rank = n => ({11:'J',12:'Q',13:'K',14:'A'}[n] || String(n));
  const cardText = c => rank(c.rank) + c.suit;
  let session = null, state = null, connected = false, busy = false, hide = false, offset = 0, lastTurn = '';
  try { session = JSON.parse(sessionStorage.getItem('holdem-session')); } catch { /* Storage is optional. */ }
  async function request(route, body, auth = true) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (auth && session) headers.Authorization = `Bearer ${session.token}`;
    const response = await fetch(route, {method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(7000)});
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || '요청 실패'); error.status = response.status; throw error; }
    return data;
  }
  const endpoint = name => `/api/${name}?code=${encodeURIComponent(session.code)}`;

  const actionNotices = [];
  let noticeTimer = null;

  // Compare overlapping history, including when the server's 250-line window rolls.
  // This reads existing public logs only; it never sends commands or changes game state.
  function newActionMessages(previousLogs, currentLogs) {
    let overlap = Math.min(previousLogs.length, currentLogs.length);
    while (overlap > 0 && !previousLogs.slice(-overlap).every((log, i) => log === currentLogs[i])) overlap--;
    return currentLogs.slice(overlap).flatMap(message => {
      const match = /^(Player \d+): (Fold|Check|Call \d+(?: · All-In)?|Raise to \d+|All-In to \d+)$/.exec(message);
      if (!match) return [];
      const action = match[2];
      const kind = action.includes('All-In') ? 'allin' : action.split(' ')[0].toLowerCase();
      const amount = /\d+/.exec(action)?.[0];
      const label = kind === 'allin'
        ? `ALL-IN${amount ? ` · ${Number(amount).toLocaleString('en-US')}${action.startsWith('Call') ? ' Call' : ' 총액'}` : ''}`
        : action.replace(/\d+/, value => Number(value).toLocaleString('en-US'));
      return [{player: match[1], kind, label}];
    });
  }
  function clearActionNotices() {
    clearTimeout(noticeTimer);
    noticeTimer = null;
    actionNotices.length = 0;
    $('#action-notice').hidden = true;
  }
  function showNextActionNotice() {
    if (noticeTimer !== null || !actionNotices.length) return;
    const action = actionNotices.shift();
    const notice = $('#action-notice');
    $('#action-notice-player').textContent = action.player;
    $('#action-notice-label').textContent = action.label;
    notice.className = `action-notice action-notice--${action.kind}`;
    notice.hidden = false;
    noticeTimer = setTimeout(() => {
      notice.hidden = true;
      noticeTimer = null;
      showNextActionNotice();
    }, action.kind === 'allin' ? 3200 : 2200);
  }

  function update(data) {
    if (state && data.revision < state.revision) return;
    const previousGame = state?.game;
    const currentGame = data.game;
    const continuingHand = state?.code === data.code && previousGame && currentGame &&
      previousGame.handNumber === currentGame.handNumber && !(previousGame.finished && !currentGame.finished);
    if (!continuingHand) clearActionNotices();
    else if (data.revision > state.revision) {
      actionNotices.push(...newActionMessages(previousGame.logs, currentGame.logs));
      showNextActionNotice();
    }
    state=data; offset=data.serverTime-Date.now(); connected=true;
    if ($('#setup').open) $('#setup').close();
    render();
  }
  function card(c, empty=false) {
    const el=document.createElement('div');
    el.className=`card ${c?(['♥','♦'].includes(c.suit)?'red':''):empty?'empty':'back'}`;
    el.setAttribute('aria-label',c?cardText(c):'미공개 카드');
    if(c) { const r=document.createElement('span'),s=document.createElement('span');r.textContent=rank(c.rank);s.textContent=c.suit;s.className='suit';el.append(r,s); }
    else el.textContent=empty?'·':'♠';
    return el;
  }
  function line(parent, text, tag='p') { const el=document.createElement(tag);el.textContent=text;parent.append(el);return el; }
  function render() {
    $('#connection').textContent=connected?'● 서버 연결됨':session?'연결 끊김 · 자동 재접속 중':'방을 만들거나 참가하세요';
    if(!state) return;
    $('#room-info').textContent=`방 ${state.code} · 나: Player ${state.you+1}${state.you===state.host?' (방장)':''}`;
    const g=state.game;
    if(!g) {
      if(!$('#lobby').open) $('#lobby').showModal();
      $('#invite-code').textContent=state.code;
      $('#lobby-members').textContent=`${state.members.length} / ${state.count}명 참가 · `+state.members.map(m=>`Player ${m.id+1}${m.online?'':' (연결 끊김)'}`).join(', ');
      $('#start-game').hidden=state.you!==state.host;
      $('#start-game').disabled=busy||!connected||state.members.length!==state.count;
      $('#lobby-hint').textContent=state.you===state.host?'모든 참가자가 입장하면 시작할 수 있습니다.':'방장이 시작하면 자동으로 이동합니다.';
      return;
    }
    if($('#lobby').open) $('#lobby').close();
    $('#hand-label').textContent=`HAND ${g.handNumber} · ${g.players.length} PLAYERS`;
    $('#phase').textContent=g.phase;
    $('#pot-label').textContent=g.finished?'정산된 팟':'현재 팟';
    $('#pot').textContent=format(g.finished?g.awardedPot:g.pot);
    $('#current-bet').textContent=format(g.currentBet);
    $('#board').replaceChildren(...Array.from({length:5},(_,i)=>card(g.board[i],true)));
    $('#players').replaceChildren(...g.players.map(p=>{
      const el=document.createElement('article');el.className=`player${p.id===g.actor?' active':''}${p.folded?' folded':''}${!p.inHand?' eliminated':''}`;
      line(el,`${p.name}${p.id===state.you?' · 나':''}`,'h3');
      line(el,`${format(p.chips)} CHIP`,'div').className='chips';
      line(el,`라운드 ${format(p.streetBet)} · 누적 ${format(p.totalBet)}`,'div').className='bet';
      const badges=document.createElement('div');badges.className='badges';el.append(badges);
      const labels=[];
      if(p.id===g.dealer) labels.push('D · DEALER');if(p.id===g.smallBlind) labels.push('SB');if(p.id===g.bigBlind) labels.push('BB');
      if(p.id===g.actor) labels.push('현재 턴');if(p.folded) labels.push('FOLD');if(p.allIn&&!g.finished) labels.push('ALL-IN');
      if(!p.inHand||(g.finished&&p.chips===0)) labels.push('탈락');
      if(!state.members.find(m=>m.id===p.id)?.online) labels.push('연결 끊김');
      labels.forEach(label=>line(badges,label,'span').className='badge');
      line(el,p.lastAction||'대기 중','div').className='last-action';return el;
    }));
    const me=g.players[state.you];
    $('#hole-cards').replaceChildren(...me.cards.map(c=>card(hide?null:c)));
    $('#hide-cards').hidden=!me.cards.length;$('#hide-cards').textContent=hide?'내 카드 보기':'내 카드 숨기기';
    $('#turn-title').textContent=g.finished?(g.champion!==null?`Player ${g.champion+1} 최종 우승!`:'핸드가 끝났습니다'):g.actor===state.you?'내 차례입니다':`Player ${g.actor+1}의 차례를 기다리는 중`;
    $('#controls').hidden=!g.legal;
    $('#next-hand').hidden=!g.finished||g.champion!==null||state.you!==state.host;
    $('#new-game').hidden=!g.finished||state.you!==state.host;
    $('#next-hand').disabled=$('#new-game').disabled=busy||!connected;
    if(g.legal) {
      const l=g.legal,off=busy||!connected;
      $('[data-action="fold"]').disabled=off;$('[data-action="check"]').disabled=off||!l.check;
      $('#call-button').disabled=off||!l.due;$('#call-button').textContent=`Call ${format(l.call)}${l.call===me.chips?' · All-In':''}`;
      $('[data-action="allin"]').disabled=off||!l.allIn;
      $('#raise-button').disabled=$('#raise-amount').disabled=off||!l.raise;
      $('#raise-amount').min=l.min;$('#raise-amount').max=l.max;
      const turn=`${g.handNumber}:${g.phase}:${state.revision}`;
      if(turn!==lastTurn) { $('#raise-amount').value=l.raise?l.min:'';lastTurn=turn; }
      $('#raise-hint').textContent=l.raise?`최소 ${format(l.min)} / 최대 ${format(l.max)} · 총액 기준`:'현재 Raise할 수 없습니다.';
    }
    $('#result').hidden=!g.finished;$('#result').replaceChildren();
    if(g.finished) {
      line($('#result'),'핸드 결과','h2');let index=0;
      for(const r of g.results) { const label=r.refund?'반환':index++===0?'Main Pot':`Side Pot ${index-1}`;line($('#result'),`${label} ${format(r.amount)} → ${r.winners.map(id=>`Player ${id+1}`).join(' + ')} · ${r.name}`); }
      for(const p of g.players.filter(p=>p.hand)) line($('#result'),`${p.name}: ${p.cards.map(cardText).join(' ')} · ${p.hand.name} · 최강 5장 ${p.hand.cards.map(cardText).join(' ')}`);
      if(state.you!==state.host) line($('#result'),'방장이 다음 핸드 또는 새 게임을 시작할 수 있습니다.');
    }
    const log=$('#log'),bottom=log.scrollHeight-log.scrollTop-log.clientHeight<40;
    log.replaceChildren();g.logs.forEach(message=>line(log,message,'li'));if(bottom) log.scrollTop=log.scrollHeight;
  }
  async function poll() {
    if(session) try { update(await request(endpoint('state'))); }
    catch(error) {
      connected=false;
      if([401,404].includes(error.status)) {
        clearActionNotices();session=null;state=null;try {sessionStorage.removeItem('holdem-session');}catch{}
        if($('#lobby').open) $('#lobby').close();if(!$('#setup').open) $('#setup').showModal();
        $('#setup-error').textContent=error.message;$('#hole-cards').replaceChildren();$('#controls').hidden=true;
      }
      render();
    }
    setTimeout(poll,800);
  }
  async function enter(route,body) {
    if(busy) return;busy=true;$('#setup').querySelectorAll('button').forEach(b=>b.disabled=true);$('#setup-error').textContent='';
    try {
      session=await request(route,body,false);state=null;
      try {sessionStorage.setItem('holdem-session',JSON.stringify(session));}catch{}
      $('#setup').close();update(await request(endpoint('state')));
    } catch(error) {$('#setup-error').textContent=error.message;if(!$('#setup').open) $('#setup').showModal();}
    finally {busy=false;$('#setup').querySelectorAll('button').forEach(b=>b.disabled=false);render();}
  }
  async function command(name,extra={}) {
    if(busy||!connected||!state) return;busy=true;render();$('#error').textContent=$('#lobby-error').textContent='';
    try {update(await request(endpoint('command'),{command:name,revision:state.revision,...extra}));}
    catch(error) {$('#error').textContent=$('#lobby-error').textContent=error.message;try{update(await request(endpoint('state')));}catch{connected=false;}}
    finally {busy=false;render();}
  }
  // This local guide stays open across server updates and never changes game state.
  $('#rank-toggle').addEventListener('click', () => {
    const expanded = $('#rank-toggle').getAttribute('aria-expanded') !== 'true';
    $('#rank-toggle').setAttribute('aria-expanded', String(expanded));
    $('#rank-toggle').textContent = expanded ? '♠ 족보 닫기' : '♠ 족보 보기 · 강한 순서';
    $('#rank-content').hidden = !expanded;
  });
  $('#create-form').addEventListener('submit',e=>{e.preventDefault();enter('/api/create',{count:Number(new FormData(e.currentTarget).get('count'))});});
  $('#join-form').addEventListener('submit',e=>{e.preventDefault();enter('/api/join',{code:$('#room-code').value.trim().toUpperCase()});});
  $('#start-game').addEventListener('click',()=>command('start'));$('#next-hand').addEventListener('click',()=>command('next'));$('#new-game').addEventListener('click',()=>command('reset'));
  document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>command('act',{action:b.dataset.action})));
  $('#raise-form').addEventListener('submit',e=>{e.preventDefault();command('act',{action:'raise',amount:Number($('#raise-amount').value)});});
  $('#hide-cards').addEventListener('click',()=>{hide=!hide;render();});
  [$('#setup'),$('#lobby')].forEach(d=>d.addEventListener('cancel',e=>e.preventDefault()));
  setInterval(()=>{$('#timer').textContent=state?.deadline&&!state.game?.finished?`남은 시간 ${Math.max(0,Math.ceil((state.deadline-Date.now()-offset)/1000))}초`:'';},250);
  $('#board').replaceChildren(...Array.from({length:5},()=>card(null,true)));
  if(location.protocol==='file:') {$('#setup').showModal();$('#setup-error').textContent='멀티플레이 버전은 서버가 필요합니다. node server.js 실행 후 http://localhost:3000으로 접속하세요.';$('#setup').querySelectorAll('button').forEach(b=>b.disabled=true);}
  else {if(!session) $('#setup').showModal();poll();}
})();
