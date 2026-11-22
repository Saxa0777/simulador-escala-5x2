// Feriados: caminho real exemplo()/addEmp -> gerar() -> render(), com verificação independente
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function el(tag='div'){
  const e = {
    tag, children: [], _html: '', value: '', checked: false,
    style: {}, dataset: {},
    appendChild(c){ this.children.push(c); return c; },
    remove(){}, click(){}, scrollIntoView(){}, focus(){}, closest(){ return null; },
    classList: { add(){}, remove(){}, contains(){ return false; } },
    set innerHTML(v){
      this._html = v; this.children = []; this._q = {};
      const re = /<(input|select)[^>]*class="(e-[a-z]+)"[^>]*>/g;
      let mt;
      while((mt = re.exec(v))){
        const campo = el(mt[1]);
        const vv = mt[0].match(/value="([^"]*)"/);
        campo.value = vv ? vv[1] : '';
        campo.checked = /\bchecked\b/.test(mt[0]);
        if(mt[1] === 'select'){
          const sel = v.slice(re.lastIndex).match(/<option value="([a-z]+)" selected>/);
          campo.value = sel ? sel[1] : 'manha';
        }
        this._q['.'+mt[2]] = campo;
      }
    },
    get innerHTML(){ return this._html; },
    set textContent(v){ this._text = v; }, get textContent(){ return this._text || ''; },
    querySelector(sel){ return this._q[sel] || (this._q[sel] = el('input')); },
    querySelectorAll(){ return []; },
    _q: {},
  };
  return e;
}
const byId = {};
let rows = [];
const doc = {
  addEventListener(){},
  getElementById(id){ return byId[id] || (byId[id] = el('div')); },
  createElement(t){ return el(t); },
  querySelectorAll(sel){ return sel === '.eq-row' ? rows : []; },
  body: el('body'), documentElement: el('html'), fullscreenElement: null,
};
const sandbox = {
  console, setTimeout: (fn) => fn(), clearTimeout, Date, Math, JSON,
  document: doc, window: { scrollTo(){}, print(){} },
  URL: { createObjectURL(){ return 'blob:x'; }, revokeObjectURL(){} },
  Blob: class { constructor(){} },
};
sandbox.window.document = doc;
vm.createContext(sandbox);
vm.runInContext(script, sandbox);

const set = (id, v) => { const e = doc.getElementById(id); e.value = v; };
const { validar, pontuarEscala, pisoDiasVazios } = sandbox;

let falhas = 0;
const verificar = (c, m) => { if(!c){ console.log('  FALHA: ' + m); falhas++; } };

// monta a equipe direto no DOM e gera
function gerarCom(pessoas, cfg){
  set('mes', String(cfg.m)); set('ano', String(cfg.y));
  set('r-cap', String(cfg.cap || 2)); set('r-seq', String(cfg.seq || 5));
  set('r-dom', String(cfg.dom || 3)); set('r-turno', String(cfg.turno || 1));
  set('r-fer', cfg.fer || '');
  doc.getElementById('r-fer-conta').checked = !!cfg.ferConta;
  vm.runInContext('ultimo = null', sandbox);   // não deixar escala antiga contaminar o teste
  byId['lista'].innerHTML = '';
  rows = [];
  pessoas.forEach(p => {
    sandbox.addEmp(p.nome, p.turno || 'manha', p.prev || '', p.fixas || '');
    rows.push(...byId['lista'].children.slice(rows.length));
  });
  sandbox.gerar();
  return vm.runInContext('typeof ultimo === "undefined" ? null : ultimo', sandbox);
}

