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
      // interpreta o template de addEmp: campos <input class="e-x"> e <select class="e-turno">
      const re = /<(input|select)[^>]*class="(e-[a-z]+)"[^>]*>/g;
      let mt;
      while((mt = re.exec(v))){
        const cls = mt[2], trecho = mt[0];
        const campo = el(mt[1]);
        const vv = trecho.match(/value="([^"]*)"/);
        campo.value = vv ? vv[1] : '';
        campo.checked = /\bchecked\b/.test(trecho);
        if(mt[1] === 'select'){
          // pega a opção marcada como selected
          const sel = v.slice(re.lastIndex).match(/<option value="([a-z]+)" selected>/);
          campo.value = sel ? sel[1] : 'manha';
        }
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

const set = (id, v) => { const e = doc.getElementById(id); e.value = v; };
set('mes','12'); set('ano','2026');
set('r-cap','2'); set('r-seq','5'); set('r-dom','3'); set('r-turno','1');

let falhas = 0;
const verificar = (c, m) => { if(!c){ console.log('FALHA: ' + m); falhas++; } };

sandbox.exemplo();
const lista = byId['lista'];
console.log('linhas criadas pelo exemplo():', lista.children.length);
rows.push(...lista.children);
rows.forEach(r => console.log('  ', r.querySelector('.e-nome').value, '->', r.querySelector('.e-turno').value));

sandbox.gerar();
const u = vm.runInContext('typeof ultimo === "undefined" ? null : ultimo', sandbox);
verificar(!!u, 'gerar() não produziu escala');
if(!u) process.exit(1);

console.log(`\nEscala de ${u.m}/${u.y}, ${u.funcs.length} pessoas (limite ${u.R.maxFolga}/dia, turno ${u.R.maxTurno}/dia):`);
u.funcs.forEach((f,i) => {
  const folgas = u.offs[i].map((v,d) => v ? d : null).filter(Boolean);
  const doms = folgas.filter(d => u.dw[d]===0);
  console.log(`  ${f.nome.padEnd(8)} [${f.turno.padEnd(5)}] folgas: ${folgas.join(', ')}  | domingos: ${doms.join(', ') || '-'}`);
});

// regras conferidas por fora
let probs = 0;
u.funcs.forEach((f,i) => {
  let sc = f.init.sc;
  for(let d=1; d<=u.N; d++){
    if(u.dw[d]!==0 || f.fixa.has(d)) continue;
    const isOff = !!u.offs[i][d];
    if(sc >= u.R.maxDom && !isOff){ console.log(`  ERRO ${f.nome}: domingo ${d} sem folga com ${sc} seguidos`); probs++; }
    if(sc < u.R.maxDom && isOff){ console.log(`  ERRO ${f.nome}: folga no domingo ${d} antes do ${u.R.maxDom}º`); probs++; }
    sc = isOff ? 0 : sc+1;
  }
});
falhas += probs;

// limite por dia e por turno
for(let d=1; d<=u.N; d++){
  const c = u.offs.filter(o => o[d]).length;
  verificar(c <= u.R.maxFolga, `dia ${d}: ${c} folgas > ${u.R.maxFolga}`);
  for(const g of ['fech','inter']){
    const cg = u.funcs.filter((f,i) => f.turno === g && u.offs[i][d]).length;
    verificar(cg <= u.R.maxTurno, `dia ${d}: ${cg} do turno ${g} de folga > ${u.R.maxTurno}`);
  }
}

// HTML renderizado: turnos marcados e destaque de dia vazio
const htmlSaida = String(byId['resultado'].innerHTML);
verificar(/title="Fechamento"/.test(htmlSaida), 'selo de fechamento ausente no HTML');
verificar(/class="fech int"/.test(htmlSaida), 'selo de intermediário ausente no HTML');
verificar(/Intermediário: entra às 10h e sai às 20h/.test(htmlSaida), 'horário do intermediário ausente no HTML');
verificar(/Turno/.test(htmlSaida) || /Fechamento/.test(htmlSaida), 'verificação de turno ausente');
const vazios = [];
for(let d=1; d<=u.N; d++) if(!u.offs.some(o => o[d])) vazios.push(d);
console.log(`\ndias sem ninguém de folga: ${vazios.length} -> ${vazios.join(',') || 'nenhum'}`);
if(vazios.length) verificar(/vazioDia/.test(htmlSaida), 'dia vazio não destacado no HTML');
else verificar(!/vazioDia/.test(htmlSaida), 'destaque de dia vazio sem nenhum dia vazio');

// CSV
let csv = '';
sandbox.URL.createObjectURL = () => '';
const origBlob = sandbox.Blob;
sandbox.Blob = class { constructor(parts){ csv = parts[0]; } };
vm.runInContext('Blob', sandbox);
sandbox.exportarCSV();
const linhas = csv ? csv.replace(/^\uFEFF/, '').split('\r\n') : [];
verificar(linhas.length === u.funcs.length + 2, `CSV deveria ter ${u.funcs.length+2} linhas, tem ${linhas.length}`);
verificar(linhas[0] && linhas[0].startsWith('Funcionário;Turno;'), 'cabeçalho do CSV sem coluna Turno');
verificar(/Intermediário \(10h–20h\)/.test(csv), 'CSV sem o turno intermediário');
verificar(/^Folgas no dia;/m.test(csv), 'CSV sem a linha de folgas por dia');
console.log('CSV: ' + (linhas[0] || '').slice(0,60) + '…');

console.log(falhas === 0 ? '\nCAMINHO REAL OK' : `\n${falhas} PROBLEMAS`);
process.exit(falhas === 0 ? 0 : 1);
