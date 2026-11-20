// Exercita o caminho real: exemplo() -> gerar() -> render()
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function el(tag='div'){
  const e = {
    tag, children: [], _html: '', value: '', checked: false,
    className: '', style: {}, dataset: {},
    appendChild(c){ this.children.push(c); return c; },
    remove(){}, click(){}, scrollIntoView(){}, focus(){},
    closest(){ return null; },
    classList: { add(){}, remove(){}, contains(){ return false; } },
    set innerHTML(v){
      this._html = v; this.children = []; this._q = {};
      // interpreta o template de addEmp: <input class="e-nome" ... value="X">
      const re = /<input[^>]*class="(e-[a-z]+)"[^>]*>/g;
      let mt;
      while((mt = re.exec(v))){
        const cls = mt[1], trecho = mt[0];
        const campo = el('input');
        const vv = trecho.match(/value="([^"]*)"/);
        campo.value = vv ? vv[1] : '';
        campo.checked = /\bchecked\b/.test(trecho);
        this._q['.'+cls] = campo;
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
const rows = [];
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

// valores dos campos de regras e mês/ano
byId['mes'] = Object.assign(el('select'), {value: '12'});
byId['ano'] = Object.assign(el('input'), {value: '2026'});
byId['r-cap'] = Object.assign(el('input'), {value: '2'});
byId['r-seq'] = Object.assign(el('input'), {value: '5'});
byId['r-dom'] = Object.assign(el('input'), {value: '3'});

sandbox.exemplo();
console.log('linhas criadas pelo exemplo():', sandbox.document.querySelectorAll('.eq-row').length);
// addEmp usa $('lista').appendChild -> capturar as linhas
const lista = byId['lista'];
console.log('linhas em #lista:', lista.children.length);
rows.push(...lista.children);

rows.forEach(r => console.log('  linha:', JSON.stringify({
  nome: r.querySelector('.e-nome').value,
  fech: r.querySelector('.e-fech').checked,
  prev: r.querySelector('.e-prev').value,
  fix: r.querySelector('.e-fix').value })));
sandbox.gerar();
console.log('toast:', byId['toast'] && byId['toast'].textContent);
if(byId['erro']) console.log('erro innerHTML:', String(byId['erro'].innerHTML).slice(0,400));
const u = vm.runInContext('typeof ultimo === "undefined" ? null : ultimo', sandbox);
if(!u){ console.log('FALHOU: gerar() não produziu escala'); process.exit(1); }
console.log(`\nEscala gerada para ${u.m}/${u.y}, ${u.funcs.length} pessoas:`);
const MESES = sandbox.MESES;
u.funcs.forEach((f,i) => {
  const folgas = u.offs[i].map((v,d) => v ? d : null).filter(Boolean);
  const doms = folgas.filter(d => u.dw[d]===0);
  console.log(`  ${f.nome.padEnd(8)} folgas: ${folgas.join(', ')}  | domingos: ${doms.join(', ') || '-'}`);
});
// conferência independente da regra dos 3 domingos trabalhados + folga no 4º
let probs = 0;
u.funcs.forEach((f,i) => {
  let sc = f.init.sc;
  for(let d=1; d<=u.N; d++){
    if(u.dw[d]!==0) continue;
    const isOff = !!u.offs[i][d];
    if(f.fixa.has(d)) continue;
    if(sc >= u.R.maxDom && !isOff){ console.log(`  ERRO ${f.nome}: domingo ${d} sem folga com ${sc} seguidos`); probs++; }
    if(sc < u.R.maxDom && isOff){ console.log(`  ERRO ${f.nome}: folga no domingo ${d} antes do ${u.R.maxDom}º`); probs++; }
    sc = isOff ? 0 : sc+1;
  }
});
console.log(probs === 0 ? '\nCAMINHO REAL OK' : `\n${probs} PROBLEMAS`);
process.exit(probs === 0 ? 0 : 1);
