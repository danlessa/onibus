'use strict';

/* mapa-onibus-br — os ônibus rodoviários do Brasil num mapa.
 *
 * Arquitetura: site estático sem build. O banco de dados é um grafo RDF:
 *   - data/catalog.ttl — catálogo DCAT/VoID; cada dataset aponta seu dump
 *     (void:dataDump). Cada dump é carregado no grafo nomeado do dataset.
 *   - deonibus.trig traz ainda um grafo por rede de empresa (ob:Network),
 *     só com triplas <origem> ob:directTo <destino>.
 *   - o grafo do levabici entra do mesmo jeito, lido ao vivo do levabici;
 *     as empresas se encontram por owl:sameAs (levabici-links.ttl).
 * Tudo vai num único N3.Store (window.grafo); o mapa e os painéis são
 * derivados dele. Nada é pré-computado em JSON.
 */

// ===================== vocabulário =====================

const SITE = 'https://onibus.abiru.to/';
const NS = {
  ob: SITE + 'def#',
  ds: SITE + 'id/dataset/',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  geo: 'http://www.opengis.net/ont/geosparql#',
  schema: 'https://schema.org/',
  void: 'http://rdfs.org/ns/void#',
  dcat: 'http://www.w3.org/ns/dcat#',
  dcterms: 'http://purl.org/dc/terms/',
  prov: 'http://www.w3.org/ns/prov#',
  lb: 'https://id.pedalhidrografi.co/levabici/terms#',
  emp: 'https://id.pedalhidrografi.co/levabici/empresa/',
};

const { namedNode, quad } = N3.DataFactory;
const T = (prefix, local) => namedNode(NS[prefix] + local);
const RDF_TYPE = T('rdf', 'type');
const CATALOG = NS.ds + 'catalogo';
const LEVABICI = 'https://levabici.pedalhidrografi.co/';

// Quantas empresas podem ter cor ao mesmo tempo. 4 é o máximo que passa
// na validação de paleta "todos os pares" nos dois temas — num mapa,
// qualquer par de linhas pode se tocar. As demais ficam cinza.
const MAX_HIGHLIGHT = 4;
const SLOT_OFFSETS = [-2.4, -0.8, 0.8, 2.4]; // px; trechos compartilhados viram linhas paralelas

const BRAZIL = [[-74, -33.8], [-34.8, 5.3]];

const BASEMAPS = {
  claro: 'https://tiles.openfreemap.org/styles/positron',
  escuro: 'https://tiles.openfreemap.org/styles/dark',
  // só fundo preto, sem estradas nem nomes: quem desenha o país é a rede
  preto: { version: 8, name: 'preto', sources: {}, layers: [{ id: 'fundo', type: 'background', paint: { 'background-color': '#000000' } }] },
};

const store = new N3.Store();
window.grafo = store;

// ===================== leitura do grafo =====================

const one = (s, p, g = null) => store.getObjects(s, p, g)[0] || null;
const lit = (s, p, g = null) => {
  const o = one(s, p, g);
  return o ? o.value : null;
};

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.text();
}

// Nossos dumps são servidos relativos à página (funciona em localhost e
// no Pages); os de fora (levabici) pela IRI absoluta.
function dumpUrl(iri) {
  return iri.startsWith(SITE) ? iri.slice(SITE.length) : iri;
}

// Triplas do grafo padrão de um dump vão pro grafo nomeado do dataset;
// grafos nomeados do próprio dump (as redes) ficam como estão.
function parseInto(text, format, baseIRI, graphIri, { defer = false } = {}) {
  const g = namedNode(graphIri);
  const quads = new N3.Parser({ format, baseIRI })
    .parse(text)
    .map((q) => (q.graph.termType === 'DefaultGraph' ? quad(q.subject, q.predicate, q.object, g) : q));
  if (!defer) store.addQuads(quads);
  return quads;
}

// A geometria (~300 mil triplas) é lida direto das quads pra desenhar logo,
// e só depois entra no store, aos poucos, sem travar a página.
const DEFERRED = new Set([NS.ds + 'estradas']);
const deferred = new Map(); // dataset → quads ainda fora do store
let storeComplete = Promise.resolve();
let storeLoading = false;

function flushDeferred() {
  if (!deferred.size) return storeComplete;
  const pending = [...deferred.values()].flat();
  deferred.clear();
  storeLoading = true;
  storeComplete = new Promise((resolve) => {
    let i = 0;
    const step = () => {
      store.addQuads(pending.slice(i, i + 20000));
      i += 20000;
      if (i < pending.length) setTimeout(step, 0);
      else {
        storeLoading = false;
        resolve();
      }
    };
    setTimeout(step, 0);
  });
  return storeComplete;
}

async function loadGraph() {
  parseInto(await fetchText('data/catalog.ttl'), 'text/turtle', SITE + 'data/catalog.ttl', CATALOG);
  const datasets = store.getObjects(namedNode(CATALOG), T('dcat', 'dataset'), null);
  const results = await Promise.allSettled(
    datasets.map(async (ds) => {
      const dump = one(ds, T('void', 'dataDump'));
      if (!dump) return 0;
      const format = dump.value.endsWith('.trig') ? 'application/trig' : 'text/turtle';
      const defer = DEFERRED.has(ds.value);
      const quads = parseInto(await fetchText(dumpUrl(dump.value)), format, dump.value, ds.value, { defer });
      if (defer) deferred.set(ds.value, quads);
      return quads.length;
    })
  );
  return datasets.map((ds, i) => ({
    iri: ds.value,
    ok: results[i].status === 'fulfilled',
    quads: results[i].value || 0,
    error: results[i].reason,
  }));
}

// fecho de rdfs:subClassOf sobre o vocabulário carregado
function subclassesOf(cls) {
  const out = new Map([[cls.value, cls]]);
  const queue = [cls];
  while (queue.length) {
    const c = queue.pop();
    for (const s of store.getSubjects(T('rdfs', 'subClassOf'), c, null)) {
      if (!out.has(s.value)) {
        out.set(s.value, s);
        queue.push(s);
      }
    }
  }
  return [...out.values()];
}

function instancesOf(cls) {
  const seen = new Map();
  for (const c of subclassesOf(cls)) {
    for (const s of store.getSubjects(RDF_TYPE, c, null)) seen.set(s.value, s);
  }
  return [...seen.values()];
}