function auditar(rotulo, u, feriados){
  const {N, dw, funcs, offs, R} = u;
  funcs.forEach((f,i) => {
    validar(offs[i], N, dw, f.init, f.fixa, R).forEach(e => verificar(false, `${rotulo} ${f.nome}: ${e}`));
  });
  // todo mundo de folga no feriado
  feriados.forEach(h => funcs.forEach((f,i) => verificar(!!offs[i][h], `${rotulo} ${f.nome} não está de folga no feriado ${h}`)));
  // regras conferidas por fora, tratando o feriado como dia fechado
  funcs.forEach((f,i) => {
    let sc = f.init.sc, wf = f.init.wf, w0 = !!f.init.parcial;
    for(let d=1; d<=N; d++){
      const fer = feriados.includes(d), isOff = !!offs[i][d];
      if(dw[d]===0){
        const base = sc >= R.maxDom ? 3 : 2;
        const alvo = (fer && sc >= R.maxDom && !R.ferConta) ? base-1 : base;
        const tot = wf + (isOff && !(fer && !R.ferConta) ? 1 : 0);
        if(w0 ? tot > alvo : tot !== alvo){
          verificar(false, `${rotulo} ${f.nome}: semana do dom ${d} tem ${tot} folgas, esperado ${alvo}`);
        }
        if(!f.fixa.has(d) && !fer){
          if(sc >= R.maxDom && !isOff) verificar(false, `${rotulo} ${f.nome}: deveria folgar o domingo ${d}`);
          if(sc < R.maxDom && isOff) verificar(false, `${rotulo} ${f.nome}: folgou o domingo ${d} cedo demais`);
        }
        sc = fer ? (sc >= R.maxDom ? 0 : sc) : (isOff ? (f.fixa.has(d) ? sc : 0) : sc+1);
        wf = 0; w0 = false;
      } else {
        wf += (isOff && !(fer && !R.ferConta)) ? 1 : 0;
      }
    }
    // folgas casadas: feriado não conta
    for(let d=1; d<N; d++){
      if(offs[i][d] && offs[i][d+1] && !feriados.includes(d) && !feriados.includes(d+1)){
        verificar(false, `${rotulo} ${f.nome}: folgas casadas ${d}/${d+1}`);
      }
    }
  });
  // limite por dia, ignorando os feriados
  for(let d=1; d<=u.N; d++){
    if(feriados.includes(d)) continue;
    const c = offs.filter(o => o[d]).length;
    verificar(c <= u.R.maxFolga, `${rotulo} dia ${d}: ${c} folgas > ${u.R.maxFolga}`);
    for(const g of ['fech','inter']){
      const cg = funcs.filter((f,i) => f.turno === g && offs[i][d]).length;
      verificar(cg <= u.R.maxTurno, `${rotulo} dia ${d}: ${cg} do turno ${g} > ${u.R.maxTurno}`);
    }
  }
  const vazios = [];
  for(let d=1; d<=N; d++) if(!feriados.includes(d) && !offs.some(o => o[d])) vazios.push(d);
  const piso = pisoDiasVazios(funcs, offs, N, dw, R).piso;
  console.log(`  ${rotulo}: dias sem ninguém de folga ${vazios.length} (piso ${piso}) -> ${vazios.join(',') || 'nenhum'}`);
  return offs;
}

