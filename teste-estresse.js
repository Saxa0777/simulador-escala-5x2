// Estresse: varre meses, tamanhos de equipe, turnos e combinações de dados
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function fakeEl(){ return { addEventListener(){}, appendChild(){}, remove(){}, click(){}, querySelectorAll(){return[];}, querySelector(){return{value:'',checked:false};}, style:{}, dataset:{}, closest(){return null;}, classList:{add(){},remove(){}}, set innerHTML(v){}, get innerHTML(){return'';}, set textContent(v){}, get textContent(){return'';}, scrollIntoView(){}, focus(){} }; }
const sandbox = { console, setTimeout, clearTimeout, Date, Math,
  document:{ addEventListener(){}, getElementById(){return fakeEl();}, createElement(){return fakeEl();}, querySelectorAll(){return[];}, body:fakeEl(), documentElement:fakeEl(), fullscreenElement:null },
  window:{ scrollTo(){}, print(){} }, URL:{ createObjectURL(){return'';}, revokeObjectURL(){} }, Blob:class{} };
sandbox.window.document = sandbox.document;
vm.createContext(sandbox); vm.runInContext(script, sandbox);
const { diasNoMes, diaSemana, mesAnterior, lerFolgas, estadoInicial, gerarEscala,
        validar, checarFixas, checarDados, distribuirCiclos, pontuarEscala, pisoDiasVazios,
        diagnosticoDomingos } = sandbox;
// mesmos prazos que gerar() usa
const LIMITE_TEMPO = vm.runInContext('LIMITE_TEMPO_MS', sandbox);
const LIMITE_CURTO = vm.runInContext('LIMITE_CURTO_MS', sandbox);

function preparar(lista, y, m, R){
  const N = diasNoMes(y,m);
  const pa = mesAnterior(y,m), pN = diasNoMes(pa.y,pa.m);
  const dw=[null]; for(let d=1;d<=N;d++) dw[d]=diaSemana(y,m,d);
  const funcs = lista.map(f => {
    const fx = lerFolgas(f.fixas||'', N);
    const turno = f.turno || 'manha';
    const o = { nome:f.nome, turno, fech:turno==='fech', inter:turno==='inter',
                fixa:new Set([...fx.reg,...fx.comp]),
                semPrev: !f.prev || f.prev.trim()==='' };
    if(o.semPrev) o.init = {sc:0, sr:0, wf:0, last:false};
    else { const pv = lerFolgas(f.prev, pN); o.init = estadoInicial(y,m,pv); }
    o.init.parcial = (dw[1]+6)%7 > 0;
    return o;
  });
  if(funcs.some(f=>f.semPrev)) distribuirCiclos(funcs, N, dw, R);
  return {funcs, N, dw};
}

function auditar(nome, funcs, offs, N, dw, R){
  const probs = [];
  const fer = d => !!(R.feriado && R.feriado.has(d));
  funcs.forEach((f,i) => {
    validar(offs[i], N, dw, f.init, f.fixa, R).forEach(e => probs.push(`${f.nome}: ${e}`));
    let sc=f.init.sc, wf=f.init.wf, w0=!!f.init.parcial;
    for(let d=1; d<=N; d++){
      const isOff = !!offs[i][d], h = fer(d);
      if(h && !isOff) probs.push(`${f.nome}: não está de folga no feriado ${d}`);
      if(dw[d]===0){
        const base = sc >= R.maxDom ? 3 : 2;
        const alvo = (h && sc >= R.maxDom && !R.ferConta) ? base-1 : base;
        const tot = wf + (isOff && !(h && !R.ferConta) ? 1 : 0);
        if(w0 ? tot > alvo : tot !== alvo) probs.push(`${f.nome}: semana do dom ${d} com ${tot} folgas (esperado ${w0?'<=':'='} ${alvo})`);
        if(!f.fixa.has(d) && !h){
          if(sc >= R.maxDom && !isOff) probs.push(`${f.nome}: deveria folgar o domingo ${d}`);
          if(sc < R.maxDom && isOff) probs.push(`${f.nome}: folgou o domingo ${d} cedo demais`);
        }
        sc = h ? (sc >= R.maxDom ? 0 : sc) : (isOff ? (f.fixa.has(d) ? sc : 0) : sc+1);
        wf = 0; w0 = false;
      } else wf += (isOff && !(h && !R.ferConta)) ? 1 : 0;
    }
    for(let d=1; d<N; d++){
      if(offs[i][d] && offs[i][d+1] && !fer(d) && !fer(d+1)) probs.push(`${f.nome}: folgas casadas ${d}/${d+1}`);
    }
    let seq=0;
    for(let d=1; d<=N; d++){
      if(offs[i][d] && !f.fixa.has(d)) seq=0;
      else if(!f.fixa.has(d)){ seq++; if(seq>R.maxSeq) probs.push(`${f.nome}: ${seq} dias seguidos até ${d}`); }
    }
  });
  for(let d=1; d<=N; d++){
    if(fer(d)) continue;   // feriado: todo mundo folga, o limite não se aplica
    const c = offs.filter(o=>o[d]).length;
    if(c > R.maxFolga) probs.push(`dia ${d}: ${c} folgas > ${R.maxFolga}`);
    for(const g of ['fech','inter']){
      const cg = funcs.filter((f,i)=>f.turno===g && offs[i][d]).length;
      if(cg > R.maxTurno) probs.push(`dia ${d}: ${cg} do turno ${g} de folga > ${R.maxTurno}`);
    }
  }
  if(probs.length) console.log(`  !! ${nome}: ${probs.slice(0,3).join(' | ')}${probs.length>3?' …':''}`);
  return probs.length;
}

