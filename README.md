# mapa-onibus-br

**[abiru.to/onibus](https://abiru.to/onibus/)** — every inter-city bus link in Brazil on one map,
colored by operating company, or by how bike-friendly the company is according to
[levabici](https://levabici.pedalhidrografi.co/).

Successor of [mapa-interativo-onibus-rodoviario](https://github.com/danlessa/mapa-interativo-onibus-rodoviario)
(Streamlit, Dec/2022 data). Same source (deonibus.com), re-scraped in Sep/2026:
345 companies, 88,766 directed links (48,124 company × city-pair segments) between 2,912 localities,
including routes to Argentina, Paraguay, Uruguay and Bolivia. Every link is drawn along the road
network (OSRM on OpenStreetMap). Services that share a highway share its line, and line width shows
how many companies run there.

## The database is an RDF graph

There is no backend and no JSON derived from the data. The site loads RDF dumps into an
[N3.js](https://github.com/rdfjs/N3.js) store in the browser and builds the map and panels from it.

```
site/data/
  catalog.ttl         DCAT + VoID catalog: lists every dataset and its dump (void:dataDump)
  vocab.ttl           the ob: vocabulary (OWL)
  shapes.ttl          SHACL constraints (checked in CI)
  municipios.ttl      localities: IBGE municipalities (+ schema:sameAs Wikidata) and a few districts/foreign cities
  deonibus.trig       operators, plus one named graph per operator network
  levabici-links.ttl  owl:sameAs  op:cometa → levabici emp:cometa   (a void:Linkset)
  estradas.ttl        road geometry: one ob:Route per city pair, made of shared ob:RoadSegment (geo:asWKT)
  (live)              https://levabici.pedalhidrografi.co/data/reviews.ttl — listed in the catalog, fetched at runtime
```

The browser reads `catalog.ttl`, fetches every dump it lists, and loads each one into the
named graph of its dataset. It fetches levabici's graph the same way, straight from levabici
(the site serves it with CORS `*`), so scores are always current.

**Network model.** Each operator, per source, has an `ob:Network` whose IRI is also the name
of a graph containing only `<origin> ob:directTo <destination>` triples:

```trig
<https://abiru.to/onibus/id/rede/deonibus/cometa> {      # graph name = the network
  mun:3550308 ob:directTo mun:4106902 , mun:3304557 , … .
}
<https://abiru.to/onibus/id/rede/deonibus/cometa> a ob:Network ;   # description, in the dataset's graph
  ob:operator op:cometa ; ob:complete true ; ob:linkCount 790 ;
  prov:wasDerivedFrom ds:deonibus .
```

The question "who links A to B?" becomes "which graphs contain `A ob:directTo B`?". It costs
one triple per link instead of a node per segment (2.5 MB instead of 18 MB), and
provenance lives on the network node. When a second source such as ANTT is added, its
networks become new graphs (`rede:antt/…`) next to the existing ones.

**Road geometry.** Every city pair linked by some company has one `ob:Route`, shared by
all companies on that pair. Its `ob:roadSegments` literal lists `ob:RoadSegment` ids in
travel order, and each segment carries a `geo:asWKT` LINESTRING. Segments run between the
junctions of the network formed by *all* routes. A stretch of highway used by 300 routes is
therefore stored once and drawn once, which is what makes lines overlap instead of forming a
hairball. The id list is a compact `ob:idList` literal rather than an `rdf:List`, because
there are tens of thousands of routes with dozens of segments each.

IRIs live under `https://abiru.to/onibus/`: `def#` (terms), `id/empresa/`,
`id/municipio/<IBGE code>`, `id/localidade/`, `id/rede/`, `id/rota/`, `id/estrada/`, `id/dataset/`. They don't
dereference yet, because GitHub Pages can't do content negotiation.

**Query it.** In the browser console, `grafo` is the store. The "sobre & dados" dialog also has
a SPARQL console ([Comunica](https://comunica.dev/), lazy-loaded) with example queries, such as
which companies link São Paulo to Curitiba, or a bike-friendliness ranking that joins our graph
with levabici's through `owl:sameAs`.

## Pipeline

Requires [uv](https://docs.astral.sh/uv/).

```sh
make scrape    # deonibus.com → data/raw/deonibus/<date>.json   (~7 min, 3 workers, 1 s pause)
make build     # latest snapshot → site/data/*.ttl|trig  + data/build-report.json
make roads     # city pairs → road routes → site/data/estradas.ttl (Docker + OSM extracts; see below)
make validate  # pyshacl: shapes.ttl over the union of all local dumps
make serve     # http://localhost:8000
```

- **Scrape** (`pipeline/scrape_deonibus.py`). It only visits `/viacao` and `/viacao/<slug>`,
  both allowed by robots.txt. About half the companies publish a full route list. The other
  half list only "popular routes", which are kept and flagged `ob:complete false`; the UI
  shows them as *lista parcial*.
- **Geocoding** (`pipeline/build_graph.py`). Labels ("Curitiba - PR") are matched to IBGE
  municipalities by normalized name, with a fuzzy match (≥0.92) inside the same state
  (99% of endpoints match). Districts fall back to the 2022 seed's OSM coordinates, and anything
  else goes to Nominatim at 1 req/s, cached in `data/raw/geocode-cache.json`. Foreign
  places get `schema:addressCountry` instead of `ob:uf`.
- **Routing** (`pipeline/route_roads.py`, Docker). Two routing graphs are used, because OSRM
  preprocessing for all of South America with minor roads doesn't fit in 16 GB of RAM:
  - *brasil*: the Geofabrik Brazil extract, motorway…tertiary plus links and ferries. It routes
    every pair with both ends in Brazil.
  - *exterior*: the South America extract, motorway…secondary only, cropped to Brazil plus the
    southern cone and Bolivia. It routes the ~130 pairs with an end in Argentina, Uruguay,
    Paraguay or Bolivia.

  Both extracts go in `data/raw/osm/` (~6 GB, not versioned). For each graph the stages are
  filter → OSRM `extract`/`partition`/`customize` → `osrm-routed` → route cache, and each stage
  re-runs only when its input is newer than its output. The routes are then merged into one
  shared-segment network with numpy (~5 min, ~1.5 GB RAM), simplified to ~200 m.

  A place more than 3 km from the filtered roads gets a straight connector to the network,
  flagged `ob:offRoad true` and drawn dashed. This affects a few dozen towns whose coordinates
  are far from any tertiary-or-better road. A pair with no route is drawn straight
  (`ob:straightLine true`).
- **levabici links**: an exact slug match, then a normalized name match, then
  `pipeline/levabici_aliases.json` for the rest. The aliases were checked against the routes in
  the reviews. Each build prints levabici bus companies that have no match.
  Currently unmatched: *buser, macaense, prata, princesa, uiramuta-transportes*. It also prints
  similar-looking names as alias suggestions (that is how deonibus's "Pássaro Marron" was matched
  to levabici's "Pássaro Marrom").
  None of these is on deonibus, or the match is ambiguous.

## Colors

- **By company.** Up to **4** companies are colored at once, 4 being the largest subset of the
  reference categorical palette that passes the colorblind-safety checks for *all pairs* in both
  themes. On a map any two lines can touch, so that is the right test. The rest of the network
  is grey, and its width grows with √(number of companies on that road). A company keeps its
  color while highlighted. Highlighted companies that share a road are drawn as parallel lines
  (`line-offset`), and the legend, tooltips and city panel name them, so color never carries
  identity alone. The default is the 4 largest networks.
- **By bike-friendliness.** Each road takes the *best* mean levabici score among the companies
  running on it, which answers "can I find a bike-friendly bus here?". It uses levabici's
  red→green hues. In dark mode it uses levabici's exact scale, where better means lighter. In
  light mode the ramp is re-stepped so that better means darker. Either way the best roads
  stand out most against the map. Roads with no rated company are grey.

The colors are CSS tokens in `site/style.css`, which `app.js` reads.

**View options.** The basemap can be light (OpenFreeMap Positron), dark, or pure black. The black
one has no roads or labels, so the bus network draws the country by itself. A checkbox hides the
grey "other companies" layer (in bike mode: roads with no rated company). The choice is kept in
the URL (`#fundo=preto&outras=0&empresas=…&cidade=…`), so views can be shared.

**Loading.** Road geometry is about 280k triples. The page reads it straight from the parsed quads
to draw the map, then adds it to the `N3.Store` in idle-time chunks. The SPARQL console waits for
that to finish.

## Deploy

`.github/workflows/pages.yml` validates the graph and publishes `site/` on every push to `main`.
`.github/workflows/refresh-data.yml` re-scrapes on the 1st of each month and opens a PR with
the diff.

It is served at **abiru.to/onibus**. abiru.to is the custom domain of the user site
(`danlessa/danlessa.github.io`), and GitHub Pages serves every project site of the account
under it at `abiru.to/<repo>/`. The repo is therefore named `onibus`, with no custom domain of its
own and no DNS record. The page only uses relative paths, so it works under a subpath.

One-time setup:

```sh
gh api -X POST repos/danlessa/onibus/pages -f build_type=workflow
```

## More data

`docs/data-sources.md` surveys other sources, written by the research agent in
`.claude/agents/bus-source-researcher.md` (re-run it with `/agents` or by asking Claude to use
*bus-source-researcher*). The top pick is **ANTT's SIGMA open data** (CC-BY, monthly). It lists
every interstate line and section with company CNPJ, and adds about 26k city pairs and 350 cities
that deonibus lacks. After that come the state regulators: DETRO-RJ, AGERBA-BA, ARTESP-SP
and DER-MG.

## Licenses

Code: AGPL-3.0. Data (`site/data/`): ODbL. Some coordinates come from OpenStreetMap
(Nominatim), and the operator/route listing is derived from deonibus.com. Municipality coordinates:
[kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros) (MIT).
Vendored libraries: MapLibre GL JS (BSD-3), N3.js (MIT). Basemap: [OpenFreeMap](https://openfreemap.org/)
© OpenMapTiles, © OpenStreetMap contributors.