const localName = (iri) => iri.split(/[/#]/).pop();

// ===================== modelo derivado =====================

const model = {
  places: [], // {iri, id, name, uf, country, lon, lat, neighbours:Set}
  placeIndex: new Map(),
  operators: [], // {iri, slug, name, url, logo, links, complete, levabici:[slug], score, reviews}
  opIndex: new Map(),
  pairs: [], // [op, a, b, dir] com a < b; dir: 1 = a→b, 2 = b→a, 3 = os dois
  pairsByPlace: new Map(), // índice de lugar → [índices em pairs]
  pairsByOp: new Map(),
  chains: [], // geometria de cada segmento: [[lon, lat], …]
  chainOff: [], // true = reta, não estrada (ob:offRoad, ou par sem rota no grafo)
  chainPairs: [], // segmento → [índices em pairs]
  pairChains: [], // par → [segmentos]
  routeKm: new Map(),
  roadRoutes: 0,
  levabiciLoaded: false,
};

function readLevabici(opIri) {
  const targets = store.getObjects(opIri, T('owl', 'sameAs'), null).filter((o) => o.value.startsWith(NS.emp));
  const scores = [];
  for (const t of targets) {
    for (const r of store.getSubjects(T('schema', 'itemReviewed'), t, null)) {
      if (!store.countQuads(r, RDF_TYPE, T('lb', 'Review'), null)) continue;
      const rating = one(r, T('schema', 'reviewRating'));
      const v = rating ? parseInt(lit(rating, T('schema', 'ratingValue')), 10) : NaN;
      if (!Number.isNaN(v)) scores.push(v);
    }
  }
  return {
    levabici: targets.map((t) => localName(t.value)),
    // média simples, como o próprio levabici calcula
    score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    reviews: scores.length,
  };
}

function readModel() {
  for (const p of instancesOf(T('ob', 'Locality'))) {
    const lat = parseFloat(lit(p, T('schema', 'latitude')));
    const lon = parseFloat(lit(p, T('schema', 'longitude')));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    model.placeIndex.set(p.value, model.places.length);
    model.places.push({
      iri: p.value,
      id: localName(p.value),
      name: lit(p, T('schema', 'name')) || localName(p.value),
      uf: lit(p, T('ob', 'uf')),
      country: lit(p, T('schema', 'addressCountry')),
      lat,
      lon,
      neighbours: new Set(),
    });
  }

  // redes → empresas (uma empresa pode ter redes de várias fontes)
  const netsByOp = new Map();
  for (const net of instancesOf(T('ob', 'Network'))) {
    const op = one(net, T('ob', 'operator'));
    if (!op) continue;
    if (!netsByOp.has(op.value)) netsByOp.set(op.value, { op, nets: [] });
    netsByOp.get(op.value).nets.push(net);
  }

  const ops = [];
  for (const { op, nets } of netsByOp.values()) {
    const links = new Map(); // a*N+b → dir
    const N = model.places.length;
    for (const net of nets) {
      for (const q of store.getQuads(null, T('ob', 'directTo'), null, net)) {
        const i = model.placeIndex.get(q.subject.value);
        const j = model.placeIndex.get(q.object.value);
        if (i === undefined || j === undefined || i === j) continue;
        const [a, b, bit] = i < j ? [i, j, 1] : [j, i, 2];
        links.set(a * N + b, (links.get(a * N + b) || 0) | bit);
      }
    }
    if (!links.size) continue;
    ops.push({
      iri: op.value,
      node: op,
      slug: localName(op.value),
      name: lit(op, T('schema', 'name')) || localName(op.value),
      url: lit(op, T('schema', 'url')),
      complete: nets.every((n) => lit(n, T('ob', 'complete')) !== 'false'),
      links,
      ...readLevabici(op),
    });
  }
  ops.sort((a, b) => b.links.size - a.links.size || a.name.localeCompare(b.name, 'pt'));

  const N = model.places.length;
  ops.forEach((op, idx) => {
    model.opIndex.set(op.iri, idx);
    model.opIndex.set(op.slug, idx);
    const mine = [];
    for (const [key, dir] of op.links) {
      const a = Math.floor(key / N);
      const b = key % N;
      const k = model.pairs.length;
      model.pairs.push([idx, a, b, dir]);
      mine.push(k);
      for (const p of [a, b]) {
        if (!model.pairsByPlace.has(p)) model.pairsByPlace.set(p, []);
        model.pairsByPlace.get(p).push(k);
      }
      model.places[a].neighbours.add(b);
      model.places[b].neighbours.add(a);
    }
    model.pairsByOp.set(idx, mine);
    op.linkCount = op.links.size;
    delete op.links;
  });
  model.operators = ops;
  model.levabiciLoaded = store.countQuads(null, RDF_TYPE, T('lb', 'Review'), null) > 0;
  readRoads();
}

// ===================== estado =====================

const state = {
  mode: 'empresa', // 'empresa' | 'bici'
  basemap: 'auto', // 'auto' (segue o sistema) | 'claro' | 'escuro' | 'preto'
  showOthers: true, // empresa: rede cinza das não destacadas; bici: estradas sem nota
  highlighted: [], // [{op, slot}] — o slot (cor) segue a empresa enquanto ela estiver destacada
  focus: null, // {kind: 'place', idx} | {kind: 'here', pairs: [...]}
};

function slotOf(op) {
  const h = state.highlighted.find((x) => x.op === op);
  return h ? h.slot : null;
}

function toggleHighlight(op) {
  const i = state.highlighted.findIndex((x) => x.op === op);
  if (i >= 0) {
    state.highlighted.splice(i, 1);
  } else {
    if (state.highlighted.length >= MAX_HIGHLIGHT) state.highlighted.shift(); // sai a mais antiga
    const used = new Set(state.highlighted.map((x) => x.slot));
    const slot = [1, 2, 3, 4].find((s) => !used.has(s));
    state.highlighted.push({ op, slot });
  }
  update({ data: true });
}

// ===================== utilidades de interface =====================

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const fmtInt = (n) => n.toLocaleString('pt-BR');
const fmtScore = (s) => (s === null ? '—' : s.toFixed(1).replace('.', ','));
const scoreBucket = (s) => Math.min(5, Math.max(1, Math.round(s)));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function palette() {
  return {
    series: [1, 2, 3, 4].map((i) => token(`--series-${i}`)),
    other: token('--series-other'),
    score: [1, 2, 3, 4, 5].map((i) => token(`--score-${i}`)),
    none: token('--score-none'),
    surface: token('--surface-map'),
    text: token('--text-primary'),
  };
}

function placeLabel(p) {
  return p.uf ? `${p.name} – ${p.uf}` : `${p.name} (${p.country || '?'})`;
}

function scoreChip(op) {
  if (op.score === null) return '<span class="score-chip">sem nota</span>';
  const c = palette().score[scoreBucket(op.score) - 1];
  return (
    `<span class="score-chip" title="${op.reviews} ${op.reviews === 1 ? 'avaliação' : 'avaliações'} no levabici">` +
    `<span class="score-dot" style="background:${c}"></span>${fmtScore(op.score)}/5</span>`
  );
}

function opLinks(op) {
  const out = [];
  if (op.levabici.length) {
    out.push(`<a href="${LEVABICI}empresa/${encodeURIComponent(op.levabici[0])}" target="_blank" rel="noopener">levabici</a>`);
  }
  if (op.url) out.push(`<a href="${esc(op.url)}" target="_blank" rel="noopener">passagens</a>`);
  return out.join('');
}

function toggleButton(opIdx) {
  const slot = slotOf(opIdx);
  const color = slot ? palette().series[slot - 1] : 'transparent';
  const op = model.operators[opIdx];
  return (
    `<button class="toggle-hl" data-op="${opIdx}" aria-pressed="${slot ? 'true' : 'false'}" ` +
    `style="background:${color}" title="${slot ? 'tirar o destaque' : 'destacar'} ${esc(op.name)}"></button>`
  );
}

// ===================== mapa =====================
//
// Cada par de localidades tem uma rota (ob:Route) feita de segmentos de
// estrada (ob:RoadSegment) compartilhados: é por eles que se desenha, e
// quem divide rodovia divide segmento — as linhas se sobrepõem. Par sem
// rota no grafo vira um segmento reto sintético, e o resto é igual.

let map;
let hoverFrame = null;

const BASEMAP_KEY = 'mapa-onibus:fundo';

function basemapChoice() {
  if (state.basemap !== 'auto') return state.basemap;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
}

// o tema da interface acompanha o fundo (as cores das séries têm passos
// próprios pro claro e pro escuro)
function applyTheme() {
  const choice = basemapChoice();
  document.documentElement.dataset.theme = choice === 'claro' ? 'light' : 'dark';
  document.documentElement.dataset.basemap = choice;
  for (const b of document.querySelectorAll('.basemap button')) {
    b.setAttribute('aria-checked', String(b.dataset.basemap === choice));
  }
}

function setBasemap(choice) {
  const before = basemapChoice();
  state.basemap = choice;
  try {
    localStorage.setItem(BASEMAP_KEY, choice);
  } catch (e) {
    /* sem storage: vale só nesta visita */
  }
  applyTheme();
  if (map && basemapChoice() !== before) map.setStyle(BASEMAPS[basemapChoice()], { diff: false });
  update({ data: false });
}

function parseWkt(wkt) {
  const body = wkt.slice(wkt.indexOf('(') + 1, wkt.lastIndexOf(')'));
  return body.split(',').map((p) => {
    const [x, y] = p.trim().split(/\s+/);
    return [parseFloat(x), parseFloat(y)];
  });
}

// ob:idList: "5-8 20-18 3" → [5, 6, 7, 8, 20, 19, 18, 3]
function decodeIdList(text) {
  const out = [];
  for (const tok of text.split(' ')) {
    if (!tok) continue;
    const dash = tok.indexOf('-');
    if (dash < 0) {
      out.push(+tok);
      continue;
    }
    const a = +tok.slice(0, dash);
    const b = +tok.slice(dash + 1);
    const step = b >= a ? 1 : -1;
    for (let i = a; i !== b + step; i += step) out.push(i);
  }
  return out;
}

// Lê ob:RoadSegment e ob:Route das quads (as do store + as ainda adiadas):
// numa passada só, agrupando por sujeito.
function readRoads() {
  const N = model.places.length;
  const P = {
    wkt: NS.geo + 'asWKT', off: NS.ob + 'offRoad', end: NS.ob + 'endpoint',
    segs: NS.ob + 'roadSegments', km: NS.ob + 'roadDistanceKm',
  };
  const wanted = new Set(Object.values(P));
  const segs = new Map(); // sujeito → {wkt, off}
  const routes = new Map(); // sujeito → {ends: [], segs, km}
  const take = (q) => {
    const p = q.predicate.value;
    if (!wanted.has(p)) return;
    const s = q.subject.value;
    if (p === P.wkt || p === P.off) {
      if (!segs.has(s)) segs.set(s, {});
      segs.get(s)[p === P.wkt ? 'wkt' : 'off'] = q.object.value;
    } else {
      if (!routes.has(s)) routes.set(s, { ends: [] });
      const r = routes.get(s);
      if (p === P.end) r.ends.push(q.object.value);
      else if (p === P.segs) r.segs = q.object.value;
      else r.km = q.object.value;
    }
  };
  for (const p of wanted) store.getQuads(null, namedNode(p), null, null).forEach(take);
  for (const quads of deferred.values()) quads.forEach(take);

  const segIndex = new Map();
  for (const [iri, sg] of segs) {
    if (!sg.wkt) continue;
    segIndex.set(localName(iri), model.chains.length);
    model.chains.push(parseWkt(sg.wkt));
    model.chainOff.push(sg.off === 'true');
  }
  const routeByKey = new Map();
  for (const r of routes.values()) {
    const ends = r.ends.map((iri) => model.placeIndex.get(iri));
    if (ends.length !== 2 || ends.some((e) => e === undefined)) continue;
    const [a, b] = ends[0] < ends[1] ? ends : [ends[1], ends[0]];
    const ids = decodeIdList(r.segs || '')
      .map((id) => segIndex.get(String(id)))
      .filter((c) => c !== undefined);
    if (!ids.length) continue;
    routeByKey.set(a * N + b, ids);
    const km = parseFloat(r.km);
    if (Number.isFinite(km)) model.routeKm.set(a * N + b, km);
  }
  model.roadRoutes = routeByKey.size;

  model.chainPairs = model.chains.map(() => []);
  model.pairs.forEach(([, a, b], k) => {
    const key = a * N + b;
    let ids = routeByKey.get(key);
    if (!ids) {
      // sem rota: uma reta, compartilhada pelas empresas desse par
      const c = model.chains.length;
      model.chains.push([
        [model.places[a].lon, model.places[a].lat],
        [model.places[b].lon, model.places[b].lat],
      ]);
      model.chainOff.push(true);
      model.chainPairs.push([]);
      ids = [c];
      routeByKey.set(key, ids);
    }
    model.pairChains[k] = ids;
    for (const c of ids) model.chainPairs[c].push(k);
  });
}

const routeKm = (a, b) => model.routeKm.get(Math.min(a, b) * model.places.length + Math.max(a, b));

// pares visíveis agora (null = todos)
function subsetPairs() {
  const f = state.focus;
  if (!f) return null;
  if (f.kind === 'place') return model.pairsByPlace.get(f.idx) || [];
  return f.pairs;
}

// Malha: um feature por segmento com n = nº de empresas que passam ali e
// best = melhor nota entre elas. Pra "todos" é calculada uma vez só.
let fullNetwork = null;

function networkFor(pairs) {
  const ops = new Map(); // cadeia → Set(empresa)
  const each = (k) => {
    const op = model.pairs[k][0];
    for (const c of model.pairChains[k]) {
      let s = ops.get(c);
      if (!s) ops.set(c, (s = new Set()));
      s.add(op);
    }
  };
  if (pairs) pairs.forEach(each);
  else for (let k = 0; k < model.pairs.length; k++) each(k);
  const features = [];
  for (const [c, set] of ops) {
    let best = -1;
    for (const op of set) {
      const s = model.operators[op].score;
      if (s !== null && s > best) best = s;
    }
    features.push({
      type: 'Feature',
      id: c,
      properties: { c, n: set.size, best, off: model.chainOff[c] },
      geometry: { type: 'LineString', coordinates: model.chains[c] },
    });
  }
  return { type: 'FeatureCollection', features };
}

const opChainCache = new Map();

function chainsOfOp(op, pairsSet) {
  if (!pairsSet) {
    if (!opChainCache.has(op)) {
      const s = new Set();
      for (const k of model.pairsByOp.get(op) || []) for (const c of model.pairChains[k]) s.add(c);
      opChainCache.set(op, s);
    }
    return opChainCache.get(op);
  }
  const s = new Set();
  for (const k of model.pairsByOp.get(op) || []) {
    if (pairsSet.has(k)) for (const c of model.pairChains[k]) s.add(c);
  }
  return s;
}

function highlightFor(pairs) {
  const pairsSet = pairs ? new Set(pairs) : null;
  const features = [];
  for (const h of state.highlighted) {
    for (const c of chainsOfOp(h.op, pairsSet)) {
      features.push({
        type: 'Feature',
        properties: { c, slot: h.slot, op: h.op, off: model.chainOff[c] },
        geometry: { type: 'LineString', coordinates: model.chains[c] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

function placesGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: model.places
      .map((p, i) => ({
        type: 'Feature',
        id: i,
        properties: { i, degree: p.neighbours.size },
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      }))
      .filter((f) => f.properties.degree > 0),
  };
}

let placesData = null;
const EMPTY = { type: 'FeatureCollection', features: [] };

// largura ∝ √(empresas no segmento): os corredores aparecem sozinhos
const WIDTH_BY_N = [
  'interpolate', ['linear'], ['zoom'],
  3, ['min', 4, ['+', 0.3, ['*', 0.3, ['sqrt', ['get', 'n']]]]],
  7, ['min', 8, ['+', 0.7, ['*', 0.55, ['sqrt', ['get', 'n']]]]],
  11, ['min', 12, ['+', 1.2, ['*', 0.8, ['sqrt', ['get', 'n']]]]],
];

function installLayers() {
  if (map.getSource('malha')) return;
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol');
  const before = firstSymbol ? firstSymbol.id : undefined;

  map.addSource('malha', { type: 'geojson', data: EMPTY, tolerance: 0.2 });
  map.addSource('destaque', { type: 'geojson', data: EMPTY, tolerance: 0.2 });
  map.addSource('localidades', { type: 'geojson', data: placesData });

  // cada camada de linha tem uma gêmea tracejada pros segmentos fora da
  // estrada (retas até a malha, ou par sem rota)
  const lineLayout = { 'line-cap': 'round', 'line-join': 'round' };
  const addLine = (id, source, paint) => {
    map.addLayer({ id, type: 'line', source, layout: lineLayout, paint }, before);
    map.addLayer({ id: id + '-reta', type: 'line', source, layout: { 'line-join': 'round' },
      paint: { ...paint, 'line-dasharray': [1.5, 1.5] } }, before);
  };
  addLine('malha-cinza', 'malha', { 'line-width': WIDTH_BY_N });
  addLine('malha-nota', 'malha', { 'line-width': WIDTH_BY_N, 'line-opacity': 0.9 });
  addLine('destaque', 'destaque', {
    'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.1, 7, 1.8, 11, 3],
    'line-opacity': 0.95,
  });
  map.addLayer({
    id: 'localidades',
    type: 'circle',
    source: 'localidades',
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        3, ['interpolate', ['linear'], ['sqrt', ['get', 'degree']], 1, 0.8, 30, 3.5],
        8, ['interpolate', ['linear'], ['sqrt', ['get', 'degree']], 1, 2.5, 30, 9],
      ],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 7, 1.2],
      // no país inteiro, só as cidades com muitos destinos; as outras aparecem com o zoom
      'circle-opacity': ['interpolate', ['linear'], ['zoom'],
        3.5, ['case', ['>=', ['get', 'degree'], 60], 1, 0],
        6, ['case', ['>=', ['get', 'degree'], 8], 1, 0],
        7.5, 1],
      'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'],
        3.5, ['case', ['>=', ['get', 'degree'], 60], 1, 0],
        6, ['case', ['>=', ['get', 'degree'], 8], 1, 0],
        7.5, 1],
    },
  }, before);
  map.addLayer({
    id: 'localidade-foco',
    type: 'circle',
    source: 'localidades',
    filter: ['==', ['get', 'i'], -1],
    paint: { 'circle-radius': 7, 'circle-stroke-width': 2.5, 'circle-color': 'transparent' },
  }, before);
  applyData();
}

const LINE_BASES = ['destaque', 'malha-nota', 'malha-cinza'];
const LINE_LAYERS = LINE_BASES.flatMap((id) => [id, id + '-reta']);
const ON_ROAD = ['!', ['get', 'off']];
const OFF_ROAD = ['get', 'off'];

// aplica nas duas gêmeas (estrada e reta)
function paintLine(id, prop, value) {
  map.setPaintProperty(id, prop, value);
  map.setPaintProperty(id + '-reta', prop, value);
}
function layoutLine(id, prop, value) {
  map.setLayoutProperty(id, prop, value);
  map.setLayoutProperty(id + '-reta', prop, value);
}
function filterLine(id, extra) {
  map.setFilter(id, extra ? ['all', ON_ROAD, extra] : ON_ROAD);
  map.setFilter(id + '-reta', extra ? ['all', OFF_ROAD, extra] : OFF_ROAD);
}

// dados das fontes: dependem do foco e das destacadas
function applyData() {
  if (!map || !map.getSource('malha')) return;
  const pairs = subsetPairs();
  if (!pairs && !fullNetwork) fullNetwork = networkFor(null);
  map.getSource('malha').setData(pairs ? networkFor(pairs) : fullNetwork);
  map.getSource('destaque').setData(state.mode === 'empresa' ? highlightFor(pairs) : EMPTY);
  applyStyle();
}

function applyStyle() {
  if (!map || !map.getLayer('malha-cinza')) return;
  const pal = palette();
  const bici = state.mode === 'bici';

  const bySlot = (values, fallback) => {
    const e = ['match', ['get', 'slot']];
    [1, 2, 3, 4].forEach((s, i) => e.push(s, values[i]));
    e.push(fallback);
    return e;
  };
  paintLine('destaque', 'line-color', bySlot(pal.series, pal.other));
  paintLine('destaque', 'line-offset', ['interpolate', ['linear'], ['zoom'],
    3, bySlot(SLOT_OFFSETS.map((o) => o * 0.4), 0), 7, bySlot(SLOT_OFFSETS, 0)]);
  paintLine('malha-cinza', 'line-color', pal.other);
  paintLine('malha-cinza', 'line-opacity', state.focus ? 0.75 : 0.55);

  // bici: cada segmento com a melhor nota entre as empresas que passam por ele
  paintLine('malha-nota', 'line-color', ['case', ['<', ['get', 'best'], 0], pal.none,
    ['step', ['get', 'best'], pal.score[0], 1.5, pal.score[1], 2.5, pal.score[2], 3.5, pal.score[3], 4.5, pal.score[4]]]);
  layoutLine('malha-nota', 'line-sort-key', ['get', 'best']);

  filterLine('destaque');
  filterLine('malha-cinza');
  filterLine('malha-nota', state.showOthers ? null : ['>=', ['get', 'best'], 0]);
  layoutLine('malha-cinza', 'visibility', !bici && state.showOthers ? 'visible' : 'none');
  layoutLine('destaque', 'visibility', bici ? 'none' : 'visible');
  layoutLine('malha-nota', 'visibility', bici ? 'visible' : 'none');

  // sem as "outras", as cidades também: só as servidas pelo que está no mapa
  let placeFilter = null;
  if (!state.showOthers) {
    const ops = bici
      ? model.operators.flatMap((o, i) => (o.score !== null ? [i] : []))
      : state.highlighted.map((h) => h.op);
    const served = new Set();
    for (const op of ops) {
      for (const k of model.pairsByOp.get(op) || []) {
        served.add(model.pairs[k][1]);
        served.add(model.pairs[k][2]);
      }
    }
    placeFilter = ['in', ['get', 'i'], ['literal', [...served]]];
  }
  map.setFilter('localidades', placeFilter);
  map.setPaintProperty('localidades', 'circle-color', pal.surface);
  map.setPaintProperty('localidades', 'circle-stroke-color', pal.text);
  map.setPaintProperty('localidade-foco', 'circle-stroke-color', pal.text);
  map.setFilter('localidade-foco', [
    '==', ['get', 'i'], state.focus && state.focus.kind === 'place' ? state.focus.idx : -1,
  ]);
}

// ----- hover: alvo maior que a linha (±5px); lista quem passa ali

function featuresAt(point, pad = 5) {
  const layers = LINE_LAYERS.filter((l) => map.getLayoutProperty(l, 'visibility') !== 'none');
  const box = [[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]];
  const places = map.queryRenderedFeatures(box, { layers: ['localidades'] });
  const chains = new Set(map.queryRenderedFeatures(box, { layers }).map((f) => f.properties.c));
  const subset = subsetPairs();
  const allowed = subset ? new Set(subset) : null;
  const pairs = new Set();
  for (const c of chains) {
    for (const k of model.chainPairs[c]) if (!allowed || allowed.has(k)) pairs.add(k);
  }
  return { place: places.length ? places[0].properties.i : null, pairs: [...pairs] };
}

function opColor(opIdx) {
  const pal = palette();
  const op = model.operators[opIdx];
  if (state.mode === 'bici') return op.score === null ? pal.none : pal.score[scoreBucket(op.score) - 1];
  return slotOf(opIdx) ? pal.series[slotOf(opIdx) - 1] : pal.other;
}

// empresas de um conjunto de pares, na ordem de interesse
function opsOf(pairIdxs) {
  const count = new Map();
  for (const k of pairIdxs) count.set(model.pairs[k][0], (count.get(model.pairs[k][0]) || 0) + 1);
  return [...count.entries()].sort(([a, na], [b, nb]) => {
    const oa = model.operators[a];
    const ob = model.operators[b];
    if (state.mode === 'bici') return (ob.score ?? -1) - (oa.score ?? -1) || nb - na;
    return (slotOf(b) ? 1 : 0) - (slotOf(a) ? 1 : 0) || nb - na;
  });
}

function pairText(k) {
  const [, a, b, dir] = model.pairs[k];
  const arrow = dir === 3 ? '↔' : '→';
  const [from, to] = dir === 2 ? [b, a] : [a, b];
  const km = routeKm(a, b);
  return `${model.places[from].name} ${arrow} ${model.places[to].name}` + (km ? ` · ${fmtInt(Math.round(km))} km` : '');
}

function onHover(e) {
  if (hoverFrame) cancelAnimationFrame(hoverFrame);
  hoverFrame = requestAnimationFrame(() => {
    const { place, pairs } = featuresAt(e.point);
    map.getCanvas().style.cursor = place !== null || pairs.length ? 'pointer' : '';
    if (place !== null) {
      const p = model.places[place];
      const nOps = new Set((model.pairsByPlace.get(place) || []).map((k) => model.pairs[k][0])).size;
      showTooltip(
        e.originalEvent,
        `<strong>${esc(placeLabel(p))}</strong><div class="muted">${fmtInt(p.neighbours.size)} destinos diretos · ${fmtInt(nOps)} ${nOps === 1 ? 'empresa' : 'empresas'}</div>`
      );
    } else if (pairs.length) {
      const LIMIT = 6;
      const ops = opsOf(pairs);
      const head = pairs.length === 1
        ? `<div class="tt-pair" style="margin-left:0">${esc(pairText(pairs[0]))}</div>`
        : `<div class="muted">${fmtInt(ops.length)} ${ops.length === 1 ? 'empresa' : 'empresas'} · ${fmtInt(pairs.length)} ligações passam aqui</div>`;
      const rows = ops.slice(0, LIMIT).map(([opIdx, n]) => {
        const op = model.operators[opIdx];
        return (
          `<div class="tt-row"><span class="swatch-line" style="background:${opColor(opIdx)}"></span>` +
          `<strong>${esc(op.name)}</strong>${state.mode === 'bici' ? scoreChip(op) : `<span class="muted">${fmtInt(n)}</span>`}</div>`
        );
      }).join('');
      const more = ops.length > LIMIT ? `<div class="tt-more">e mais ${ops.length - LIMIT} — clique pra ver todas</div>` : '';
      showTooltip(e.originalEvent, head + rows + more);
    } else {
      hideTooltip();
    }
  });
}

const tooltip = document.getElementById('tooltip');

function showTooltip(ev, html) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const pad = 14;
  const { innerWidth: w, innerHeight: h } = window;
  const r = tooltip.getBoundingClientRect();
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + r.width > w - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > h - 8) y = ev.clientY - r.height - pad;
  tooltip.style.left = `${Math.max(8, x)}px`;
  tooltip.style.top = `${Math.max(8, y)}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function onClick(e) {
  const { place, pairs } = featuresAt(e.point);
  if (place !== null) {
    focusPlace(place);
  } else if (pairs.length) {
    state.focus = { kind: 'here', pairs };
    update();
  }
}

function focusPlace(idx, fly = false) {
  state.focus = { kind: 'place', idx };
  update();
  if (fly) {
    const p = model.places[idx];
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 5.5) });
  }
}

function fitOperator(opIdx) {
  const b = new maplibregl.LngLatBounds();
  for (const c of chainsOfOp(opIdx, null)) for (const pt of model.chains[c]) b.extend(pt);
  if (!b.isEmpty()) map.fitBounds(b, { padding: panelPadding(), maxZoom: 8 });
}

function panelPadding() {
  const panel = document.getElementById('panel');
  const mobile = window.innerWidth <= 640;
  const r = panel.getBoundingClientRect();
  return mobile
    ? { top: 40, bottom: r.height + 20, left: 20, right: 20 }
    : { top: 40, bottom: 40, left: r.right + 20, right: 40 };
}

// ===================== painel =====================

function renderLegend() {
  const el = document.getElementById('legend');
  const pal = palette();
  if (state.mode === 'empresa') {
    const rows = state.highlighted
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((h) => {
        const op = model.operators[h.op];
        return (
          `<li class="legend-row"><span class="swatch-line" style="background:${pal.series[h.slot - 1]}"></span>` +
          `<span class="name" title="${esc(op.name)}">${esc(op.name)}</span>` +
          `<span class="count">${fmtInt(op.linkCount)} trechos</span>` +
          `<button class="icon-btn" data-remove="${h.op}" aria-label="tirar ${esc(op.name)} do destaque">×</button></li>`
        );
      })
      .join('');
    const others = model.operators.length - state.highlighted.length;
    el.innerHTML =
      '<h2>empresas destacadas</h2>' +
      `<ul class="legend-list">${rows}` +
      `<li class="legend-row"><span class="swatch-line thin" style="background:${pal.other}"></span>` +
      `<label class="name others-toggle"><input type="checkbox" data-others ${state.showOthers ? 'checked' : ''}>` +
      `mostrar as outras ${fmtInt(others)} empresas</label><span></span><span></span></li></ul>` +
      `<p class="legend-note">${roadNote()}Até ${MAX_HIGHLIGHT} empresas coloridas por vez (mais que isso as cores se confundem); ` +
      'busque uma empresa ou clique numa cidade pra trocar.</p>';
  } else {
    const scale = [1, 2, 3, 4, 5]
      .map((s) => `<span style="border-color:${pal.score[s - 1]}">${s}</span>`)
      .join('');
    const n = model.operators.filter((o) => o.score !== null).length;
    const status = model.levabiciLoaded
      ? `${n} de ${fmtInt(model.operators.length)} empresas têm nota.`
      : '<strong>Não consegui carregar o levabici agora</strong> — tente recarregar.';
    el.innerHTML =
      '<h2>amigabilidade à bici (levabici)</h2>' +
      `<div class="score-scale" aria-label="escala de 1 (pior) a 5 (melhor)">${scale}</div>` +
      `<ul class="legend-list"><li class="legend-row"><span class="swatch-line thin" style="background:${pal.none}"></span>` +
      `<label class="name others-toggle"><input type="checkbox" data-others ${state.showOthers ? 'checked' : ''}>` +
      'mostrar estradas sem empresa avaliada</label><span></span><span></span></li></ul>' +
      `<p class="legend-note">${status} Cada estrada tem a cor da <em>melhor</em> nota média entre as empresas que passam por ela ` +
      '— é a chance de achar uma que leve sua bici. ' +
      `<a href="${LEVABICI}#/nova" target="_blank" rel="noopener">Avalie uma empresa →</a></p>`;
  }
}

function roadNote() {
  if (!model.roadRoutes) return 'Cada linha é uma reta entre as cidades. ';
  return 'As linhas seguem a estrada (caminho mais rápido de carro, não o itinerário oficial); ' +
    'a espessura é o número de empresas que passam ali, e o tracejado é reta onde o mapa não tem estrada. ';
}

function companyItems(counts) {
  return counts
    .map(([opIdx, n, extra]) => {
      const op = model.operators[opIdx];
      const meta = [
        `${fmtInt(n)} ${extra || 'trechos'}`,
        op.complete ? null : 'lista parcial',
      ].filter(Boolean).join(' · ');
      return (
        `<li>${toggleButton(opIdx)}<span class="who"><strong>${esc(op.name)}</strong>` +
        `<span class="meta">${esc(meta)}</span></span>` +
        `<span class="links">${scoreChip(op)}${opLinks(op)}</span></li>`
      );
    })
    .join('');
}

function renderFocus() {
  const el = document.getElementById('focus');
  const f = state.focus;
  if (!f) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  if (f.kind === 'place') {
    const p = model.places[f.idx];
    const pairs = model.pairsByPlace.get(f.idx) || [];
    const byOp = new Map();
    for (const k of pairs) byOp.set(model.pairs[k][0], (byOp.get(model.pairs[k][0]) || 0) + 1);
    const counts = [...byOp.entries()].sort((a, b) => b[1] - a[1]).map(([o, n]) => [o, n, n === 1 ? 'destino daqui' : 'destinos daqui']);
    const dests = [...p.neighbours]
      .map((i) => ({ p: model.places[i], km: routeKm(f.idx, i) }))
      .sort((a, b) => a.p.name.localeCompare(b.p.name, 'pt'));
    el.innerHTML =
      `<div class="focus-head"><h3>${esc(placeLabel(p))}</h3><button class="link-btn" data-clear>limpar</button></div>` +
      `<p class="focus-sub">${fmtInt(p.neighbours.size)} destinos diretos · ${fmtInt(byOp.size)} ${byOp.size === 1 ? 'empresa' : 'empresas'}</p>` +
      `<h2>empresas daqui</h2><ul class="company-list">${companyItems(counts)}</ul>` +
      `<details class="more"><summary>ver os ${fmtInt(dests.length)} destinos</summary>` +
      `<ul class="dest-list">${dests.map((d) => `<li>${esc(placeLabel(d.p))}${d.km ? ` <span class="muted">${fmtInt(Math.round(d.km))} km</span>` : ''}</li>`).join('')}</ul></details>`;
  } else {
    const counts = opsOf(f.pairs).map(([o, n]) => [o, n, n === 1 ? 'ligação por aqui' : 'ligações por aqui']);
    const SHOW = 300;
    const rows = f.pairs
      .slice()
      .sort((x, y) => model.operators[model.pairs[x][0]].name.localeCompare(model.operators[model.pairs[y][0]].name, 'pt'))
      .slice(0, SHOW);
    el.innerHTML =
      `<div class="focus-head"><h3>por esta estrada</h3><button class="link-btn" data-clear>limpar</button></div>` +
      `<p class="focus-sub">${fmtInt(f.pairs.length)} ${f.pairs.length === 1 ? 'ligação' : 'ligações'} de ${fmtInt(counts.length)} ${counts.length === 1 ? 'empresa' : 'empresas'} — no mapa, o caminho inteiro de cada uma</p>` +
      `<ul class="company-list">${companyItems(counts)}</ul>` +
      `<details class="more" ${rows.length <= 8 ? 'open' : ''}><summary>ligações</summary><ul class="dest-list">` +
      rows.map((k) => `<li><strong>${esc(model.operators[model.pairs[k][0]].name)}</strong>: ${esc(pairText(k))}</li>`).join('') +
      (f.pairs.length > SHOW ? `<li class="muted">e mais ${fmtInt(f.pairs.length - SHOW)}</li>` : '') +
      '</ul></details>';
  }
}

function renderModeButtons() {
  for (const b of document.querySelectorAll('.mode button')) {
    b.setAttribute('aria-checked', String(b.dataset.mode === state.mode));
  }
}

// data: refaz as fontes do mapa (foco, destacadas ou modo mudaram); senão só o estilo
function update({ data = true } = {}) {
  renderModeButtons();
  renderLegend();
  renderFocus();
  if (data) applyData();
  else applyStyle();
  writeHash();
}

// ===================== busca =====================

const searchEl = document.getElementById('search');
const resultsEl = document.getElementById('search-results');
let searchItems = [];
let searchActive = -1;

function runSearch() {
  const q = norm(searchEl.value.trim());
  if (q.length < 2) {
    resultsEl.hidden = true;
    return;
  }
  const score = (name) => {
    const n = norm(name);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(' ' + q)) return 2;
    if (n.includes(q)) return 3;
    return -1;
  };
  const ops = model.operators
    .map((op, i) => ({ kind: 'empresa', i, name: op.name, s: score(op.name), w: op.linkCount }))
    .filter((x) => x.s >= 0);
  const places = model.places
    .map((p, i) => ({ kind: 'cidade', i, name: placeLabel(p), s: score(p.name), w: p.neighbours.size }))
    .filter((x) => x.s >= 0 && x.w > 0);
  searchItems = [...ops, ...places].sort((a, b) => a.s - b.s || b.w - a.w).slice(0, 10);
  searchActive = searchItems.length ? 0 : -1;
  renderSearch();
}

function renderSearch() {
  if (!searchItems.length) {
    resultsEl.innerHTML = '<li class="muted">nada encontrado</li>';
  } else {
    resultsEl.innerHTML = searchItems
      .map(
        (it, k) =>
          `<li role="option" data-k="${k}" aria-selected="${k === searchActive}">` +
          `<span>${esc(it.name)}</span><span class="kind">${it.kind === 'empresa' ? 'empresa' : `${fmtInt(it.w)} destinos`}</span></li>`
      )
      .join('');
  }
  resultsEl.hidden = false;
}

function chooseSearch(k) {
  const it = searchItems[k];
  if (!it) return;
  resultsEl.hidden = true;
  searchEl.value = '';
  if (it.kind === 'empresa') {
    if (!slotOf(it.i)) toggleHighlight(it.i);
    if (state.mode !== 'empresa') {
      state.mode = 'empresa';
      update();
    }
    fitOperator(it.i);
  } else {
    focusPlace(it.i, true);
  }
}

searchEl.addEventListener('input', runSearch);
searchEl.addEventListener('keydown', (e) => {
  if (resultsEl.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const d = e.key === 'ArrowDown' ? 1 : -1;
    searchActive = (searchActive + d + searchItems.length) % searchItems.length;
    renderSearch();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    chooseSearch(searchActive);
  } else if (e.key === 'Escape') {
    resultsEl.hidden = true;
  }
});
resultsEl.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li[data-k]');
  if (li) chooseSearch(parseInt(li.dataset.k, 10));
});
searchEl.addEventListener('blur', () => setTimeout(() => (resultsEl.hidden = true), 150));

// ===================== eventos do painel =====================

document.getElementById('panel').addEventListener('change', (e) => {
  if (e.target.matches('input[data-others]')) {
    state.showOthers = e.target.checked;
    update({ data: false });
  }
});

document.getElementById('panel').addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.basemap) {
    setBasemap(t.dataset.basemap);
  } else if (t.dataset.mode) {
    state.mode = t.dataset.mode;
    update();
  } else if (t.dataset.remove !== undefined) {
    toggleHighlight(parseInt(t.dataset.remove, 10));
  } else if (t.dataset.op !== undefined) {
    if (state.mode !== 'empresa') state.mode = 'empresa';
    toggleHighlight(parseInt(t.dataset.op, 10));
  } else if (t.hasAttribute('data-clear')) {
    state.focus = null;
    update();
  }
});

document.getElementById('panel-toggle').addEventListener('click', (e) => {
  const panel = document.getElementById('panel');
  const collapsed = panel.toggleAttribute('data-collapsed');
  e.currentTarget.setAttribute('aria-expanded', String(!collapsed));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.focus && document.activeElement !== searchEl) {
    state.focus = null;
    update();
  }
});

// ===================== URL (estado compartilhável) =====================

function writeHash() {
  const parts = [];
  if (state.mode !== 'empresa') parts.push(`modo=${state.mode}`);
  if (state.basemap !== 'auto') parts.push(`fundo=${state.basemap}`);
  if (!state.showOthers) parts.push('outras=0');
  parts.push(`empresas=${state.highlighted.map((h) => model.operators[h.op].slug).join(',')}`);
  if (state.focus && state.focus.kind === 'place') parts.push(`cidade=${model.places[state.focus.idx].id}`);
  history.replaceState(null, '', '#' + parts.join('&'));
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('modo') === 'bici') state.mode = 'bici';
  if (params.get('outras') === '0') state.showOthers = false;
  if (params.has('empresas')) {
    state.highlighted = [];
    for (const slug of params.get('empresas').split(',').filter(Boolean).slice(0, MAX_HIGHLIGHT)) {
      const i = model.opIndex.get(slug);
      if (i !== undefined) state.highlighted.push({ op: i, slot: state.highlighted.length + 1 });
    }
  } else {
    // padrão: as maiores redes
    state.highlighted = model.operators.slice(0, MAX_HIGHLIGHT).map((_, i) => ({ op: i, slot: i + 1 }));
  }
  const city = params.get('cidade');
  if (city) {
    const idx = model.places.findIndex((p) => p.id === city);
    if (idx >= 0) state.focus = { kind: 'place', idx };
  }
}

// ===================== sobre & dados =====================

function renderAbout(loadReport) {
  const list = document.getElementById('about-datasets');
  list.innerHTML = loadReport
    .map((d) => {
      const ds = namedNode(d.iri);
      const title = lit(ds, T('dcterms', 'title')) || localName(d.iri);
      const dump = lit(ds, T('void', 'dataDump'));
      const when = lit(ds, T('prov', 'generatedAtTime'));
      const bits = [
        d.ok ? `${fmtInt(d.quads)} triplas` : 'não carregou',
        when ? `de ${new Date(when).toLocaleDateString('pt-BR')}` : null,
      ].filter(Boolean);
      const href = dump ? (dump.startsWith(SITE) ? dumpUrl(dump) : dump) : null;
      return `<li>${href ? `<a href="${esc(href)}">${esc(title)}</a>` : esc(title)} <span class="muted">— ${esc(bits.join(', '))}</span></li>`;
    })
    .join('') + '<li><a href="data/catalog.ttl">catálogo (DCAT/VoID)</a> · <a href="data/shapes.ttl">restrições SHACL</a></li>';
  const graphs = store.getGraphs(null, null, null).length;
  document.getElementById('about-stats').textContent =
    `No store agora: ${fmtInt(store.size)} quads em ${fmtInt(graphs)} grafos nomeados.`;
}

const SPARQL_PREFIXES = `PREFIX ob: <https://onibus.abiru.to/def#>
PREFIX schema: <https://schema.org/>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
`;

const SPARQL_EXAMPLES = [
  {
    label: 'quem liga São Paulo a Curitiba?',
    query: `SELECT ?empresa WHERE {
  ?a schema:name "São Paulo" ; ob:uf "SP" .
  ?b schema:name "Curitiba" ; ob:uf "PR" .
  GRAPH ?rede { ?a ob:directTo ?b }
  ?rede ob:operator/schema:name ?empresa .
}
ORDER BY ?empresa`,
  },
  {
    label: 'destinos diretos de Florianópolis',
    query: `SELECT DISTINCT ?destino ?uf WHERE {
  ?a schema:name "Florianópolis" ; ob:uf "SC" .
  GRAPH ?rede { ?a ob:directTo ?b }
  ?b schema:name ?destino .
  OPTIONAL { ?b ob:uf ?uf }
}
ORDER BY ?uf ?destino`,
  },
  {
    label: 'empresas mais amigas da bici',
    query: `SELECT ?empresa (AVG(?nota) AS ?media) (COUNT(?av) AS ?avaliacoes) WHERE {
  ?op a ob:Operator ; schema:name ?empresa ; owl:sameAs ?lb .
  ?av schema:itemReviewed ?lb ;
      schema:reviewRating/schema:ratingValue ?nota .
}
GROUP BY ?empresa
ORDER BY DESC(?media) DESC(?avaliacoes)`,
  },
  {
    label: 'maiores redes',
    query: `SELECT ?empresa ?trechos ?completa WHERE {
  ?rede a ob:Network ; ob:operator/schema:name ?empresa ;
        ob:linkCount ?trechos ; ob:complete ?completa .
}
ORDER BY DESC(?trechos)
LIMIT 20`,
  },
];

let comunicaEngine = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('não consegui baixar ' + src));
    document.head.appendChild(s);
  });
}

const PREFIX_DISPLAY = Object.entries({
  ob: NS.ob, op: SITE + 'id/empresa/', mun: SITE + 'id/municipio/', rede: SITE + 'id/rede/',
  schema: NS.schema, owl: NS.owl, lb: NS.lb, emp: NS.emp, xsd: NS.xsd,
});

function termHtml(term) {
  if (!term) return '';
  if (term.termType === 'NamedNode') {
    const hit = PREFIX_DISPLAY.find(([, ns]) => term.value.startsWith(ns));
    const text = hit ? `${hit[0]}:${term.value.slice(hit[1].length)}` : term.value;
    return /^https?:/.test(term.value) ? `<a href="${esc(term.value)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text);
  }
  if (term.termType === 'Literal') {
    const n = Number(term.value);
    if (term.datatype && /decimal|double|float/.test(term.datatype.value) && Number.isFinite(n)) {
      return esc(n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
    }
    return esc(term.value);
  }
  return esc(term.value);
}

