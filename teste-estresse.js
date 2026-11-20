// Estresse: varre meses, tamanhos de equipe e combinações de dados
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function fakeEl(){ return { addEventListener(){}, appendChild(){}, remove(){}, click(){}, querySelectorAll(){return[];}, querySelector(){return{value:'',checked:false};}, style:{}, dataset:{}, closest(){return null;}, classList:{add(){},remove(){}}, set innerHTML(v){}, get innerHTML(){return'';}, set textContent(v){}, get textContent(){return'';}, scrollIntoView(){}, focus(){} }; }
const sandbox = { console, setTimeout, clearTimeout, Date, Math,
  document:{ addEventListener(){}, getElementById(){return fakeEl();}, createElement(){return fakeEl();}, querySelectorAll(){return[];}, body:fakeEl(), documentElement:fakeEl(), fullscreenElement:null },
  window:{ scrollTo(){}, print(){} }, URL:{ createObjectURL(){return'';}, revokeObjectURL(){} }, Blob:class{} };
sandbox.window.document = sandbox.document;
vm.createContext(sandbox); vm.runInContext(script, sandbox);
const S = sandbox;
const { diasNoMes, diaSemana, mesAnterior, lerFolgas, estadoInicial, gerarEscala,
        validar, checarFixas, distribuirCiclos } = S;

function preparar(lista, y, m, R){
  const N = diasNoMes(y,m);
  const pa = mesAnterior(y,m), pN = diasNoMes(pa.y,pa.m);
  const dw=[null]; for(let d=1;d<=N;d++) dw[d]=diaSemana(y,m,d);
  const funcs = lista.map(f => {
    const fx = lerFolgas(f.fixas||'', N);
    const o = { nome:f.nome, fech:!!f.fech, fixa:new Set([...fx.reg,...fx.comp]),
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
  funcs.forEach((f,i) => {
    validar(offs[i], N, dw, f.init, f.fixa, R).forEach(e => probs.push(`${f.nome}: ${e}`));
    // regras verificadas de forma independente
    let sc=f.init.sc, wf=f.init.wf, w0=!!f.init.parcial;
    for(let d=1; d<=N; d++){
      const isOff = !!offs[i][d];
      if(dw[d]===0){
        const alvo = sc >= R.maxDom ? 3 : 2, tot = wf + (isOff?1:0);
        if(w0 ? tot > alvo : tot !== alvo) probs.push(`${f.nome}: semana do dom ${d} com ${tot} folgas (esperado ${w0?'<=':'='} ${alvo})`);
        if(!f.fixa.has(d)){
          if(sc >= R.maxDom && !isOff) probs.push(`${f.nome}: deveria folgar o domingo ${d}`);
          if(sc < R.maxDom && isOff) probs.push(`${f.nome}: folgou o domingo ${d} cedo demais (4º domingo é a regra)`);
          sc = isOff ? 0 : sc+1;
        }
        wf = 0; w0 = false;
      } else wf += isOff?1:0;
    }
    for(let d=1; d<N; d++) if(offs[i][d] && offs[i][d+1]) probs.push(`${f.nome}: folgas casadas ${d}/${d+1}`);
    let seq=0;
    for(let d=1; d<=N; d++){ if(offs[i][d] && !f.fixa.has(d)) seq=0; else if(!f.fixa.has(d)) { seq++; if(seq>R.maxSeq) probs.push(`${f.nome}: ${seq} dias seguidos até ${d}`); } }
  });
  for(let d=1; d<=N; d++){
    const c = offs.filter(o=>o[d]).length;
    if(c > R.maxFolga) probs.push(`dia ${d}: ${c} folgas > ${R.maxFolga}`);
    const cf = funcs.filter((f,i)=>f.fech && offs[i][d]).length;
    if(cf > 1) probs.push(`dia ${d}: ${cf} do fechamento de folga`);
  }
  if(probs.length) console.log(`  !! ${nome}: ${probs.slice(0,4).join(' | ')}${probs.length>4?' …':''}`);
  return probs.length;
}

let total=0, gerou=0, ruim=0, lento=0; const falhas={};
const nomes = ['A','B','C','D','E','F','G','H','I'];
for(const R of [{maxFolga:2,maxSeq:5,maxDom:3},{maxFolga:3,maxSeq:5,maxDom:3},{maxFolga:2,maxSeq:6,maxDom:2}]){
  const nMax = Math.min(9, 3*R.maxFolga);
  for(let y=2026; y<=2027; y++){
    for(let m=1; m<=12; m++){
      for(let n=1; n<=nMax; n++){
        for(const modo of ['semPrev','comPrev','misto','fech','fixas']){
          const lista = [];
          for(let i=0;i<n;i++){
            const o = {nome:nomes[i]};
            if(modo==='comPrev' || (modo==='misto' && i%2===0)) o.prev = [4,11,18,25].join(', ');
            if(modo==='fech' && i<2) o.fech = true;
            if(modo==='fixas' && i===0) o.fixas = '10, 22';
            lista.push(o);
          }
          const {funcs, N, dw} = preparar(lista, y, m, R);
          const rotulo = `${m}/${y} n=${n} cap=${R.maxFolga} maxDom=${R.maxDom} ${modo}`;
          const errsFixas = [];
          funcs.forEach(f => checarFixas(f.fixa, f.init, dw, N, R).forEach(e => errsFixas.push(`${f.nome}: ${e}`)));
          if(errsFixas.length){ continue; }  // dados de teste inválidos de propósito
          total++;
          const t0 = Date.now();
          const offs = gerarEscala(funcs, N, dw, R);
          const ms = Date.now()-t0;
          if(ms > 800){ lento++; console.log(`  lento: ${rotulo} (${ms}ms)`); }
          if(!offs){ falhas[modo+'/'+R.maxFolga] = (falhas[modo+'/'+R.maxFolga]||0)+1; if(modo!=='comPrev') console.log('  não gerou: '+rotulo); continue; }
          gerou++;
          ruim += auditar(rotulo, funcs, offs, N, dw, R);
        }
      }
    }
  }
}
console.log('falhas por modo/cap:', JSON.stringify(falhas));
console.log(`\ncenários: ${total} | gerou: ${gerou} | escalas com erro: ${ruim} | lentos(>800ms): ${lento}`);
console.log(ruim===0 ? 'NENHUMA ESCALA INVÁLIDA' : 'HÁ ESCALAS INVÁLIDAS');
process.exit(ruim===0 ? 0 : 1);
