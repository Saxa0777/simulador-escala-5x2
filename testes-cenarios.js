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
        checarFixas, gerarEscala, validar, diagnosticoDomingos,
        distribuirCiclos, semanasDoMes } = sandbox;

// replica exatamente o que gerar() faz com a lista de pessoas
function montarFuncs(lista, y, m, R){
  const N = diasNoMes(y,m);
  const pa = mesAnterior(y,m), pN = diasNoMes(pa.y,pa.m);
  const dw = [null];
  for(let d=1; d<=N; d++) dw[d] = diaSemana(y,m,d);
  const funcs = lista.map(f => {
    const fx = lerFolgas(f.fixas||'', N);
    const o = {
      nome: f.nome, fech: !!f.fech,
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

function testar(nome, lista, y, m, R, esperaFalha=false){
  const {funcs, N, dw} = montarFuncs(lista, y, m, R);
  console.log(`\n=== ${nome} | ${m}/${y} | domingos: ${Array.from({length:N},(_,i)=>i+1).filter(d=>dw[d]===0).join(',')} ===`);
  funcs.forEach(f => console.log(`  ${f.nome}: sc=${f.init.sc} sr=${f.init.sr} wf=${f.init.wf} parcial=${!!f.init.parcial} fech=${f.fech}`));
  funcs.forEach(f => {
    const e = checarFixas(f.fixa, f.init, dw, N, R);
    verificar(e.length===0, `${f.nome} checarFixas: ${e.join('; ')}`);
  });
  const t0 = Date.now();
  const offs = gerarEscala(funcs, N, dw, R);
  const ms = Date.now()-t0;
  console.log(`  geração: ${offs?'OK':'FALHOU'} (${ms}ms)`);
  if(esperaFalha){
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
    let sc = f.init.sc, wf = f.init.wf, w0 = !!f.init.parcial, primeira = true;
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
        wf = 0; w0 = false; primeira = false;
      } else wf += isOff?1:0;
    }
    for(let d=1; d<N; d++) verificar(!(offs[i][d] && offs[i][d+1]), `${f.nome} folgas casadas ${d}/${d+1}`);
    console.log(`  ${f.nome}: ${offs[i].filter(Boolean).length} folgas no mês`);
  });
  for(let d=1; d<=N; d++){
    const c = offs.filter(o => o[d]).length;
    verificar(c <= R.maxFolga, `dia ${d}: ${c} folgas > limite ${R.maxFolga}`);
    const cf = funcs.filter((f,i) => f.fech && offs[i][d]).length;
    verificar(cf <= 1, `dia ${d}: ${cf} pessoas do fechamento de folga`);
  }
  console.log('  OK');
}

const R = { maxFolga: 2, maxSeq: 5, maxDom: 3 };

testar('A: 3 funcs, prev vazio (caso do usuário)', [{nome:'A'},{nome:'B'},{nome:'C'}], 2026, 12, R);
testar('B: 6 funcs, dados do exemplo', [
  {nome:'Ana', fech:true, prev:'4, 6, 8, 11, 13, 18, 20, 22c, 25, 27, 29'},
  {nome:'Bruno'},
  {nome:'Carla', fech:true, prev:'3, 5, 10, 12, 17, 19, 22, 24, 26'},
  {nome:'Diego'}, {nome:'Eduarda'}, {nome:'Fábio'}
], 2026, 12, R);
testar('C: 3 funcs, prev escalonado', [{nome:'A',prev:'29'},{nome:'B',prev:'22'},{nome:'C',prev:'15'}], 2026, 12, R);
testar('D: 2 funcs, prev vazio', [{nome:'A'},{nome:'B'}], 2026, 12, R);
testar('E: 3 funcs, prev vazio, Nov/2026 (mês começa no domingo)', [{nome:'A'},{nome:'B'},{nome:'C'}], 2026, 11, R);
testar('F: 4 funcs, prev vazio, 2 no fechamento', [{nome:'A',fech:true},{nome:'B',fech:true},{nome:'C'},{nome:'D'}], 2026, 12, R);
testar('G: 3 funcs, prev vazio, com compensações fixas', [{nome:'A',fixas:'10, 25'},{nome:'B',fixas:'12'},{nome:'C'}], 2026, 12, R);
testar('H: 3 funcs, prev vazio, maxDom=2', [{nome:'A'},{nome:'B'},{nome:'C'}], 2026, 12, {maxFolga:2, maxSeq:5, maxDom:2});
testar('I: 5 funcs, prev vazio, cap=3', [{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'},{nome:'E'}], 2026, 12, {maxFolga:3, maxSeq:5, maxDom:3});
testar('J: 3 funcs, prev vazio, Fev/2027', [{nome:'A'},{nome:'B'},{nome:'C'}], 2027, 2, R);
testar('K: 3 funcs, prev vazio, Mar/2026 (começa no domingo)', [{nome:'A'},{nome:'B'},{nome:'C'}], 2026, 3, R);
testar('L: 3 funcs, prev vazio, Ago/2026 (começa no sábado)', [{nome:'A'},{nome:'B'},{nome:'C'}], 2026, 8, R);
testar('M: 4 funcs, prev vazio, Jul/2026 (começa na quarta)', [{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'}], 2026, 7, R);
testar('N: 3 funcs, prev vazio, Jun/2026 (começa na segunda)', [{nome:'A'},{nome:'B'},{nome:'C'}], 2026, 6, R);
// 6 pessoas com limite 2: dá, mas só porque a 1ª semana é parcial
testar('O: 6 funcs prev vazio, Dez/2026, cap=2',
  [{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'},{nome:'E'},{nome:'F'}], 2026, 12, R);
// inviável de propósito: 7 pessoas com limite 2 (14 folgas de seg a sáb, cabem 12)
testar('P: 7 funcs prev vazio, cap=2 (espera diagnóstico)',
  [{nome:'A'},{nome:'B'},{nome:'C'},{nome:'D'},{nome:'E'},{nome:'F'},{nome:'G'}], 2026, 12, R, true);

console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