let total=0, gerou=0, ruim=0, lento=0, acimaPiso=0, somaVazios=0, somaPiso=0;
const falhas={}, exemplosAcima=[];
const nomes = ['A','B','C','D','E','F','G','H','I'];
const TURNOS_MODO = {
  semPrev: i => 'manha',
  comPrev: i => 'manha',
  misto:   i => 'manha',
  fech:    i => i<2 ? 'fech' : 'manha',
  inter:   i => i<2 ? 'inter' : 'manha',
  turnos:  i => ['fech','inter','manha','inter','fech','manha','inter','manha','manha'][i],
  fixas:   i => 'manha',
};
for(const R of [{maxFolga:2,maxSeq:5,maxDom:3,maxTurno:1},{maxFolga:3,maxSeq:5,maxDom:3,maxTurno:1},{maxFolga:2,maxSeq:6,maxDom:2,maxTurno:1}]){
  const nMax = Math.min(9, 3*R.maxFolga);
  for(let y=2026; y<=2027; y++){
    for(let m=1; m<=12; m++){
      for(let n=1; n<=nMax; n++){
        for(const modo of Object.keys(TURNOS_MODO)){
          const lista = [];
          for(let i=0;i<n;i++){
            const o = {nome:nomes[i], turno:TURNOS_MODO[modo](i)};
            if(modo==='comPrev' || (modo==='misto' && i%2===0)) o.prev = [4,11,18,25].join(', ');
            if(modo==='fixas' && i===0) o.fixas = '10, 22';
            lista.push(o);
          }
          // feriados: um terço sem, um terço com um, um terço com dois (metade contando como folga)
          const modoFer = (m + n) % 3;
          const R2 = Object.assign({}, R);
          R2.feriado = new Set(modoFer===0 ? [] : modoFer===1 ? [25] : [8,25]);
          R2.feriadoNome = new Map([[25,'Natal']]);
          R2.ferConta = ((m + n) % 2 === 0);
          const {funcs, N, dw} = preparar(lista, y, m, R2);
          const rotulo = `${m}/${y} n=${n} cap=${R2.maxFolga} maxDom=${R2.maxDom} ${modo} fer=${modoFer} conta=${R2.ferConta?1:0}`;
          const errs = checarDados(funcs, N, R2);
          funcs.forEach(f => checarFixas(f.fixa, f.init, dw, N, R2).forEach(e => errs.push(`${f.nome}: ${e}`)));
          if(errs.length) continue;  // dados de teste inviáveis de propósito
          total++;
          const t0 = Date.now();
          // igual a gerar(): se o diagnóstico já prova que não há solução, busca curta
          const previo = diagnosticoDomingos(funcs, N, dw, R2);
          const offs = gerarEscala(funcs, N, dw, R2, previo.length ? LIMITE_CURTO : LIMITE_TEMPO);
          const ms = Date.now()-t0;
          if(ms > 1200){ lento++; console.log(`  lento: ${rotulo} (${ms}ms)`); }
          if(!offs){
            const k = modo+'/'+R.maxFolga;
            falhas[k] = (falhas[k]||0)+1;
            if(modo==='semPrev' || modo==='inter' || modo==='turnos' || modo==='fech') console.log('  não gerou: '+rotulo);
            continue;
          }
          gerou++;
          ruim += auditar(rotulo, funcs, offs, N, dw, R2);
          // equilíbrio
          const s = pontuarEscala(offs, N, R2);
          const piso = pisoDiasVazios(funcs, offs, N, dw, R2).piso;
          somaVazios += s.vazios; somaPiso += piso;
          if(s.vazios > piso){
            acimaPiso++;
            if(exemplosAcima.length < 6) exemplosAcima.push(`${rotulo}: ${s.vazios} dias vazios, piso ${piso}`);
          }
        }
      }
    }
  }
}
console.log('não gerou por modo/cap:', JSON.stringify(falhas));
if(exemplosAcima.length) console.log('acima do piso (amostra):\n  ' + exemplosAcima.join('\n  '));
console.log(`\ncenários: ${total} | gerou: ${gerou} | escalas com erro: ${ruim} | lentos(>1,2s): ${lento}`);
console.log(`dias sem ninguém de folga: ${somaVazios} no total, ${somaPiso} cobertos pelo limite inferior calculado | acima do limite inferior em ${acimaPiso} de ${gerou} escalas (${(100*acimaPiso/gerou).toFixed(1)}%) — o limite não considera a regra de dias seguidos, então nem tudo aí é evitável`);
console.log(ruim===0 ? 'NENHUMA ESCALA INVÁLIDA' : 'HÁ ESCALAS INVÁLIDAS');
process.exit(ruim===0 ? 0 : 1);