async function runSparql() {
  const status = document.getElementById('sparql-status');
  const out = document.getElementById('sparql-results');
  const q = document.getElementById('sparql-query').value;
  status.textContent = 'rodando…';
  out.innerHTML = '';
  const t0 = performance.now();
  try {
    if (!comunicaEngine) {
      status.textContent = 'baixando o Comunica (~1,4 MB)…';
      await loadScript('https://rdf.js.org/comunica-browser/versions/v4/engines/query-sparql-rdfjs/comunica-browser.js');
      comunicaEngine = new Comunica.QueryEngine();
      status.textContent = 'rodando…';
    }
    if (deferred.size || storeLoading) {
      status.textContent = 'terminando de carregar a geometria no store…';
      await flushDeferred();
      status.textContent = 'rodando…';
    }
    const stream = await comunicaEngine.queryBindings(q, { sources: [store], unionDefaultGraph: true });
    const rows = await stream.toArray();
    const vars = [];
    for (const r of rows) for (const [k] of r) if (!vars.includes(k.value)) vars.push(k.value);
    const shown = rows.slice(0, 300);
    out.innerHTML =
      `<table><thead><tr>${vars.map((v) => `<th>?${esc(v)}</th>`).join('')}</tr></thead><tbody>` +
      shown.map((r) => `<tr>${vars.map((v) => `<td>${termHtml(r.get(v))}</td>`).join('')}</tr>`).join('') +
      '</tbody></table>';
    const ms = Math.round(performance.now() - t0);
    status.textContent = `${fmtInt(rows.length)} ${rows.length === 1 ? 'resultado' : 'resultados'} em ${fmtInt(ms)} ms` +
      (rows.length > shown.length ? ` (mostrando ${shown.length})` : '');
  } catch (err) {
    status.textContent = 'erro: ' + err.message;
  }
}

