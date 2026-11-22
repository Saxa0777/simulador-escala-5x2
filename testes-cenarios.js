// Testa o JS extraído de index.html com um DOM mínimo
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function fakeEl(){
  return {
    addEventListener(){}, appendChild(){}, remove(){}, click(){},
    querySelectorAll(){ return []; },
    querySelector(){ return {value:'', checked:false}; },
    style:{}, dataset:{}, closest(){ return null; },
    classList:{ add(){}, remove(){} },
    set innerHTML(v){}, get innerHTML(){ return ''; },
    set textContent(v){}, get textContent(){ return ''; },
    scrollIntoView(){}, focus(){},
  };
}
const sandbox = {
  console, setTimeout, clearTimeout, Date, Math,
  document: {
    addEventListener(){},
    getElementById(){ return fakeEl(); },
    createElement(){ return fakeEl(); },
    querySelectorAll(){ return []; },
    body: fakeEl(), documentElement: fakeEl(),
    fullscreenElement: null,
  },
  window: { scrollTo(){}, print(){} },
  URL: { createObjectURL(){ return ''; }, revokeObjectURL(){} },
  Blob: class {},
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(script, sandbox);

const { diasNoMes, diaSemana, mesAnterior, lerFolgas, estadoInicial,
        checarFixas, checarDados, gerarEscala, validar, diagnosticoDomingos,
        distribuirCiclos, pontuarEscala, pisoDiasVazios } = sandbox;

// replica exatamente o que gerar() faz com a lista de pessoas
function montarFuncs(lista, y, m, R){
  const N = diasNoMes(y,m);
  const pa = mesAnterior(y,m), pN = diasNoMes(pa.y,pa.m);
  const dw = [null];
  for(let d=1; d<=N; d++) dw[d] = diaSemana(y,m,d);
  const funcs = lista.map(f => {
    const fx = lerFolgas(f.fixas||'', N);
    const turno = f.turno || 'manha';
    const o = {
      nome: f.nome, turno,
      fech: turno === 'fech', inter: turno === 'inter',
      fixa: new Set([...fx.reg, ...fx.comp]),
      semPrev: !f.prev || f.prev.trim()===''
    };
    if(o.semPrev){
      o.init = {sc:0, sr:0, wf:0, last:false};
    } else {
      const pv = lerFolgas(f.prev, pN);
      o.init = estadoInicial(y,m,pv);
      if(pv.reg.size===0) o.init.sr = 0;
    }
    o.init.parcial = (dw[1]+6)%7 > 0;
    return o;
  });
  if(funcs.some(f => f.semPrev)) distribuirCiclos(funcs, N, dw, R);
  return {funcs, N, dw};
}

let falhas = 0;
function verificar(cond, msg){
  if(!cond){ console.log('  FALHA: ' + msg); falhas++; }
}

function testar(nome, lista, y, m, R, opts={}){
  const {funcs, N, dw} = montarFuncs(lista, y, m, R);
  console.log(`\n=== ${nome} | ${m}/${y} | domingos: ${Array.from({length:N},(_,i)=>i+1).filter(d=>dw[d]===0).join(',')} ===`);
  funcs.forEach(f => console.log(`  ${f.nome} (${f.turno}): sc=${f.init.sc} sr=${f.init.sr} parcial=${!!f.init.parcial}`));
  funcs.forEach(f => {
    const e = checarFixas(f.fixa, f.init, dw, N, R);
    verificar(e.length===0, `${f.nome} checarFixas: ${e.join('; ')}`);
  });
  // checagem de dados da equipe (mesma que gerar() faz antes de gerar)
  const errDados = checarDados(funcs, N, R);
  if(errDados.length){
    console.log('  dados inválidos: ' + errDados.join('; '));
    if(opts.esperaDadosInvalidos) console.log('  OK (esperado)');
    else verificar(false, 'dados inválidos sem espera: ' + errDados.join('; '));
    return;
  }
  verificar(!opts.esperaDadosInvalidos, 'esperava dados inválidos, mas passaram');
  const t0 = Date.now();
  const offs = gerarEscala(funcs, N, dw, R);
  const ms = Date.now()-t0;
  console.log(`  geração: ${offs?'OK':'FALHOU'} (${ms}ms)`);
  if(opts.esperaFalha){
    verificar(!offs, 'esperava falha, mas gerou');
    console.log('  diagnóstico:', JSON.stringify(diagnosticoDomingos(funcs, N, dw, R)));
    return;
  }
  verificar(!!offs, 'geração retornou null — diagnóstico: ' + JSON.stringify(diagnosticoDomingos(funcs, N, dw, R)));
  if(!offs) return;

  funcs.forEach((f,i) => {
    const e = validar(offs[i], N, dw, f.init, f.fixa, R);
    verificar(e.length===0, `${f.nome} validar(): ${e.join('; ')}`);
  });

  // checagens independentes das regras
  funcs.forEach((f,i) => {
    let sc = f.init.sc, wf = f.init.wf, w0 = !!f.init.parcial;
    for(let d=1; d<=N; d++){
      const isOff = !!offs[i][d];
      if(dw[d]===0){
        const alvo = sc >= R.maxDom ? 3 : 2;
        const tot = wf + (isOff?1:0);
        if(w0) verificar(tot <= alvo, `${f.nome} 1ª semana parcial até dom ${d}: ${tot} folgas > teto ${alvo}`);
        else verificar(tot === alvo, `${f.nome} semana até dom ${d}: ${tot} folgas, esperado ${alvo}`);
        if(!f.fixa.has(d)){
          if(sc >= R.maxDom && !isOff) verificar(false, `${f.nome} deveria ter folgada no domingo ${d}`);
          if(sc < R.maxDom && isOff) verificar(false, `${f.nome} folgou o domingo ${d} cedo demais`);
          sc = isOff ? 0 : sc+1;
        }
        wf = 0; w0 = false;
      } else wf += isOff?1:0;
    }
    for(let d=1; d<N; d++) verificar(!(offs[i][d] && offs[i][d+1]), `${f.nome} folgas casadas ${d}/${d+1}`);
  });
  for(let d=1; d<=N; d++){
    const c = offs.filter(o => o[d]).length;
    verificar(c <= R.maxFolga, `dia ${d}: ${c} folgas > limite ${R.maxFolga}`);
  }
  for(const g of ['fech','inter']){
    const doGrupo = funcs.filter(f => f.turno === g);
    if(!doGrupo.length) continue;
    for(let d=1; d<=N; d++){
      const c = funcs.filter((f,i) => f.turno === g && offs[i][d]).length;
      verificar(c <= R.maxTurno, `dia ${d}: ${c} pessoas do turno ${g} de folga (limite ${R.maxTurno})`);
    }
  }

  // equilíbrio: dias sem ninguém de folga
  const s = pontuarEscala(offs, N);
  const piso = pisoDiasVazios(funcs, offs, N, dw, R).piso;
  const diasVazios = [];
  for(let d=1; d<=N; d++) if(!offs.some(o => o[d])) diasVazios.push(d);
  console.log(`  dias sem ninguém de folga: ${diasVazios.length} (mínimo possível ${piso}) -> ${diasVazios.join(',') || 'nenhum'} | variação por dia: ${s.spread}`);
  verificar(diasVazios.length >= piso, `menos dias vazios (${diasVazios.length}) que o mínimo calculado (${piso}) — o piso está errado`);
  if(opts.maxVazios !== undefined) verificar(diasVazios.length <= opts.maxVazios, `esperava no máximo ${opts.maxVazios} dia(s) sem folga, vieram ${diasVazios.length}`);
  console.log('  OK');
}

const R  = { maxFolga: 2, maxSeq: 5, maxDom: 3, maxTurno: 1 };
const R3 = { maxFolga: 3, maxSeq: 5, maxDom: 3, maxTurno: 1 };

testar('A: 3 funcs, prev vazio', [{nome:'A'},{nome:'B'},{nome:'C'}], 2026, 12, R);
testar('B: 6 funcs, dados do exemplo (2 fech + 2 inter)', [
  {nome:'Ana', turno:'fech', prev:'4, 6, 8, 11, 13, 18, 20, 22c, 25, 27, 29'},
  {nome:'Bruno'},
  {nome:'Carla', turno:'fech', prev:'3, 5, 10, 12, 17, 19, 22, 24, 26'},
  {nome:'Diego', turno:'inter'}, {nome:'Eduarda', turno:'inter'}, {nome:'Fábio'}
], 2026, 12, R);
testar('C: CASO RELATADO — 4 funcs, prev vazio', [{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'}], 2026, 12, R, {maxVazios:0});
testar('D: 3 funcs, prev escalonado', [{nome:'A',prev:'29'},{nome:'B',prev:'22'},{nome:'C',prev:'15'}], 2026, 12, R);
testar('E: 2 funcs, prev vazio', [{nome:'A'},{nome:'B'}], 2026, 12, R);
testar('F: 3 funcs, prev vazio, Nov/2026 (mês começa no domingo)', [{nome:'A'},{nome:'B'},{nome:'C'}], 2026, 11, R);
testar('G: 4 funcs, 2 no fechamento', [{nome:'A',turno:'fech'},{nome:'B',turno:'fech'},{nome:'C'},{nome:'D'}], 2026, 12, R);
testar('H: 3 funcs com compensações fixas', [{nome:'A',fixas:'10, 25'},{nome:'B',fixas:'12'},{nome:'C'}], 2026, 12, R);
testar('I: 3 funcs, maxDom=2', [{nome:'A'},{nome:'B'},{nome:'C'}], 2026, 12, {maxFolga:2, maxSeq:5, maxDom:2, maxTurno:1});
testar('J: 5 funcs, cap=3', [{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'},{nome:'E'}], 2026, 12, R3);
testar('K: 3 funcs, Fev/2027', [{nome:'A'},{nome:'B'},{nome:'C'}], 2027, 2, R);
testar('L: 3 funcs, Mar/2026 (começa no domingo)', [{nome:'A'},{nome:'B'},{nome:'C'}], 2026, 3, R);
testar('M: 3 funcs, Ago/2026 (começa no sábado)', [{nome:'A'},{nome:'B'},{nome:'C'}], 2026, 8, R);
testar('N: 4 funcs, Jul/2026 (começa na quarta)', [{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'}], 2026, 7, R);
testar('O: 3 funcs, Jun/2026 (começa na segunda)', [{nome:'A'},{nome:'B'},{nome:'C'}], 2026, 6, R);
testar('P: 6 funcs prev vazio, cap=2', [{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'},{nome:'E'},{nome:'F'}], 2026, 12, R);
// inviável de propósito: 7 pessoas com limite 2
testar('Q: 7 funcs prev vazio, cap=2 (espera diagnóstico)',
  [{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'},{nome:'E'},{nome:'F'},{nome:'G'}], 2026, 12, R, {esperaFalha:true});
// turnos de cobertura
testar('R: 3 do intermediário + 2 manhã', [
  {nome:'A',turno:'inter'},{nome:'B',turno:'inter'},{nome:'C',turno:'inter'},{nome:'D'},{nome:'E'}
], 2026, 12, R);
testar('S: 1 fechamento + 2 intermediário + 2 manhã', [
  {nome:'A',turno:'fech'},{nome:'B',turno:'inter'},{nome:'C',turno:'inter'},{nome:'D'},{nome:'E'}
], 2026, 12, R);
// intermediário com compensação no mesmo dia do outro intermediário -> deve acusar erro antes
testar('T: 2 intermediários com compensação no mesmo dia (espera falha de dados)', [
  {nome:'A',turno:'inter',fixas:'10'},{nome:'B',turno:'inter',fixas:'10'},{nome:'C'}
], 2026, 12, R, {esperaDadosInvalidos:true});

console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