// ---------- 1. o caso relatado: 25/12 fechado, 4 pessoas, limite 2 ----------
console.log('\n=== 1. 25/12 (Natal) fechado, 4 pessoas, limite 2 por dia ===');
{
  const u = gerarCom([{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'}], {y:2026, m:12, fer:'25 (Natal)'});
  verificar(!!u, 'não gerou — era exatamente o caso que o usuário relatou');
  if(u){
    const offs = auditar('Natal', u, [25]);
    console.log('  folgas por pessoa:', offs.map((o,i) => u.funcs[i].nome+'='+o.map((v,d)=>v?d:null).filter(Boolean).join('/')).join('  '));
    verificar(u.R.feriado.has(25), 'R.feriado não tem o dia 25');
  }
}

// ---------- 2. antes dava erro: comprova que o limite por dia não barra mais ----------
console.log('\n=== 2. o feriado não disputa o limite de folgas por dia ===');
{
  // com limite 1 só uma pessoa folga por dia; no feriado as duas folgam
  const u = gerarCom([{nome:'A'},{nome:'B'}], {y:2026, m:12, cap:1, fer:'25'});
  verificar(!!u, 'não gerou com limite 1 por dia e feriado no 25');
  if(u){
    auditar('cap1', u, [25]);
    verificar(u.offs[0][25] && u.offs[1][25], 'as duas pessoas deveriam folgar no feriado mesmo com limite 1 por dia');
  }
}

// ---------- 3. folga no dia 24 e no 26 ao lado do feriado ----------
console.log('\n=== 3. compensação no dia 24 (véspera) com feriado no 25 ===');
{
  const u = gerarCom([{nome:'A', fixas:'24'},{nome:'B'},{nome:'C'},{nome:'D'}], {y:2026, m:12, fer:'25'});
  verificar(!!u, 'não gerou com compensação na véspera do feriado');
  if(u){
    auditar('vespera', u, [25]);
    verificar(u.offs[0][24] === true, 'A não está de folga no dia 24');
  }
}

// ---------- 4. feriado caindo num domingo ----------
console.log('\n=== 4. feriado num domingo (6/12/2026) ===');
{
  const u = gerarCom([{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'}], {y:2026, m:12, fer:'6'});
  verificar(!!u, 'não gerou com feriado no domingo 6');
  if(u) auditar('domingo', u, [6]);
}

// ---------- 5. feriado conta como folga da semana ----------
console.log('\n=== 5. feriado contando como folga da semana (ferConta) ===');
{
  const u = gerarCom([{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'}], {y:2026, m:12, fer:'25', ferConta:true});
  verificar(!!u, 'não gerou com ferConta');
  if(u){
    auditar('ferConta', u, [25]);
    // na semana 21-27 cada um deve ter 1 folga regular + o feriado (ou 2 + feriado se for a semana do domingo)
    const [ini,fim] = [21,27];
    u.funcs.forEach((f,i) => {
      let reg = 0, dom = 0;
      for(let d=ini; d<=fim; d++){
        if(d===25) continue;
        if(u.offs[i][d]){ reg++; if(u.dw[d]===0) dom = 1; }
      }
      verificar(reg + 1 === (dom ? 3 : 2), `${f.nome}: semana 21-27 tem ${reg} folgas regulares + feriado (esperado ${dom?3:2} no total)`);
    });
  }
}

// ---------- 6. sem ferConta o feriado é extra ----------
console.log('\n=== 6. sem ferConta o feriado é folga a mais ===');
{
  const u = gerarCom([{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'}], {y:2026, m:12, fer:'25'});
  if(u){
    auditar('extra', u, [25]);
    u.funcs.forEach((f,i) => {
      let reg = 0;
      for(let d=21; d<=27; d++){ if(d===25) continue; if(u.offs[i][d]) reg++; }
      // sem ferConta o feriado é extra: precisa das 2 (ou 3, se folgou o domingo 27)
      const esperado = u.offs[i][27] ? 3 : 2;
      verificar(reg === esperado, `${f.nome}: semana 21-27 tem ${reg} folgas regulares, esperado ${esperado}`);
    });
  }
}

// ---------- 7. vários feriados, inclusive 1/1 do mês seguinte não entra ----------
console.log('\n=== 7. dois feriados no mês (8 e 25) ===');
{
  const u = gerarCom([{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'},{nome:'E'}], {y:2026, m:12, fer:'8, 25 (Natal)'});
  verificar(!!u, 'não gerou com dois feriados');
  if(u) auditar('dois', u, [8,25]);
}

// ---------- 8. dia inválido ----------
console.log('\n=== 8. dia inválido no campo de feriado ===');
{
  const u = gerarCom([{nome:'A'},{nome:'B'}], {y:2026, m:12, fer:'32, abc'});
  verificar(!u, 'aceitou dias inválidos no campo de feriado');
  const htmlSaida = String(byId['resultado'].innerHTML);
  verificar(/não é um dia de Dezembro/.test(htmlSaida), 'não avisou que o dia é inválido');
  console.log('  mensagem exibida: ' + (htmlSaida.match(/<li>([^<]*32[^<]*)<\/li>/)||['','(não achou)'])[1]);
}

// ---------- 9. turnos de cobertura + feriado ----------
console.log('\n=== 9. fechamento e intermediário com feriado ===');
{
  const u = gerarCom([{nome:'A',turno:'fech'},{nome:'B',turno:'inter'},{nome:'C',turno:'inter'},{nome:'D'}], {y:2026, m:12, fer:'25'});
  verificar(!!u, 'não gerou com turnos e feriado');
  if(u) auditar('turnos', u, [25]);
}

// ---------- 10. HTML e CSV ----------
console.log('\n=== 10. HTML e CSV mostram o feriado ===');
{
  const u = gerarCom([{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'}], {y:2026, m:12, fer:'25 (Natal)'});
  const h = String(byId['resultado'].innerHTML);
  verificar(/title="Feriado: Natal/.test(h), 'célula do feriado sem o nome no HTML');
  verificar(/<b>F<\/b> feriado/.test(h), 'legenda de feriado ausente');
  verificar(/Feriado\(s\): 25 \(Natal\)/.test(h), 'linha de verificação do feriado ausente');
  let csv = '';
  sandbox.Blob = class { constructor(parts){ csv = parts[0]; } };
  vm.runInContext('Blob', sandbox);
  sandbox.exportarCSV();
  const linhas = csv.replace(/^\uFEFF/, '').split('\r\n');
  const celula25 = linhas[1].split(';')[2 + 24];   // 0=Funcionário, 1=Turno, 2=dia 1 …
  verificar(celula25 === 'F', `CSV: célula do dia 25 é "${celula25}", esperava F`);
  verificar(/^Folgas no dia;;/.test(linhas[linhas.length-1]), 'CSV: linha de folgas por dia ausente');
  console.log('  CSV dia 25 = ' + celula25);
}

console.log(falhas === 0 ? '\nTODOS OS TESTES DE FERIADO PASSARAM' : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