function setupAbout(loadReport) {
  const dialog = document.getElementById('about');
  document.getElementById('about-open').addEventListener('click', () => {
    renderAbout(loadReport);
    dialog.showModal();
  });
  const ta = document.getElementById('sparql-query');
  ta.value = SPARQL_PREFIXES + '\n' + SPARQL_EXAMPLES[0].query;
  const ex = document.getElementById('sparql-examples');
  ex.innerHTML = SPARQL_EXAMPLES.map((x, i) => `<button class="btn" data-ex="${i}">${esc(x.label)}</button>`).join('');
  ex.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ex]');
    if (b) ta.value = SPARQL_PREFIXES + '\n' + SPARQL_EXAMPLES[+b.dataset.ex].query;
  });
  document.getElementById('sparql-run').addEventListener('click', runSparql);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runSparql();
  });
}

// ===================== início =====================

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

async function main() {
  // fundo: link compartilhado > escolha salva neste navegador > sistema
  const hashFundo = new URLSearchParams(location.hash.slice(1)).get('fundo');
  let saved = null;
  try {
    saved = localStorage.getItem(BASEMAP_KEY);
  } catch (e) {
    /* sem storage */
  }
  const initial = hashFundo || saved;
  if (initial && initial in BASEMAPS) state.basemap = initial;
  applyTheme();

  map = new maplibregl.Map({
    container: 'map',
    style: BASEMAPS[basemapChoice()],
    bounds: BRAZIL,
    fitBoundsOptions: { padding: 20 },
    minZoom: 2.5,
    maxZoom: 12,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  const styleReady = new Promise((resolve) => map.once('load', resolve));

  let loadReport;
  try {
    loadReport = await loadGraph();
  } catch (err) {
    setStatus('não consegui carregar o grafo: ' + err.message);
    throw err;
  }
  readModel();
  placesData = placesGeoJSON();
  readHash();

  const lev = loadReport.find((d) => d.iri === NS.ds + 'levabici');
  setStatus(
    `${fmtInt(model.operators.length)} empresas · ${fmtInt(model.pairs.length)} trechos` +
    (lev && !lev.ok ? ' · levabici fora do ar' : '')
  );
  setupAbout(loadReport);

  await styleReady;
  map.fitBounds(BRAZIL, { padding: panelPadding(), animate: false });
  installLayers();
  map.on('mousemove', onHover);
  map.on('mouseout', hideTooltip);
  map.on('click', onClick);
  // trocar o tema do sistema troca o mapa base; as camadas voltam no style.load
  map.on('style.load', installLayers);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.basemap !== 'auto') return;
    applyTheme();
    map.setStyle(BASEMAPS[basemapChoice()], { diff: false });
    update({ data: false });
  });
  update();
  if (state.focus && state.focus.kind === 'place') focusPlace(state.focus.idx, true);
  map.once('idle', () => flushDeferred());
}

main();
