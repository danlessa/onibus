# Data sources — Brazilian inter-city bus services

Research log for `mapa-onibus-br` (map at abiru.to/onibus). Goal: records of the
form `(company, origin city, destination city)`, ideally with stops/sections,
schedules, geometry, CNPJ and validity date, covering more than the current seed
(deonibus.com marketplace listings, ~368 companies).

- **Last full check: 2026-09-22.** Every URL below was fetched on that date
  unless it is marked **unverified**.
- "Verified" means the URL was fetched and the fields quoted were seen in the
  response. Sample downloads were kept out of the repo.
- Brazilian law (Lei 12.527/2011, LAI) lets anyone ask a public body for data
  it holds. Where a regulator's web tool is blocked by robots.txt or a CAPTCHA,
  the suggested route is a LAI request (Fala.BR / e-SIC of the state), not
  scraping around the block.

---

## 1. Summary

| # | Source | Coverage | Company? | Stops / geometry | Format | License / ToS | Freshness | Status | Priority |
|---|--------|----------|----------|------------------|--------|---------------|-----------|--------|----------|
| 1 | ANTT — Gerenciamento de Autorizações (SIGMA): *Empresas, Linhas e Seções* | Interstate, 26 UFs (no AP) | Yes (CNPJ + razão social) | Sections (OD pairs sold); ordered section points per line (no coords) | CSV / JSON, monthly | CC-BY (dados.antt.gov.br) | Monthly; Set/2026 file dated 2026-09-09 | verified | **high** |
| 2 | ANTT — same dataset: *Pontos do Esquema Operacional* | Interstate | Yes | Ordered stops (terminal code + name + município), no coords | CSV (JSON is ~70× larger) | CC-BY | Monthly (2026-09-22) | verified | **high** |
| 3 | ANTT — same dataset: *Horários* | Interstate | Yes | — (departure times, weekdays, months) | CSV / JSON | CC-BY | Monthly (2026-09-22) | verified | medium |
| 4 | ANTT — *Serviços Paralisados* / *Histórico de Linhas* | Interstate | Yes | — | CSV / JSON | CC-BY | Monthly | verified | medium (filtering) |
| 5 | ANTT — *Empresas Habilitadas* (regular / semiurbano / fretamento) | Interstate | Yes (410 regular, 37 semiurbano) | — | CSV / JSON | CC-BY | Daily (2026-09-22) | verified | medium (crosswalk) |
| 6 | ANTT — Monitriip (bilhetes, viagens, paradas, semiurbano) | Interstate | Bilhetes: **no**; viagens/paradas: CNPJ + line no. | GPS points (paradas, some rounded to 1°) | CSV | CC-BY | Bilhetes monthly; viagens/paradas stopped Dec/2024 | verified | low |
| 7 | ANTT — Licenças Operacionais / Solicitações de Novos Mercados | Interstate | Yes | Markets only | CSV / JSON | CC-BY | **Discontinued** (last 2025-05) | verified (stale) | low |
| 8 | ARTESP — "Consulta de Origem e Destino" JSON endpoints | SP intra-state (regular rodoviário + suburbano) | Yes (+ CNPJ via GetEmpresa) | Ordered sections per line (city/terminal names) | JSON over POST (public form, CSRF token) | No robots.txt; no ToS found | Live | verified | **high** |
| 9 | ARTESP dados abertos — GTFS + "Estatísticas Mensais" | SP metropolitan (5 RMs, 841 lines) | GTFS: no (agency = ARTESP); XLSX: yes (21 operators) | GTFS shapes + stops | GTFS zip 47 MB; XLSX 29 MB | CC-BY | GTFS 2026-09-08; XLSX monthly | verified | medium |
| 10 | ARTESP "Relação de linhas" XLSX (2021 snapshot in github.com/danlessa/dados-abertos-artesp) | SP intra-state, 1,845 lines | Yes | — | XLSX | MIT repo / public | 2021-04-23 (stale); official URL now behind Incapsula | verified | low |
| 11 | DER-MG SGTI "Consulta Linhas Intermunicipais" | MG intra-state (~2,341 lines per SEINFRA) | Yes | Itinerary via line detail (idServicoLinha) | HTML (JSF/PrimeFaces form) | No robots.txt; no ToS found | Live | verified | **high** |
| 12 | DETRO-RJ "Tarifas, Horários e Itinerários" | RJ intra-state, 1,015 lines | Yes | Street-level itinerary (ida/volta, with município), fares per section, timetable | HTML (`include/linhas.php?parametro=`) | No robots.txt | Live | verified | **high** |
| 13 | RJ dados abertos — Bilhete Único Intermunicipal transactions | RJ metro area | Yes (operadora + linha) | — | Daily zipped CSV (up to ~130 MB unzipped) | License not specified | Daily (2026-09-20) | verified | low |
| 14 | DAER-RS "Relação de linhas ativas" PDF + "Empresas ativas regular" PDF | RS intra-state, 1,639 lines (2022) | Company **code** in lines PDF; code→name in 2025 PDF | — (extension km) | PDF (text, parseable) | Public | Lines 2022-03-09 (DAER says 1,566 active in Aug/2025); companies 2025-08-14 | verified | medium |
| 15 | DER-PR `/webservices/der/…` (localidade, empresas) | PR intra-state (~650 lines) | Yes (+ CNPJ on company page) | Ordered itinerary + section fares per line | HTML | **robots.txt `Disallow: /webservices/`**; company-name search has CAPTCHA | Live | verified | medium (LAI) |
| 16 | SC — SCMobi (SIE) | SC intra-state | Yes (behind reCAPTCHA) | Section points **with lat/lng + IBGE code** (public autocomplete) | JSON API | Line search gated by reCAPTCHA | Live | verified | medium (LAI) |
| 17 | AGERBA (BA) `agerba2.ba.gov.br/transporte/*.asp` | BA intra-state, 1,018 lines, 65 companies | Yes | Ordered localities per line; timetable page | HTML (classic ASP) | No robots.txt | Live | verified | **high** |
| 18 | CETURB-ES — SITRIP JSON API (`sitrip.ceturb.es.gov.br/api/…`) | ES intra-state, 302 lines, 15 companies | Yes (name, no CNPJ) | 31,950 section pairs with fare + km; section stops **with lat/lon**; timetables | JSON (GET, no auth) + XLSX/PDF export | No robots.txt (404); no ToS found | Daily (`dt_ultima_atulizacao_db` 2026-09-22) | verified | **high** |
| 19 | AGR-GO — CKAN "empresas autorizadas…" CSV + "quadro de horários" XLSX + per-line PDFs | GO intra-state, 285 lines, 32 companies | Yes (name, no CNPJ) | Per-line PDFs: seções (cities in order), road route, km, timetable | CSV (+ datastore API) / XLSX / PDF (text) | CC-BY | CSV 2025-07; XLSX 2025-06; PDFs up to 2026-09 | verified | **high** |
| 20 | AGER-MT — line lookup app (`http://191.223.235.122:5081`) | MT intra-state, ~130 lines (current concessionaires) | Yes | Section pairs with km + fare (= intermediate stops); timetable | HTML (POST form + GETs) | No ToS found; plain HTTP on a bare IP | Live | verified | **high** |
| 21 | EPTI-PE — "Projeção das Linhas" PDFs (8 districts) + per-operator tariff PDFs | PE intra-state, ~200 line+company, 4 permissionárias | Yes | Tariff PDFs: seções per line with km + fare | PDF (text) | Public, no license | Lines 2026-03-16; tariffs 2023–24 | verified | medium |
| 22 | ARCON-PA — tabela tarifária rodoviária | PA intra-state, 205 lines, ~2,477 sections, ~55 companies | Yes | Sections (OD pairs with fare) + "via" | PDF (text, 22 pp) | Public, no license | Tariffs 2019 (PDF 2021); partial 2022 table | verified (stale) | medium |
| 23 | ARCE-CE — "Serviço Regular Interurbano 2021-2022" XLSX | CE intra-state, 181 lines, 6 companies | Yes | Seção city pairs with fare (5,267 pairs) | XLSX in zip (12.9 MB) | No license stated | Jan/2021–Dec/2022 (stale, reporting gaps) | verified | medium |
| 24 | ARCE-CE — GTFS | CE metro (RMF) + Cariri only, 119 routes | No (agency = Arce) | Shapes + 3,313 stops | GTFS zip 3.9 MB | Public | Calendar ended 2025-12-31 | verified | low |
| 25 | AGEMS-MS — "Autorizações Sistema TRIP" (DOE, ATA 001/2025) | MS intra-state, 133 lines, ~22 operators | Yes | — | PDF (text, 7 pp) | Public | Valid to 2026-11-18 | verified | medium |
| 26 | ARSAL-AL — CKAN quadro de horários (convencional + complementar) + tarifas | AL: 26 convencional lines (7 companies) + 182 complementar | Convencional yes; complementar **no** | Seccionamentos (city list), road itinerary, timetable | PDF (text) via CKAN | CC-BY | Dec/2025 | verified | medium |
| 27 | SINFRA-MT — "Contratos e permissões" (lot → company) + Projeto Básico 2025, Anexo C | MT, 8 markets; ~162 lines (pre-concession operators) | Yes | Anexo C: OD per line; table 4.14: seções | HTML + PDF (22 MB) | Public | Contracts live; Anexo C historical | verified | low |
| 28 | Legislation annexes on LegisWeb: MOB-MA Portaria 290/2022, AGEAC-AC Res. 35/2015, DER-PB Res. CE 25/2025, CET-SE Res. 1/2025 | MA 138 rows, AC 34 lines, PB 21 lines, SE ~150 lines | MA/AC/PB yes; SE only per table | — | HTML tables | Official acts | 2015–2025 | verified | low |
| 29 | SETRAP-AP "Viagens intermunicipais e preços" | AP, ~22 OD pairs | **No** | — (times, km, fare) | HTML table | Public | Undated | verified | low |
| 30 | FlixBus Brazil GTFS (`gtfs.gis.flix.tech/gtfs_generic_brazil.zip`) | Interstate, FlixBus network: 15 routes, 53 stops | Brand only ("FlixBus-br") | Stops with coords + shapes | GTFS zip (100 KB) | Not stated | 2026-09-20 (valid to 2027-03-20) | verified | medium |
| 31 | Grande Recife GTFS | RM Recife, 388 routes | Yes (10 operators in agency.txt) | Stops + shapes | GTFS zip (38 MB) | Not stated | 2026-09-22 | verified | low |
| 32 | RMBH metropolitan lines (IDE-Sisema WFS) | RMBH, 1,054 line features | Yes (`operadora`) | Line geometry | WFS → SHP / XLSX / GeoJSON | Not checked | Not checked | verified | low |
| 33 | Quero Passagem route pages (+ Rodon, same backend) | National: ≈548k stop-level route URLs, 402 companies | Yes (JSON-LD `BusTrip.provider`) | Stop names + times, no coords | HTML + JSON-LD; sitemaps | robots permissive; no scraping clause found | Live (scrape date only) | verified | **high** (gap-filler) |
| 34 | deonibus.com route pages (seed site) | National: ≈157k route URLs, 368 companies | Yes, per leg (incl. connections) | Stop ids + times | SSR JSON (`__PRELOADED_STATE__`) | robots allow `/passagens-de-onibus/` (not `?departureDate=`) | Live (scrape date only) | verified | **high** |
| 35 | Buson (ex-Guichê Virtual; Busbud) route pages | National: ≈102k BR pairs, 328 operators | Yes (JSON-LD `BusTrip.provider`) | Stop names + times | HTML + JSON-LD; sitemaps | robots permissive; ToS not found | Live | verified | medium |
| 36 | ClickBus route pages | National: 261,742 city pairs, 231 company pages | Yes (logo alt text) | — | HTML (Next.js SSR) | **ToS forbids automated extraction** | Live | verified | low (ToS) |
| 37 | Buser `llms-full.txt` + `/ai/onibus/{o}/{d}.md` | 4,381 pairs, 626 partners (CNPJ on partner pages) | Yes (charter partner) | Boarding addresses | Markdown | robots `Allow: /ai/`; `ai-train=no` | Live (7 days) | verified | low |
| 38 | BuscaOnibus (timetables + `locations.js`) | 301 companies, 1,459 origin timetable sitemaps | Yes | 3,878 locations with lat/lng | HTML + JS | `Crawl-Delay: 10` | Live | verified | low (gazetteer) |
| 39 | Rodoviária de Belo Horizonte site | BH hub: companies × destinations (459 destination pages) | Yes | — | HTML (WordPress) | robots permissive | Live | verified | low |
| 40 | OpenStreetMap (Overpass / Geofabrik taginfo) | 7,873 `route=bus` rel. (~40 ANTT, ~510 intercity-ish), 0 `route=coach`; 4,438 `amenity=bus_station` | Partly (`operator`) | Full geometry | OSM | ODbL | Live | verified | low (stations: medium) |
| 41 | IBGE Ligações Rodoviárias e Hidroviárias 2016 | 65,639 municipality pairs, 5,423 municipalities | **No** | Seat coords | ODS (complete) / XLSX (truncated at 65,535) | IBGE open data | 2016 | verified | medium (coverage check) |
| 42 | IBGE REGIC 2018 — Ligações + Rotas | 32,062 links; 71,081 modelled routes (km, min) | No | Route geometry in a 716 MB zip | XLSX / ODS / SHP | IBGE open data | 2018 (routes 2021) | verified (tabular) | low |

Rows 18–29 are detailed in §3.8 (one §3.8.x subsection per state). RN, PI, TO, AM, RO, RR and
DF publish no usable line list. GTFS, marketplaces, terminals, OSM and IBGE are in §4–§8
(rows 30–42).

---

## 2. Federal regulator — ANTT (interstate)

Portal: <https://dados.antt.gov.br> (CKAN, 106 datasets on 2026-09-22).
`robots.txt`: `Disallow: /api/`, `Crawl-Delay: 10`; file downloads under
`/dataset/<id>/resource/<id>/download/…` are allowed. License on all datasets
below: "Creative Commons Atribuição" (CC-BY).

### 2.1 Gerenciamento de Autorizações (SIGMA) — **the primary source**

- Dataset: <https://dados.antt.gov.br/dataset/gerenciamento-de-autorizacoes>
  (id `a8729428-f382-430c-abe5-6e5f85aa9a03`). 2021–2024 history in
  <https://dados.antt.gov.br/dataset/gerenciamento-de-autorizacoes-2021-2024>.
- Five monthly resources, each as CSV and JSON, named `MM-YYYY_<name>_sigma.{csv,json}`
  (e.g. `Set2026 - Empresas, Linhas e Seções - SIGMA`). Monthly series from Jan/2025
  to Set/2026 in this dataset.
- CSV: `;`-separated, **ISO-8859-1**, CRLF, dates `DD/MM/YYYY` (some files use
  `MM/DD/YYYY`, e.g. histórico and paralisados — parse defensively). JSON is UTF-8,
  wrapped as `{"empresas_habilitadas_regular":[…]}`.
- Data dictionaries (PDF) are in the same dataset (`linhas_secoes_dicionario_dados_v2.pdf`,
  `pontos_esquema_operacional_dicionario_dados.pdf`, `horarios_dicionario_dados.pdf`, …).

Resource URLs checked (Set/2026):

| Resource | URL | Size | Rows |
|---|---|---|---|
| Empresas, Linhas e Seções | `https://dados.antt.gov.br/dataset/a8729428-f382-430c-abe5-6e5f85aa9a03/resource/26a878de-7523-426c-8beb-196004eb42e8/download/09-2026_empresas_linhas_secoes_sigma.csv` | 16.7 MB | 84,518 |
| Pontos do Esquema Operacional | `…/resource/a443658d-9dfc-4496-9068-d806abd9924e/download/09-2026_pontos_do_esquema_operacional_sigma.csv` | 4.7 MB | 23,303 |
| Horários | `…/resource/079bd90a-efd9-466c-adc0-c8bf82a69d0d/download/09-2026_horarios_sigma.csv` | 2.3 MB | 10,454 |
| Serviços Paralisados | `…/resource/7e2c36b8-fbba-4074-81a9-0fc81aec2f53/download/09-2026_servicos_paralisados_sigma.csv` | 19.5 MB | ~102k |
| Histórico de Linhas | `…/resource/b1de8dc2-fca0-44de-be54-c92028fa8ef4/download/09-2026_linhas_historico_sigma.csv` | 41.6 MB | ~82k |

Resource ids change every month, so resolve them from the dataset page (or one
`package_show` call) rather than hard-coding them.

**Empresas, Linhas e Seções**. Columns:
`cnpj;razao_social;numero_tar;numero_lop;data_autorizacao;prefixo;descricao_linha;tipo_servico;municipio_origem;uf_origem;municipio_destino;uf_destino;extensao_secao;outorga_secao;ambito_linha`

```
"32.285.454/0001-42";"AGUIA BRANCA TRANSPORTES S A";;;"06/11/2024";"RJSP0030026";"RJ/Teresópolis - SP/São Paulo";"Semileito";"Magé";"RJ";"São Paulo";"SP";;"AUTORIZACAO";"INTERESTADUAL"
```

Profile of the Set/2026 file:
- 184 companies (CNPJ), 1,995 lines (`prefixo`, e.g. `GOTO0113002`: UF pair + company
  number + sequence), 84,518 sections.
- 40,706 unordered city pairs; 54,711 (company, city pair) combinations; 2,103 cities in 26 UFs
  (none in AP).
- Every row is `ambito_linha=INTERESTADUAL` with an interstate section (0 same-UF rows),
  because intra-state legs of interstate lines cannot be sold.
- `outorga_secao`: AUTORIZACAO 72,777 · AUTORIZAÇÃO JUDICIAL 11,741.
- `tipo_servico`: Básica, Executiva, Semileito, Leito, Cama, blank (1,969).
- `numero_tar`, `numero_lop`, `extensao_secao` are empty in the CSV (JSON has `"NA"`/`0.00`).
- Top companies by sections: Planalto, Gontijo, Solimões, Ouro e Prata, Expresso Maia,
  Itamarati, Guanabara, Norte Sul, Novo Horizonte, São Luiz.

A "section" is a market the company may sell (origin–destination on the line),
**not** a consecutive road segment. For map segments use the next resource.

**Pontos do Esquema Operacional**. Columns:
`cnpj;razao_social;data_autorizacao;prefixo;descricao_linha;tipo_veiculo;sequencia_ponto_linha;nome_ponto_parada;municipio_uf;secao;apoio;lanche;refeicao;troca_de_motorista;troca_de_veiculo`

```
00.018.127/0001-38;TOCANTINS TRANSPORTE E TURISMO LTDA;11/05/2024;GOTO0113002;GO/Goiânia - TO/Palmas;Executiva;2;GO00105 TERMINAL RODOVIÁRIO DE ANÁPOLIS;Anápolis - GO;Sim;Não;Não;Não;Não;Não
```

- 1,995 itineraries (company × line × vehicle type), 183 companies, 2,846 distinct stops.
- `nome_ponto_parada` starts with an ANTT stop code (`UF` + 5 digits, e.g. `GO00071`).
  There are **no coordinates**. No ANTT dataset with stop coordinates was found.
- The CSV contains only section points (`secao=Sim`). The JSON (237–372 MB/month)
  repeats the same fields and appears to hold many duplicated records. Use the CSV.
- Consecutive distinct municipalities per itinerary give **4,801 city-to-city
  segments** (10,147 company-segments). This is what the map should draw for
  interstate services.

**Horários**. Columns:
`cnpj;razao_social;data_autorizacao;prefixo;descricao_linha;tipo_veiculo;sentido;horario;gratuidade;segunda_feira…domingo;janeiro…dezembro` (`x` = operates).
10,454 rows, 179 companies, 1,973 lines. Enough for a "departures/week" weight per line.

**Serviços Paralisados**. Same columns as the sections file plus `data_paralisacao`
(102k rows, 828 lines, mostly paralysed in 2026). Only 297 of its sections are also in
the current sections file. Anti-join them anyway.

**Histórico de Linhas**. Columns:
`cnpj;razao_social;data_autorizacao;prefixo;descricao_linha;tipo_servico;outorga_secao;data_atualizacao;protocolo_historico;decricao_historico;situacao_servico;ambito_linha`
(`situacao_servico`: Ativo, Em Elaboração, Inativo, …). Useful for validity dates.

**Coverage gain over the seed.** Compared on 2026-09-22 with `data/raw/deonibus/2026-09-23.json`,
matching city pairs on accent-stripped names + UF:
- deonibus has 36,169 unordered city pairs: 18,016 interstate and 18,153 intra-state.
- ANTT sections have 40,706 pairs. 14,710 are also in deonibus and **25,996 are
  interstate pairs deonibus lacks**. 3,306 deonibus interstate pairs are not in ANTT
  (name mismatches, "todos" terminals, or unlicensed operators).
- ANTT touches 2,103 cities, 350 of which never appear in deonibus.

Caveats:
- An authorization does not prove the service runs. Cross-check with Horários: a line
  with no timetable is probably not operated.
- City names are the IBGE names with accents in the CSV (Latin-1). Match to IBGE codes on
  `(normalized name, UF)`.
- Company names are legal names (razão social), e.g. `EMPRESA GONTIJO DE TRANSPORTES S/A`.
  deonibus uses brand names, so keep a manual brand↔CNPJ crosswalk.

**Next step (pipeline/)**: follow the deonibus pattern (`scrape_deonibus.py` →
`data/raw/deonibus/<date>.json` → `build_graph.py` → `site/data/deonibus.trig` + `catalog.ttl`).
1. Add `pipeline/scrape_antt.py`. It resolves the latest `*_empresas_linhas_secoes_sigma.csv`,
   `*_pontos_do_esquema_operacional_sigma.csv`, `*_horarios_sigma.csv` and
   `*_servicos_paralisados_sigma.csv` from the dataset page and saves them under
   `data/raw/antt/<date>/` unchanged (≈45 MB).
2. In `build_graph.py`, read them with `encoding="latin-1", sep=";"`.
3. Build segments from consecutive `municipio_uf` in pontos, grouped by
   `(cnpj, prefixo, tipo_veiculo)` and ordered by `sequencia_ponto_linha`.
4. Match to `data/raw/ibge/municipios.csv`.
5. Emit a named graph per company in `site/data/antt.trig`, keyed by CNPJ, with
   `prov:wasDerivedFrom` the resource URL and `dcterms:valid` from `data_autorizacao`.
   Register it in `catalog.ttl`.
6. Link to deonibus companies with `owl:sameAs` via a hand-kept brand↔CNPJ alias file, as is
   already done for levabici.
Refresh monthly.

### 2.2 Empresas Habilitadas

- <https://dados.antt.gov.br/dataset/empresas-habilitadas> (updated daily; 703 resources).
- `empresas_habilitadas_regular_09_2026.csv` (410 rows): `razao_social;cnpj;numero_tar;vigencia`
  — `https://dados.antt.gov.br/dataset/c7edbb2b-a6ea-49d9-b807-0db8f336022b/resource/b81bc5b6-4b4b-48ac-b26b-e4889cb5b266/download/empresas_habilitadas_regular_09_2026.csv`
- `empresas_semiurbano_09_2026.csv` (37 rows): `cnpj;razao_social;validade_habilitacao;situacao_empresa`.
- `empresas_habilitadas_fretamento_09_2026.csv` (677 KB): charter companies (out of scope).
- Use: the CNPJ ↔ legal-name crosswalk. 410 companies are licensed but only 184 have lines in SIGMA.

### 2.3 Monitriip (monitoring)

- **Bilhetes de Passagem**: <https://dados.antt.gov.br/dataset/monitriip-bilhetes-de-passagem>,
  monthly CSV (`venda_passagem_MM_YYYY.csv`, 5–22 MB; Ago/2026 is the latest). Columns:
  `mes_emissao_bilhete;mes_viagem;ponto_origem_viagem;ponto_destino_viagem;tipo_servico;tipo_gratuidade;media_valor_total;dp_valor_total;quantidade_bilhetes`.
  It has **no company column**. Use it only for OD demand weights (e.g. line thickness).
- **Serviço Regular – Viagens / Paradas**: `viagem_regular_MM_YYYY.csv` has
  `codigo_viagem;cnpj;placa;nu_linha;…;latitude;longitude;…`, and
  `parada_regular_MM_YYYY.csv` (18–140 MB/month) has `cnpj;…;latitude;longitude;…;nu_linha`.
  **Last month published: Dec/2024.** About half of the parada coordinates are rounded to
  whole degrees. Low value.
- **Semiurbano**: `monitriip-transporte-rodoviario-semiurbano-de-passageiros8_2026.csv`,
  with trips per `cnpj;razao_social;sentido_linha;nu_linha;…`. It has no OD names. Low value.

### 2.4 Discontinued / minor ANTT datasets

- **Licenças Operacionais [Descontinuado]** (last file `licencas_operacionais_05_2025.csv`):
  `cnpj;razao_social;numero_tar;numero_lop;mercado`, where mercado is `APUI(AM) - ARIQUEMES(RO)`.
  Superseded by §2.1.
- **Solicitações de Novos Mercados [Descontinuado]** (last 2025-05): requested markets per company.
  Requests are not operations.
- **Internacional – Linhas Acordadas Mercosul**: `linhas-acordadas-mercosul-07-2026.csv`
  (`Origem_x_Destino;Ligacao;Numero;Linha;Frequencia;Acordo;Tipo_de_Servico;Secoes;Ponto_Fronteirico;Observacoes`).
  The CSV is malformed (fields split mid-text); try the JSON. Low priority.
- **Transporte Rodoviário de Passageiros** (2022): only a Power BI link.

---

## 3. State regulators (intra-state intercity)

### 3.1 São Paulo — ARTESP

**(a) "Consulta de Origem e Destino" JSON endpoints — high.**
Page: <https://extranet.artesp.sp.gov.br/TransporteColetivo/OrigemDestino> (public, no login).
A GET sets a session cookie and embeds a `__RequestVerificationToken`, which is an
anti-CSRF token issued to every visitor, not auth. The page's own AJAX calls are:

| Call | Params | Returns (verified sample) |
|---|---|---|
| `GET /TransporteColetivo/Json/municipios.json` | — | 645 SP municipalities `{"Codigo":100,"Descricao":"SÃO PAULO"}` |
| `POST /TransporteColetivo/OrigemDestino/GetGrid` | `origem`, `destino`, token | companies serving the pair: `[{"Empresa":{"Codigo":494,"Descricao":"RAPIDO RIBEIRAO PRETO LTDA"},…},{"Empresa":{"Codigo":660,"Descricao":"VIAÇÃO COMETA S/A"}}]` (São Paulo→Ribeirão Preto) |
| `POST …/GetGridAutos` | `origem`, `destino`, `empresa`, token | lines: `{"Codigo":1068,"CodigoAutos":6267,"NomeLetra":"A","CodigoDigito":1,"NomeSecaoOrigem":"RIBEIRAO PRETO","NomeSecaoDestino":"SÃO PAULO (T.TIÊTE)","NomeCaracteristica":"Rodoviária Convencional"}` |
| `POST …/GetGridSecao` | `linha` (=`Codigo`), token | ordered sections `["SERTAOZINHO","RIBEIRAO PRETO","SÃO PAULO (T.TIÊTE)"]` |
| `POST …/GetEmpresa` | `empresa`, token | CNPJ, address, phone, e-mail |

- `GetGridSecao` answers for internal line ids in a low range (id 100 → `["PONTAL","CANDIA","MORRO AGUDO"]`;
  2000+ returned `[]`).
- Crawl plan (about 3 requests per line; ARTESP has ~1,800 lines):
  (1) walk `linha` ids 1..~2000 with `GetGridSecao` to get each itinerary;
  (2) call `GetGrid` for the itinerary's first/last municipalities to get the companies;
  (3) call `GetGridAutos` per company to match `Codigo`, then `GetEmpresa` once per company.
  Throttle to ≤1 req/s.
- Legacy page <https://extranet.artesp.sp.gov.br/origemDestino/> is a dead Flash app.
- **Next step**: `pipeline/scrape_artesp.py` (raw JSON to `data/raw/artesp/<date>.json`) implementing the crawl above. Cache the raw JSON
  and emit segments from consecutive sections (map terminal names such as `SÃO PAULO (T.TIÊTE)`
  to municipalities).

**(b) ARTESP open-data portal — medium.** <https://dadosabertos.artesp.sp.gov.br> (CKAN;
the API needs POST, e.g. `POST /api/3/action/package_search {"rows":500}`; robots
`Disallow: /api/`, `Crawl-Delay: 10`). 46 datasets. Relevant ones:
- `gtfs`: `https://dadosabertos.artesp.sp.gov.br/dataset/92e8bb31-df66-4700-ad9a-42a48f04fb7f/resource/c84986d6-f6f1-4f41-8155-6287dd8391a7/download/artesp_gtfs.zip`
  (47 MB, 2026-09-08, CC-BY). It covers the **metropolitan** (ex-EMTU) network: 823 routes,
  `shapes.txt` 57 MB, `stop_times.txt` 202 MB unzipped. `agency.txt` has a single agency
  "ARTESP", so there is **no operator**. `route_long_name` looks like
  `ITAPECERICA DA SERRA (PARQUE PARAISO) - SAO PAULO (METRO CAPAO REDONDO)`.
- `paineis-de-dados-onibus` → `transporte_coletivo_2025_2026.xlsx` (29 MB, monthly rows):
  columns `ANO, MES, LINHA, DENOMINACAO DA LINHA, MODAL, …, REGIAO_METROPOLITANA, AREA, EMPRESA, SERVICO, EXTENSAO, CARACTERISTICA, TARIFA, TOTAL_PASSAGEIROS, …, TOTAL_VIAGENS, QUILOMETRAGEM_PERCORRIDA`.
  The file has 215k rows, 841 lines, 21 operators and 5 RMs (São Paulo, Baixada Santista,
  Campinas, Sorocaba, Vale do Paraíba). It is **metropolitan only**. Join it to the GTFS on
  (RM, LINHA) to get the operator and passenger volume.
- `relatorios-tarifarios-do-transporte-regular` only links to an ARTESP web page.
- **Next step**: optional "metropolitan" layer. Parse the GTFS with shapes, join EMPRESA from
  the XLSX and flag the rows `service_class=metropolitano`.

**(c) "Relação de linhas" XLSX — low (stale).**
Official URL `http://www.artesp.sp.gov.br/Shared%20Documents/Dados%20Abertos/TransporteColetivo/Rela%C3%A7%C3%A3o%20de%20linhas.xlsx`
now returns an Incapsula bot-challenge page. The user's own mirror
<https://github.com/danlessa/dados-abertos-artesp> (`Transporte Coletivo/Relação de linhas_23_04_2021.xlsx`)
has 1,845 lines with columns `Permissionária, Autos, Denominação da Linha, Extensão, Característica`
(e.g. `RAPIDO LUXO CAMPINAS LTDA | 0001-A-1 | Jundiaí - Franco da Rocha | 34.9 | Suburbano Convencional`).
Useful as a fallback and to validate (a).

### 3.2 Minas Gerais — DER-MG / SEINFRA

- Tool: <http://www.consultas.der.mg.gov.br/grgx/sgti/consulta_intermunicipal.xhtml> (JSF + PrimeFaces,
  plain HTTP, no robots.txt). Origin **and** destination municipality are required.
- Verified flow:
  1. GET the page for `JSESSIONID` + `javax.faces.ViewState`.
  2. Autocomplete: POST with `javax.faces.partial.ajax=true`,
     `javax.faces.source=form_tab1:tabview:dropMunicipioOrigemTab1` and
     `…_query=MONTES`. It returns `<li data-item-value="25094" data-item-label="MONTES CLAROS">`.
     The destination field is `form_tab1:tabview:j_idt22` (BH = `22274`).
  3. Submit: POST `form_tab1:tabview:dropMunicipioOrigemTab1_input/_hinput`,
     `form_tab1:tabview:j_idt22_input/_hinput`, `form_tab1:tabview:consultaBtn`, ViewState.
- Result table: `Número | Descrição | Empresa | Origem | Destino`, including lines that only pass
  through both places. Sample for Montes Claros→Belo Horizonte:
  `1041 BELO HORIZONTE - MONTES CLAROS TRANSNORTE S.A.`, `1126 BELO HORIZONTE - JANUARIA EMPRESA GONTIJO DE TRANSPORTES S.A.`,
  `1158 BELO HORIZONTE - SALINAS … TRANSNORTE S.A.`
- Each row has a detail action (`idServicoLinha=12144`, `trajeto=V`) with the itinerary and timetable.
- SEINFRA says the system has 2,341 lines (regular + partial). The MG CKAN portal (dados.mg.gov.br)
  has no bus dataset and returns 403 to non-browser user agents. The old SEINFRA pages
  (`infraestrutura.mg.gov.br/.../1336-onibus-intermunicipais`, `transportes.mg.gov.br`) are 404 or
  time out after the move to WordPress, and the "relação das linhas e empresas delegatárias" PDF
  was not found (**unverified**).
- **Next step**: snowball crawler (`pipeline/scrape_der_mg.py`). Seed with each municipality ×
  {BH + its regional hub}, collect `idServicoLinha` ids, fetch each detail page for the full
  itinerary, and add newly seen municipalities to the queue. Use one session and ≤1 req/s.
  An alternative is a LAI request to SEINFRA for the SGTI line table.

### 3.3 Rio de Janeiro — DETRO-RJ

- Page: <http://www.detro.rj.gov.br/regulares-tarifas-itinerario>. Its `<select id="linhas">`
  has **1,015 lines**, each option being
  `value="108053007"` → `SEM Nº - Aeroporto Internacional - Macaé S/VIA - Rodoviário com Ar Condicionado - AUTO VIAÇÃO 1001 LTDA.`
  So the page alone gives line number, OD, via, service type and company for every line.
- Detail (loaded via jQuery `.load`):
  `GET http://www.detro.rj.gov.br/regulares-tarifas-itinerario/include/linhas.php?parametro=<value>` (HTTP 200, HTML).
  It has NÚMERO, LIGAÇÃO, VIA, EMPRESA (`108 - AUTO VIAÇÃO 1001 LTDA.`), CARACTERÍSTICA,
  fares per section, the timetable (weekday grid) and the **street-level itinerary for IDA and
  VOLTA with município per step** (e.g. …BR 101 NITERÓI → Trevo de Manilha ITABORAÍ → BR 101
  TANGUÁ → RIO BONITO → RJ 168 MACAÉ).
- Company registry (104 companies, paginated):
  <http://www.detro.rj.gov.br/operacao/empresas-onibus-intermunicipais> (`&pag=N`), with
  "Registro: RJ - 108", address, site and phone. There is no CNPJ.
- It mixes metropolitan "Urbano" and long-distance "Rodoviário" lines. Keep `CARACTERÍSTICA`
  so the map can filter.
- No robots.txt (the path returns an HTML page). RJ's CKAN (dadosabertos.rj.gov.br) has no DETRO line dataset.
- **Next step**: `pipeline/scrape_detro_rj.py`. Parse the select options (1 request), then 1,015
  detail GETs at ≤1 req/s. Segments come from consecutive distinct municipalities of the IDA itinerary.

Also in RJ: `setram_sbu` (Bilhete Único Intermunicipal) on <https://dadosabertos.rj.gov.br/dataset/setram_sbu>.
It has daily `TRANSACAO_BU_PUBLICO_YYYY_MM_DD.csv.zip` files with
`Nº Cartão;Descrição da Aplicação;Sindicato;Operadora;Linha;Nº Carro;Sentido;…;Vl Linha;…`
(e.g. `TB Transportes Blanco Ltda … ;193C - CENTRAL - PARACAMBI`). They cover metro lines only,
are 126 MB unzipped per day and carry no license. Low priority, but usable as demand weights.

### 3.4 Rio Grande do Sul — DAER-RS

- Lines PDF (53 pages, text layer, **1,639 active lines**, dated 09/03/2022):
  <https://daer.rs.gov.br/upload/arquivos/202203/09123725-linhas-ativas-2022.pdf>.
  Each row reads `- /5 PORTO ALEGRE - ARROIO GRANDE (VIA FEDERAL) 6882 17/04/85 17/04/0540 LC C/ICM 362,00 1955 CONCESSAO`:
  line number, description (O - D via), contract no., start/end dates, **company code**
  (fused with the end date, "…/05" + "40"), type (`LC C/ICM`, `SUB INT`, …), extension km,
  year and modality. It has to be parsed with care. An older 2016 edition is at
  `/upload/arquivos/201608/18104010-relau-u-o-de-linhas.pdf`.
- Company codes → names: "Relatório gerencial – empresas ativas regular" (14/08/2025, 5 pages):
  <https://www.daer.rs.gov.br/upload/arquivos/202508/14181550-confira-a-relacao-de-transportadoras-cadastradas.pdf>
  (`4 - TRANSPORTES BRISAS DO SUL LTDA ATIVO`, …).
- Stations: `https://www.daer.rs.gov.br/upload/arquivos/202205/30163345-rodoviarias-ativas.pdf` (**unverified** content).
- DAER's page (<https://www.daer.rs.gov.br/transporte-regular>) reports 1,566 active lines in Aug/2025,
  so the 2022 PDF is ~5% stale. dados.rs.gov.br has nothing on buses.
- **Next step**: `pipeline/scrape_daer_rs.py`. Parse both PDFs with `pypdf`/`pdfplumber` and a regex
  on the row layout, join code→name, and geocode O/D from the description. Ask DAER (LAI) for a
  current export of the STC system ("ARSTC005 – relação de linhas").

### 3.5 Paraná — DER-PR

- Tool: <https://www.der.pr.gov.br/webservices/der/localidade> (Drupal/Celepar, behind an F5 TSPD
  script, but it answers plain requests).
  - Municipality `<select id="txMunicipioOrigem">`: 399 options (`value="7425"` = APUCARANA).
  - `POST /webservices/der/carregarLocalidade` `municipio=7425` → `<option value=71701018>APUCARANA (1)…`.
  - `POST /webservices/der/localidade` with `txMunicipioOrigem, txLocalidadeOrigem, submit=Consultar`
    (destination optional) returns "LINHAS QUE PASSAM PELAS LOCALIDADES SELECIONADAS":
    `Linha | Empresa | Itinerário | Tipo (R rodoviário / M metropolitano) | Serviço | Tarifa`.
  - `GET /webservices/der/empresas/detalhe/{empresaId}/{linha}` (e.g. `/7/001.0224-440`) returns the
    ordered itinerary and section fares.
  - `GET /webservices/der/empresas/{empresaId}` (e.g. `/7` = VIACAO GARCIA LTDA) returns
    **CNPJ 78.586.674/0001-07**, address and every line of the company (`001.0224-440 APUCARANA - MANDAGUARI M Convencional 7,10`).
- **Constraint**: `https://www.der.pr.gov.br/robots.txt` has `Disallow: /webservices/`, and the
  company-name search form has a CAPTCHA. Do **not** crawl it automatically. DER-PR says it has
  650+ lines.
- **Next step**: file a LAI request to DER-PR (Diretoria de Operações / Transporte Comercial) for the
  line/company/itinerary table. Meanwhile, a few manual lookups can validate the other sources.

### 3.6 Santa Catarina — SIE (SCMobi)

- SIE's site (<https://www.sie.sc.gov.br/transporte-intermunicipal>, Angular SPA) links to
  **SCMobi** (<https://scmobi.sie.sc.gov.br/horarios> "Consulta linhas" and
  `/transportadoras`, a Vue SPA).
- Public API seen in the bundle (`/js/app.*.js`):
  - `GET https://scmobi.sie.sc.gov.br/api/public/section-point/search?search=florian` works without a
    token. It returns section points with coordinates and IBGE code:
    `{"idpontosecao":509,"nmlocalidade":"TICEN","delocalidade":"Terminal de Integração do Centro","gelat":"-27.598286821579","gelng":"-48.553908449094","nmmunicipio":"Florianópolis","codibge":"4205407",…}`.
  - `GET /api/public/section/{idpontosecaoOrigem}/{idpontosecaoDestino}` returns the lines and
    companies for a pair. The UI gates it behind **reCAPTCHA** (`POST /api/public/recaptcha`), so do
    not call it programmatically.
- The old `deter.sc.gov.br` / `sitrap.deter.sc.gov.br` are legacy. dados.sc.gov.br has nothing on buses.
- **Next step**: LAI request to SIE/SC for the SCMobi line table (linhas, seções, transportadoras).
  The public section-point autocomplete is a good **stop geocoder** for SC. Use it sparingly (one
  query per municipality) or ask for the full point list in the same LAI request.

### 3.7 Bahia — AGERBA

- Menu: <http://www.agerba2.ba.gov.br/transporte/index.asp> (classic ASP, ISO-8859-1, plain HTTP, no robots.txt).
  - `prestadora_servico.asp` lists **65 companies** (`Empresa`, `Nome Fantasia`, `Nº Cad`), each with
    a link `linhas_empresa.asp?empresa=<RAZÃO SOCIAL>`.
  - `linhas_empresa.asp?empresa=AUTO%20VIA%C7%C3O%20CAMURUJIPE%20LTDA` lists
    `Linha: 006 | Nome da Linha: JEQUIÉ - UBAITABA VIA ORICÓ | Sistema: REGIONAL | Tipo de Veículo: ÔNIBUS RODOVIÁRIO CONVENCIONAL | Categoria: COM`.
  - `localidade_linha.asp` has a `<select name="sel_linha">` with **1,018 lines** (`005 - ITABUNA - FEIRA DE SANTANA VIA CONCEIÇÃO DE FEIRA`).
  - `POST pesq_localidade_linha.asp` `sel_linha=005` returns the **ordered localities with sections**:
    `1 ITABUNA, 2 UBAITABA, 3 GANDU, 4 TEOLÂNDIA, 5 ENT VALENÇA, 6 SANTO ANTÔNIO DE JESUS, …, 12 FEIRA DE SANTANA`,
    plus a link `quadro_horario.asp?num linha=005` (timetable).
  - Per-company tariff tables (PDF/XLS, 2017–2022) are at `tarifas_transporte.asp`. Newer ones
    ("Tabelas tarifárias 2024-2025") are at <https://www.ba.gov.br/agerba/publicacoes/Tarifas>.
- Localities include non-municipal points ("ENT VALENÇA" = junction, "POV …" = village). Map them to
  the parent municipality.
- **Next step**: `pipeline/scrape_agerba_ba.py`. Take companies → lines (65 GETs), then localities per
  line (1,018 POSTs) at ≤1 req/s. Emit consecutive-locality segments with the company legal name.

### 3.8 Other states (CE, PE, ES, GO, DF, MS, MT, RN, AL, PB, SE, PI, MA, PA, AM, TO, RO, AC, AP, RR)

Checked 2026-09-22. Two things apply across these states:

- **Election blackout (Lei 9.504/97, art. 73).** These sites are suspended until about
  2026-10-04, or 2026-10-25 if there is a runoff:
  - RN: DER-RN and ARSEP return 503 "Site temporariamente suspenso — Período Eleitoral 2026".
  - PB: DER-PB news pages.
  - MA: the root of mob.ma.gov.br.
  - PI: dados.pi.gov.br, agrespi.pi.gov.br and setrans.pi.gov.br.
  - RO: the publication pages on rondonia.ro.gov.br.

  **Re-check RN, PB, MA, PI and RO after 2026-10-25.**
- **Open data and GTFS are almost absent.**
  - Only GO (`dadosabertos.go.gov.br`) and AL (`dados.al.gov.br/catalogo`) have relevant CKAN datasets.
  - These portals do not resolve: dados.ce, dados.se, dados.pa, dados.am, dados.ap, dados.rr and dados.to.
  - These portals exist but have nothing on buses: dados.pe (45 packages), dados.pb, dados.rn, dados.ro, dados.ac, www.dados.ms and dadosabertos.mt.
  - dados.ma is DKAN with fiscal data only. dados.es has only CETURB Transcol (metro) datasets.
  - The only GTFS is CE's, and it covers metro areas only (§3.8.2).

### 3.8.1 ES — CETURB-ES (SITRIP) — best state source found

- Regulator: **CETURB-ES**. DER-ES handed over management of inter-city road passenger transport on 2018-03-15
  (LC 877/2017; <https://der.es.gov.br/transferencia-para-ceturb-es>). ARSP-ES has no bus role.
- **SITRIP** portal: <https://sitrip.ceturb.es.gov.br/>, launched in June 2025.
  - It is a Blazor WebAssembly app. The endpoints below were read from the client assembly
    `_framework/CetGeo2.Apresentacao.SITRIP.BlazorServer.Client.wasm`.
  - The JSON API needs no login and no captcha. `robots.txt` returns 404 and no ToS was found.
- Endpoints:
  - `GET /api/empresas`: 15 companies, `{"numCodigoEmpresa":38,"nmeEmpresa":"Cordial Transportes e Turismo"}`.
  - `GET /api/linhas`: 302 lines, e.g.
    `"nmeCadastroLinha":"ALEGRE / BOM JESUS DO NORTE - 1-004/044/0/180B - (CONVENCIONAL S/AR)"`.
  - `GET /api/seccoes`: **one request, 23 MB, 31,950 section-pair rows**.
    - Fields: `codigo_linha, codigo_linha_empresa, nome_linha, empresa, tipo_servico,
      origem_linha, destino_linha, origem_seccao, destino_seccao, ordem_seccao_tarifaria,
      ds_tp_seccao_tarifaria, tarifa, extensao_percorrida, dt_ultima_atulizacao_db`.
    - Sample: `João Neiva / Aracruz | Cordial Transportes e Turismo | Rodoviária de João Neiva → Agência de Ibiraçú | 5,50 | 12,70`.
    - `dt_ultima_atulizacao_db` = `22/09/2026 01:51:20`, so the data appears to be refreshed daily.
    - `codigo_empresa` is 0 in this endpoint, but the company name is filled in.
  - `GET /api/pontoseccao/{codigo_linhaempresa}`: the section stops of a line, in order, with `municipio`,
    `nome_ponto_seccao`, `logradouro`, **`latitude`/`longitude`** and km.
    Sample: `"Rodoviária de João Neiva","Rua São Carlos","-19,75709","-40,380349"`.
  - `GET /api/partidas/{codigo_linhaempresa}`: departures with `dia`, `horario`, `direcao_partida` and validity start date (`inicio`).
  - `GET /api/informacao/{id}`: line header. `GET /api/linhas/linhasqh/{codigo_empresa}`: the lines of one company.
  - Exports: `GET /api/impressao/exportarexcelps?codigo_linhaempresa=` (tested, returns XLSX),
    plus `GeneratePdfLinha`, `GeneratePdfQuadroTarifarioEmpresa?codigo_empresa=` and `exportarcsv`.
- Coverage: 302 lines and 247 distinct (origin, destination, company) combinations.
  - Service types: Convencional S/AR 161, C/AR 82, Executivo 33, Urbano 19, Semileito 7.
  - Largest operators: Águia Branca 97, Real Ita 54, Planeta 32, Pretti 31, Sudeste 18.
  - Section types: `Secção Tarifária Comum` 31,207, `Ramal Tradicional` 696, `Ramal Não Funcional` 47.
- The Transcol metro network (Grande Vitória) is separate; its CKAN datasets are about the metro only.
- **Next step**: `pipeline/scrape_sitrip_es.py`.
  1. Fetch `/api/seccoes` (1 request).
  2. Fetch `/api/pontoseccao/{id}` for each of the 302 lines at ≤1 req/s.
  3. Build segments from consecutive stops ordered by `ordem_seccao_tarifaria`. The coordinates also make the stops a geocoder.

### 3.8.2 CE — ARCE

- Regulator: **ARCE** (Lei 16.710/2018). DETRAN-CE only helps with enforcement.
  - The regular inter-city service runs in 8 concession lots: L1 São Benedito, L2/L5 Fretcar,
    L3 Princesa + Gontijo, L4/L6/L7 Guanabara, L8 Viametro.
  - There is also a metropolitan service, and a complementar service run by cooperatives (Coopstar, Cootace and others).
- **Operational XLSX**:
  `https://www.arce.ce.gov.br/wp-content/uploads/sites/53/2018/11/Servico-Regular-Interurbano-2021-2022.zip`
  (HTTP 200, 12.9 MB zip, 1 xlsx).
  - Listed on <https://www.arce.ce.gov.br/download/licitacoes-contratos-editais-formularios-e-gtfs/>, a page modified 2025-10-02.
  - There are also 2011–2015 and 2016–2020 zips, and `Servico-Regular-Metropolitano-2021-2022.zip` (1.1 MB, same structure).
  - Sheet `Linhas_Inter 2021-2022` (9,755 rows): `TRANSPORTADORA, CÓDIGO DA TRANSPORTADORA, ÁREA DE OPERAÇÃO, ANO, MÊS,
    CÓDIGO DA LINHA, DENOMINAÇÃO DA LINHA, TIPO DA LINHA, ESPÉCIE DO SERVIÇO`, plus trips, km and revenue.
  - Sheet `Pass_Inter` (165,233 rows) adds `ORIGEM DO SECCIONAMENTO, DESTINO DO SECCIONAMENTO, TARIFA DO SECCIONAMENTO`.
    Sample: `VIAÇÃO PRINCESA,24,3,2021,1,10301,'Fortaleza/Canindé',…,'CANINDE - CE','CAUCAIA - CE',16.55`.
  - Coverage: 6 companies, 181 lines, 11,936 distinct (company, line, seção) rows and 5,267 distinct seção city pairs.
  - Caveats:
    - Operators self-report under Res. 231/2017, and there are gaps: Oct–Dec 2022 has only São Benedito.
    - The 2023/2024/2025 file names return 404.
    - No license is stated.
- **Line lookup app** (not usable): <https://sistemas2.arce.ce.gov.br/central-servicos/#/transportes/linhas-regulares>.
  - It is a Vue app that sends GraphQL to `https://sistemas2.arce.ce.gov.br/sit/api/graphql`.
  - The query `linhas(inputLinha:{idOrigem,idDestino,recaptcha},…)` returns `transportadora, codigoLinha,
    itinerario, origem, destino, tarifa`, but it **requires a reCAPTCHA token**. Do not call it. Use LAI instead.
- **GTFS**: `https://www.arce.ce.gov.br/wp-content/uploads/sites/53/2018/11/GTFS_Arce_01082025.zip` (HTTP 200, 3.9 MB, Last-Modified 2025-08-26).
  - 119 routes, 3,313 stops, 6,420 trips, shapes, and zone-based fare rules.
  - It covers **only the Fortaleza metro area (routes 31xxx–44xxx) and Cariri (38xxx)**, not the inter-city system.
  - There is a single agency, `Arce`, so no operator names. Sample route: `1,Arce,31101,Fortaleza/Caucaia`.
  - The calendar ended 2025-12-31.
- Tariffs: ARCE resolutions (<https://www.arce.ce.gov.br/download/resolucoes-arce/>, e.g. Res. 10/2026) set only a coefficient per area,
  e.g. Área 05 = 0,220489 R$/pass·km. There is no per-line table.
- The concession contracts (e.g. `…/2018/11/SAO-BENEDITO-LOTE-1-editado.pdf`) are scanned, with no text layer.
- **Next step**: parse `Pass_Inter` into distinct (company, seção origin, seção destination) rows as a 2021–22 baseline.
  File a LAI request to ARCE for the current line/seção table.

### 3.8.3 PE — EPTI

- Regulator: **EPTI** (Lei 13.254/2007). ARPE approves tariffs; DER-PE has no transport role.
  The complementar service (Decreto 48.052/2019) and fretamento run through a login-only system (`complementar.epti.pe.gov.br`).
- **"Projeção das Linhas"**: one PDF per operational district, from
  `https://www.epti.pe.gov.br/assets/images/pages/2_Transportes/linhas-intermunicipais/01.pdf` to `08.pdf`.
  - All return HTTP 200 and are 146–318 KB. They were generated from Excel on 2026-03-16 and have a text layer.
  - They are linked from <https://www.epti.pe.gov.br/pages/2_Transportes/linhas-intermunicipais.html>.
  - Header: `ITEM DOD CIDADE LINHA EMPRESA DOM SEG TER QUA QUI SEX SAB SEM MENSAL` (trips per weekday).
  - Sample rows:
    - `24 14.017 Recife/Timbaúba EXPRESSO 1002 24 33 27 27 27 31 27 196 784`
    - `46 16.059 Recife/Petrolina (Via Salgueiro) PROGRESSO 2 2 2 2 2 2 2 15 60`
  - About 495 rows, roughly 200 unique line+company.
  - Caveat: the company name is sometimes glued to a wrapped line name ("LEITO PROGRESSO").
- **Tariff tables, one per operator** (HTTP 200, text layer):
  - `…/2_Transportes/5_Tarifas/1_1002/2023.pdf` (18 pp)
  - `…/3_Borborema/2023.pdf` (27 pp)
  - `…/7_Progresso/2023.pdf` (45 pp, 2024-08)
  - `…/8_Rodotur/2023.pdf` (1 p)
  - The "Coletivos" button links to `#`, so there is no file for it.
  - Columns: `N.º DA LINHA | PERCURSO | TIPO DE TARIFA | TIPO DE LINHA | EXTENSÃO | VALOR MÁXIMO | OSO/SEÇÃO`.
    Sample: `16.022 RECIFE/ARARIPINA K5 EXECUTIVO 672 241,72 OSO`, `RECIFE - CARPINA K8 URBANO 58 R$ 14,02 SEÇÃO`.
  - Section rows: about 985 (1002), 625 (Borborema) and 1,349 (Progresso).
- Service orders (OSOs) are on <https://www.epti.pe.gov.br/pages/2_Transportes/transporte-regular.html>.
  The 1002 2024 and Progresso 2026 files are scanned, so they need OCR. The Borborema and Rodotur files are **unverified**.
- Operators: <https://www.epti.pe.gov.br/pages/2_Transportes/permissionarias.html> (HTML) lists 4 permissionárias
  (Elson Souto & Cia/1002, Borborema, Auto Viação Progresso, Rodotur), with addresses and no CNPJ.
  The district PDFs also name Coletivo, Astrotur and Logo.
- ARPE (<https://www.arpe.pe.gov.br/tarifas2/transporte>) has tariff technical notes, the newest being NT 07/2023.
  They are probably coefficient-level only (**unverified**).
- **Next step**: parse the 8 district PDFs with `pdfplumber` to get line, company and OD. Add seções from the tariff PDFs.

### 3.8.4 GO — AGR

- Regulator: **AGR** (Agência Goiana de Regulação). Line types: Convencional, Semiurbana, Expresso, Complementar, Complementar Semidireto.
- **CKAN dataset** `empresas-autorizadas-termos-de-autorizacao-e-precos-de-passagens` (CC-BY):
  - CSV: `https://dadosabertos.go.gov.br/dataset/53b39c1f-fef2-4869-ab00-657289c13721/resource/135152a1-00c8-410e-b068-c5d338d77925/download/empresas-autorizadas-termos-de-autorizacao-e-precos-de-passagens-.csv`
    (`;`-separated, cp1252).
  - Datastore API: `https://dadosabertos.go.gov.br/api/3/action/datastore_search?resource_id=135152a1-00c8-410e-b068-c5d338d77925` (total=285).
  - Columns: `NOME DA EMPRESA; NÚMERO DA LINHA; ITINERÁRIO; ARQUIVO`.
    Sample: `Auto Viação Goianésia Ltda.;01.044-00;Goiânia a Adelândia`.
  - 285 lines from 32 companies. The largest are Juarez Mendes de Melo 45, Viação Estrela 35 and Goianésia 27.
  - Resource dated 2025-07-16. Despite the dataset name, it has **no CNPJ and no prices**.
- **Timetable XLSX**:
  `https://dadosabertos.go.gov.br/dataset/141dea7f-0531-435d-9a47-b85e7edee9e1/resource/9599affc-3769-4fd9-ba57-606d04485901/download/quadro-de-horarios-do-transporte-rodoviario-intermunicipal.xlsx`.
  - 219 rows from 33 companies (`NOME DA EMPRESA, TIPO DA LINHA, NÚMERO, ITINERÁRIO, ARQUIVO`), dated 2025-06.
  - Line types: Convencional 173, Semiurbana 38, Expresso 3, Complementar Semidireto 3, Complementar 1.
  - `ARQUIVO` holds 218 hyperlinks to per-line PDFs (`goias.gov.br/agr/wp-content/uploads/...`).
- **Per-line PDFs** (text layer). Each has company, fleet, line number and OD, km, road route,
  **"SEÇÕES DA LINHA"** (stop cities in order), meal stops, departure times from each end, and the Termo de Autorização.
  Example (03/09/2026): Real Expresso `06.282-00 Goiânia a Caldas Novas`, 164 km,
  via GO-020/GO-147/GO-217/GO-139, seções "Goiânia, Bela Vista de Goiás, Piracanjuba e Caldas Novas".
- A fresher index is at <https://goias.gov.br/agr/quadro-de-horarios/>.
  - It links 37 per-company pages holding about 180 PDFs dated 2014 to 2026-09. Only 95 of them overlap the XLSX links.
  - Coverage is partial per company; e.g. Juarez Mendes de Melo has 3 PDFs for 45 lines.
- Tariffs: the `reajuste-de-tarifas…` CSV (103 rows) and the resolutions give per-km coefficients only.
  There is also a `terminais-rodoviarios-de-passageiros` CSV (194 rows).
- The operator portal (`www.portal.agr.go.gov.br`) requires a login. CMTC/RMTC is the metro network (out of scope).
- **Next step**: `pipeline/fetch_agr_go.py`. Get the CSV from the datastore API (1 request), then the per-line PDFs
  (about 220 + 180 GETs at ≤1 req/s). Parse "SEÇÕES DA LINHA" to get the ordered stop cities.

### 3.8.5 MT — AGER-MT / SINFRA-MT

- AGER-MT regulates; SINFRA-MT grants the concessions.
  - The system is STCRIP/MT: 8 markets (MIT 01–08), each with a Básica lot and a Diferenciada lot.
  - Concessions run 20 years; emergency permissions run 180 days.
- **AGER line lookup app**: `http://191.223.235.122:5081/linha`, linked from the AGER home page.
  It is plain Node/Express over HTTP on a bare IP (HTTP 200).
  - Search: `POST /linha` with form fields `empresa=<origin prefix>&placa=<destination>`.
    The field names are mislabelled. `placa` may be empty, but omitting it returns a 500 error.
    Each result row has Origem, Destino, Empresa and a `codg_lin_emp` id.
  - `GET /horario?codg_lin_emp=N` returns departures per weekday, both directions.
  - `GET /valor?codg_lin_emp=N` returns every section pair with km, coefficient and fare.
    Example for id 987, Sinop–Nova Mutum: `SINOP→SORRISO 86.40 km R$0.244917 R$21.16`, `SORRISO→LUCAS DO RIO VERDE 64.00`, …
  - 28 requests (prefixes A–Z, Á, É) returned about 130 lines (ids 539–1044).
    - Operators: Viação Juína 18, CMT 14, Logtrans 14, Novo Caminho SPE 14, SPE Tarumã 13, Expresso Itamarati 11,
      Itanorte 10, AM Transportes 10, Viação Novo Horizonte 5, Satélite Norte/Azul, Gênesis Bus.
    - A few records are not bus operators (AGER, highway concessionaires, Energisa); filter them out.
  - No ToS found.
- **Contracts table**: <https://www.sinfra.mt.gov.br/contratos-e-permissoes> (HTML; needs a browser user-agent and resets connections intermittently).
  - It gives company, contract, status and expiry per MIT and category. Examples:
    - MIT01 Básica: CMT, to 2038-04-12
    - MIT04 Básica: SPE Tarumã
    - MIT08 Básica: Novo Caminho / Rio Novo
    - MIT08 Diferenciada: Satélite Azul
  - The contract PDFs do not list lines. `Delimitação de mercados STCRIP.pdf` maps municipalities to MITs.
- **Tender annex**: `https://www.sinfra.mt.gov.br/documents/d/sinfra/projbasico-2025-1-pdf` (22 MB, 111 pp, text, 2025-05-30),
  from Concorrência 043/2025.
  - Anexo C lists about 162 current lines with code, OD, operator and type, e.g. `001-1-1-00 CUIABÁ x RONDONÓPOLIS ANDORINHA CONCESSIONÁRIO CONVENCIONAL`.
    The operators are pre-concession (from the 2012 plan), so this is a **historical baseline**.
  - Table 4.14 lists seções for the Diferenciada links.
- **Next step**: `pipeline/scrape_ager_mt.py`. Run the ~28 prefix searches, then `/valor` and `/horario` per id (~260 GETs) at ≤1 req/s.

### 3.8.6 MS — AGEMS

- Regulator: **AGEMS** (formerly Agepan). The system is "Sistema TRIP", with lines on temporary ("precarious")
  authorizations until a chamamento público under Lei 5.976/2022, which has not been published yet.
- **Authorized lines**: <https://www.agems.ms.gov.br/wp-content/uploads/2025/01/Autorizacoes-Sistema-TRIP-revisadas.pdf>
  (HTTP 200, 7 pp, text).
  - It is an extract of the state gazette: ATA 001/2025 of 2025-01-16, which renews **133 lines valid until 2026-11-18**.
    Another 34 lines were deferred, and no publication for them was found (**unverified**).
  - Record format: `EMPRESA: Aloc Transportes Ltda. LINHA N° 210 – Cassilândia / Três Lagoas (via Inocência). VALIDADE: …`.
    Cooperative records name the operator: `COOPERATIVA: Coopervans do Pantanal. OPERADOR: … LINHA N° 400 – Rio Negro / Campo Grande`.
  - A regex parse got 128 records from about 22 operators: Coopervans 41, Cruzeiro do Sul 23, Motta 8, Andorinha 7, Expresso Mato Grosso 7, Umuarama 7.
  - No seções, timetables or CNPJ.
- Older lists:
  - `…/2021/04/Autorizacoes-Sistema-TRIP-2021-2.pdf` (205 lines, ATA 016/2021)
  - `…/2025/01/Autorizacoes-transporte-passageiros-25-26.pdf` (the original gazette issue of 2025-01-17)
  - To find more uploads, use `https://www.agems.ms.gov.br/wp-json/wp/v2/media?search=…`.
- Timetables and fares are only in the MS TRIP / MS Digital apps (**unverified** whether an API exists).
  `sistemas.agems.ms.gov.br/gisitweb`, `www.sgltar.ms.gov.br/externo` and `monitora.ms.gov.br` require a login.
- Tariffs: Portaria 334/2026 raises the coefficients by 15.34%. There are no per-line tables.
- **Next step**: regex-parse the 2025 PDF. Use the 2021 PDF for lines not in the 2025 list.

### 3.8.7 PA — ARTRAN-PA (formerly ARCON-PA)

- Regulator: **ARTRAN-PA** (Lei 10.308/2023). It took over road and river inter-city transport from ARCON-PA in 2024.
  CONERC approves tariffs; SETRAN-PA is not the regulator.
- **ARCON tariff table**: <https://www.arcon.pa.gov.br/sites/default/files/tabela_de_tarifas_reaj_4_60.pdf>
  (HTTP 200, 22 pp, 1.19 MB, generated from Excel).
  - Tariffs are from Res. CONERC 009/2019 (2019-11-26); the PDF was modified 2021-12-23.
  - Columns: `Transportador | Tipo (VD/SEC/VP) | Código | Localidade Origem | Via | Localidade Destino | Classe | R$`.
    VD = direct trip (the line), SEC = seção, VP = partial trip.
  - About 2,700 rows: 205 VD, about 2,477 SEC and 19 VP, from about 55 companies.
    Largest: Boa Esperança 1,131 rows, Ouro e Prata 417, Jarumã 153, Arapari 142, Expresso Modelo 101.
  - Sample rows:
    - `COMÉRCIO E TRANSPORTE BOA ESPERANÇA LTDA VD 10602 BELÉM BR-010 PARAUAPEBAS (SERRA DOS CARAJÁS) F 213,53`
    - `RÁPIDO AÇAILÂNDIA LTDA VD 019033 BELÉM VIA ALÇA VIÁRIA CANAÃ DOS CARAJÁS B 166,58`
  - `Via` is often empty and not delimited, so extract by text position (pdfplumber).
- Alternates:
  - <https://arcon.pa.gov.br/sites/default/files/tabela_de_tarifa_rodoviaria_2019.pdf>: same content, generated from Word.
    It is the annex to Res. ARCON 015/2018, 34 pp, and is easier to split.
  - `https://arcon.pa.gov.br/sites/default/files/Tarifas%20rodoviarias/TabelaTarifa.pdf` (2022-05-24).
    It is grouped by Empresa → LINHA → SEC, but partial: 35 companies, 58 lines, 545 SEC rows.
  - The listing page `arcon.pa.gov.br/tarifas-rodoviarias` now returns "Acesso negado". A Wayback snapshot from 2024-07 lists these files.
- No ARTRAN tariff table, operator list, dataset, GTFS or lookup app was found.
  The only operator list with CNPJ is for river operators (`…/default_images/empresas_gth.pdf`, 2018).
- **Next step**: parse the 2019 table with pdfplumber. Keep VD rows as lines and SEC rows as seções.
  File a LAI request to ARTRAN for the current table.

### 3.8.8 MA — MOB

- Regulator: **MOB** (Agência Estadual de Mobilidade Urbana e Serviços Públicos; Lei 10.538/2016, Res. MOB 001/2017).
  Operators hold temporary authorizations; AGEM (the metro agency) has no role.
  - `https://mob.ma.gov.br/` shows an election-suspension page.
  - `https://www.mob.ma.gov.br/` is still served (CC BY 4.0 footer), but its rodoviário page lists only legislation.
- **Partial line list**: the annex to Portaria MOB 290/2022, "LINHAS QUE OPERAM NO ESTADO DO MARANHÃO", on LegisWeb
  (<https://www.legisweb.com.br/legislacao/?id=435716>, HTTP 200, HTML table).
  - Columns: `EMPRESAS | ORIGEM | DESTINO | HORÁRIO | STATUS`. 138 rows.
  - **All rows are `N/OPER`**: lines that were not operating and were reopened for authorization. Useful for company names only.
  - Sample: `EXPRESSO GUANABARA|TIMON|SÃO LUÍS|10:00|N/OPER`.
- Tariffs: Portaria 34/2025 annex (state gazette of 2025-02-24, pp. 23–28).
  - A copy is at `https://drive.google.com/uc?export=download&id=1ifvRlfJXwGX6NAHV8ApbpmH-Eyd9Vr6Z`, linked from a blog.
  - Rows run from São Luís to each municipality, with km and fare by class, and **no company**.
  - This portaria was revoked on 2025-02-26. Its replacement, Portaria 112/2025, is **unverified**.
- The "anexo I" of Portaria 532/2022 is not in LegisWeb (**unverified**). There is no operator list, dataset or GTFS.
- **Next step**: file a LAI request to MOB, which receives monthly OD reports from operators. Re-check the site after the election.

### 3.8.9 AL — ARSAL

- Regulator: **ARSAL**, covering the convencional (SECONV), complementar and fretamento services. DER-AL has no role in lines.
- CKAN base URL: `https://dados.al.gov.br/catalogo/api/3/action/…` (plain `/api/3` returns 404). License "Creative Commons Atribuição".
- **Convencional timetables**: CKAN id `quadro-de-horarios-transporte-convencional`.
  - File: `https://www.arsal.al.gov.br/documentos?task=download.send&id=881&catid=61&m=0` (HTTP 200, 3.7 MB, 47 pp, text, issued 2025-12-01).
  - One service-order block per line: Empresa, Linha, Código, Área, Serviço, km, trips per week,
    departures from each end per weekday, full road itinerary and **seccionamentos** (city list), plus tariff.
  - Sample: `REAL ALAGOAS DE VIAÇÃO LTDA | DELMIRO GOUVEIA - MACEIÓ (VIA PALMEIRA DOS ÍNDIOS) | 01-09 | SERTÃO | 294 km`.
  - 26 lines from 7 companies: Real Alagoas, Veleiro, Expresso Santo Antônio, Girauense, Coitenense, L Pereira Lira, Cristiano Mateus Santos-ME.
- **Complementar timetables**: CKAN id `quadro-de-horarios-transporte-complementar` (`…id=882&catid=64`, 310 pp).
  - 182 lines with code, area, km, times and tariff.
  - The company field is always "ORDEM DE SERVIÇO COMPLETA", so there are **no operator names**.
- Tariffs:
  - Convencional: Res. 229/2025, in force from 2025-12-08. File: `…/convencional/tarifas-convencional?task=download.send&id=1324&catid=62&m=0`.
  - Complementar: Res. 228/2025. File: `…/complementar/tarifas-complementar?task=download.send&id=1326&catid=65&m=0`.
  - Both have one row per line.

### 3.8.10 PB — DER-PB

- Regulator: **DER-PB** (Conselho Executivo). Fretamento goes through a login system.
- Resolução CE 25/2025, in force from 2026-01-01. Text verified on LegisWeb
  (<https://www.legisweb.com.br/legislacao/?id=489078>); the official source is the state gazette.
  It lists **21 main lines with company and fare**: `João Pessoa - Patos (executivo) | Guanabara | 107,60`.
- A Wayback snapshot of the 2020 DER-PB page "Tabela de linhas e horários"
  (`http://web.archive.org/web/20220807105538/https://der.pb.gov.br/noticias/tabela-de-linhas-e-horarios-dos-onibus-intermunicipais/`)
  has about 44 timetable rows grouped by company: Guanabara, Real, Rio Tinto, Pontual, Santa Cruz, São José, Novo Horizonte.
  The live page is suspended for the election.
- No operator list, dataset or GTFS.

### 3.8.11 SE — DER-SE

- Regulator: **DER-SE**, with tariffs set by the Conselho Estadual de Transportes (CET). AGRESE does not cover buses.
- Resolução CET 1/2025 (LegisWeb <https://www.legisweb.com.br/legislacao/?id=476984>).
  - Annex I has 62 OD lines, e.g. `Estância / Tobias Barreto R$ 17,53 → R$ 20,40`.
  - Annex II has 89 lines, mostly destination-only from Aracaju.
  - Operators are listed **for the whole table, not per line**: COOPERTALSE, COOPETAJU, VIANORTE, COAGRESTE,
    TRANSERTÃO, COOPERSERTÃO, COOPERVAN, COOPASE.
- `https://der.se.gov.br/wp-content/uploads/2023/02/Distancia-intermunicipais.pdf` lists distances only (**unverified**).
  The operator system (`getransp.der.se.gov.br`) requires a login.

### 3.8.12 RN — DER-RN

- Regulator: **DER-RN** (Diretoria de Transporte). ARSEP does not regulate buses.
  Both sites return 503 during the election blackout.
- Tariffs come from DER portarias in the state gazette (`deirn.sdoe.com.br`), e.g. Portaria 0015/2026-DG of 2026-04-14.
  Content **unverified**.
- No line registry, dataset or GTFS.

### 3.8.13 PI — SETRANS / AGRESPI

- **SETRANS** grants the lines; **AGRESPI** regulates and inspects (Lei 8.562/2025, STRIP/PI).
- `https://portal.pi.gov.br/setrans/linhas-de-onibus/` and `https://portal.pi.gov.br/agrespi/transporte-intermunicipal-de-passageiros/`
  return 200 but are empty.
- AGRESPI's 2026 inspection plan (PAF-STRIP.pdf) schedules the mapping of lines and operators for Feb–Jun 2026. Nothing is published yet.
- Fallback: search the state gazette (`https://www.diario.pi.gov.br/doe/`) for line-authorization acts.

### 3.8.14 TO — ATR

- Regulator: **ATR**. Authorization regime with free fares since Res. ATR 3/2025. AGETO has no role in bus lines.
- Only old PDFs:
  - Res. 023/2009 Anexo I (`https://central3.to.gov.br/arquivo/220711/`): company, OD and contract,
    e.g. `TOCANTINENSE TRANSPORTES E TURISMO LTDA | PALMAS – CASEARA | 001/2000`.
  - State gazette of 2017-01-04 (`https://central.to.gov.br/download/9786`): results of the 2016 permission round,
    with line, bidders and winner.
- The ATR "Itinerário", "Extratos dos Termos de Compromisso" and "Permissões" pages are empty. No dataset or GTFS.

### 3.8.15 AC — AGEAC

- Regulator: **AGEAC** (DITRANS division, Lei 2.731/2013).
- Res. 35/2015 Anexo I (<https://www.legisweb.com.br/legislacao/?id=302892>, HTTP 200, HTML) lists **34 lines with company and tariff**.
  - Columns: `Nº | CATEGORIA | NOME | EMPRESA | TARIFA`.
  - 5 operators: PETROACRE, TRANSACREANA, COTA, C & S, TRANSP. TUBARÃO.
  - Sample: `0016|RADIAL|RIO BRANCO - CRUZEIRO DO SUL - RIO BRANCO|PETROACRE|120,00`.
  - Dated 2015.
- Res. 122/2026 (+15%) is known only from news. dados.ac.gov.br has nothing relevant.

### 3.8.16 AP — SETRAP

- Regulator: **SETRAP** (Lei 2.470/2019).
- <https://setrap.portal.ap.gov.br/conteudo/informacoes-ao-cidadao/viagens-intermunicipais-e-precos> (HTTP 200) is an HTML table
  (`LOCALIDADES | HORÁRIO | KM | TARIFA`) with about 22 OD pairs, **no company**, undated.
  Sample: `Macapá/Laranjal do Jari | 08:00 | 08:00 | 273 | 65,00`.

### 3.8.17 AM — ARSEPAM

- Regulator: **ARSEPAM** (about 9 companies in 2020).
- Its river-transport price page is marked "em andamento" (in progress) and has no data.
  The annual reports name no companies. Nothing published for buses.

### 3.8.18 RO — AGERO

- Regulator: **AGERO**. Tariffs are per-km coefficients (Res. 42/2019).
- A concession public consultation ran in 2025 (`rondonia.ro.gov.br/publicacao/consulta-publica-n-o-001-2025/`),
  but no documents are published (**unverified**). Nothing else published.

### 3.8.19 RR — CRE/RR

- Regulator: **CRE/RR** (Conselho Rodoviário Estadual; Decreto 27.449-E/2019). 27 regular lines and 12 cooperatives.
- No list published; dados.rr.gov.br does not resolve.

### 3.8.20 DF — SEMOB-DF

- There is no intra-state inter-city service; the Entorno routes are ANTT's (§2).
- `dados.df.gov.br/api/3` returns 404. Whether a GTFS exists for the DF urban network is **unverified**.

**Next step for the weak states**: LAI requests to MOB-MA, AGRESPI-PI, DER-RN, AGERO-RO, ARSEPAM-AM and CRE-RR.
Re-check the blacked-out sites after 2026-10-25.

---

## 4. GTFS feeds

Catalogs checked on 2026-09-22:
- **Mobility Database**: <https://files.mobilitydatabase.org/feeds_v2.csv> (2.6 MB, 6,475 feeds;
  `https://bit.ly/catalogs-csv` 301s to a GCS copy). It lists 17 BR entries (16 GTFS + 1 GTFS-RT).
  **None of them is a long-distance network.**
- **Transitland**: the REST API needs an API key, so the public Atlas repo was used instead
  (<https://github.com/transitland/transitland-atlas>, `feeds/*.dmfr.json`). It has 7 BR files:
  artesp, granderecife, pbh, rio, datapoa, sptrans, plus flix.tech (US/EU only).
- Neither catalog lists FlixBus Brazil (below).

| Feed | URL (HTTP on 2026-09-22) | agency.txt | Routes | Intercity? |
|---|---|---|---|---|
| **FlixBus Brazil** | <https://gtfs.gis.flix.tech/gtfs_generic_brazil.zip> (200, 99.8 KB, Last-Modified 2026-09-20; the `http://` URL 301s to https) | 1 agency: `FLIXBUS-br`, "FlixBus-br" | 15 routes, 53 stops, 175 trips, `shapes.txt` (9,191 pts); feed_info 2026-09-20 → 2027-03-20 | **Yes, interstate**: `BRN0714 Guarulhos (SP) - Uberlândia (MG)`, `BRN0262 Penha (SC) - Porto Alegre (RS)`, Salvador, Vitória, Florianópolis… The operator is the FlixBus brand, not the partner carrier. |
| ARTESP metropolitan (ex-EMTU) | see §3.1(b) (200, 46.8 MB, 2026-09-08) | "ARTESP" only | 823 | Metropolitan intermunicipal (5 SP RMs). Get the operator from the XLSX join. |
| Grande Recife (PE) | <https://www.granderecife.pe.gov.br/gtfs/gtfs.zip> (200, 37.7 MB, Last-Modified 2026-09-22; in Transitland, not in MDB) | **10 operators** (Borborema, Caxangá, Conorte, CSR, Coopernorte, Metropolitana, Globo, Mobibrasil, São Judas Tadeu, Mirim) | 388, with shapes | Metropolitan (RMR, includes intermunicipal lines). Operator per route. |
| ARCE (CE), MDB `mdb-2935` | The direct URL returns 403; the mirror <https://files.mobilitydatabase.org/mdb-2935/latest.zip> is 200 (3.9 MB) | "Agência Reguladora do Estado do Ceará" only | 119 | RM Fortaleza + Cariri (`31405 Fortaleza/Trairi`, `38803 Juazeiro do Norte/Barbalha`). See §3.8 (row 24). |
| RMBH metropolitan lines (**not GTFS**) | IDE-Sisema record <https://idesisema.meioambiente.mg.gov.br/geonetwork/srv/api/records/9749d033-d545-4497-867d-78ee102a3d13>; WFS `IDE:ide_0406_mg_linhas_onibus_rmbh_lin` on `https://geoserver.meioambiente.mg.gov.br/IDE/ows` (SHAPE-ZIP / excel2007 / JSON) | — | **1,054 features** (`numberMatched`) | Metropolitan BH. Fields: `nome_linha, cod_linha, cod_delega, operadora` (e.g. `CONSORCIO METROPOLITANO DE TRANSPORTE`), `numero_rit, indicacao, sistema=METROPOLITANO` + line geometry. Source: RMBH mobility plan (ARMBH/Seinfra). Vintage and license not checked. |

**Municipal only (no intercity)**:
- SPTrans `mdb-8` (1 agency, 1,362 routes, 14.3 MB, updated 2026-09-22).
- BHTRANS `mdb-9`/`mdb-687`; Transitland mirror `https://s3.amazonaws.com/mobilibus-uploads/gtfs/GTFSBHTRANS.zip` (52 MB, 2026-09-22).
- Rio SMTR `mdb-1791` (25.5 MB, 2026-08-08; agencies are the consortia Internorte, Santa Cruz, Transcarioca, Intersul and MOBI-Rio; 498 routes).
- URBS Curitiba `mdb-3225`: a community build from GitHub, 309 routes, **no RMC/AMEP lines**.
- EPTC Porto Alegre `mdb-7` (inactive), Riopretrans `mdb-3505` (auth), Bagé `mdb-930`, Viação Senhor do Bonfim/Angra dos Reis `mdb-2632` (47 municipal routes).
- Fortaleza ETUFOR/METROFOR (deprecated).
- Transitland's Rio "fetranspor" URL (`dadosabertos2.rio.rj.gov.br/dadoaberto/google-transit/google_transit.zip`)
  returns a 2-byte file, so it is dead.

**No GTFS found** (**unverified** negatives):
- Metroplan-RS: only the HTML page <http://www.metroplan.rs.gov.br/linhasitinerarios>.
- AMEP/RMC (Curitiba): PDF maps only (<https://www.amep.pr.gov.br/Pagina/Mapas>).
- RMTC Goiânia: dadosabertos.go.gov.br has 0 GTFS datasets.
- DF SEMOB: the CKAN API is 404; only the dfnoponto app.
- Florianópolis.
- RJ intermunicipal (DETRO/Semove): use §3.3 instead.

FlixBus's other public files (`gtfs_generic_{eu,us,gb,turkey,india,chile}.zip`) exist. The bucket listing
and guessed names (`_br`, `_brasil`, `_latam`, `_mexico`) return 403.

The zips carry no license file, so the FlixBus BR license is **not stated**. FlixBus's EU feed is ODbL via data.gouv.fr only.

**Next step**:
- `pipeline/scrape_flixbus.py`: download the BR zip and emit one segment per consecutive stop pair in
  `stop_times` (with shapes), with company = FlixBus. It is tiny.
- Metropolitan layers (optional, flag `service_class=metropolitano`): ARTESP + XLSX, Grande Recife, RMBH WFS.

---

## 5. Ticket marketplaces and operators

All robots.txt and sitemaps below were fetched on 2026-09-22. Route counts marked "≈" are
extrapolated from a random sample of 40 child sitemaps.

**Caveat for every marketplace**: a route page shows only the companies **selling trips on the
scraped date**. A route with no departure that day shows no company. Scrape each page on 2–3
different dates, or use a weekday.

### 5.1 deonibus.com (current seed) — its route pages beat its company pages

- robots: `Disallow: /cliente/*, /ajuda, /stops, /escolher-assentos/*, /resumo-pedido/*, /identificacao/*, /pagamento/*, /pedido/*, /corporate/*, /*?departureDate=, */en/, */es/, /deonibus/*`;
  `Sitemap: https://deonibus.com/sitemap.xml`.
- The sitemap index has 3,620 children:
  - `companies-sitemap.xml`: 1,103 URLs = **368 companies** × {`/viacao/{slug}`, `/horario`, `/onibus`}. This matches the seed count.
  - `stations-sitemap.xml` (4,297), `destinations-sitemap.xml` (5,645), `routes-connection-sitemap.xml` (446).
  - 3,614 per-origin `routes-sitemap-{city}-{uf}[-todos].xml`, **≈157k route URLs** in total (SP-todos alone has 1,630; BH-todos 755).
- Route pages `/passagens-de-onibus/{o}-para-{d}` are server-rendered with `window.__PRELOADED_STATE__`.
  `aditionalValueFromBackend.search.result.routes.departureRoutes[].tripList[]` gives, **per leg**:
  - origin/destination city + UF + stop id, departure/arrival datetimes, class and price;
  - `company:{name:"EMPRESA PLANALTO",friendlyName,slug:"planalto",id:119}`.
  - Connections are included (`totalConnectionCount`). Keep only legs, and dedupe on (company, leg O, leg D).
- These white-labels share the same backend, so they are **not** independent sources:
  - `aguiabranca.deonibus.com` (`brasilbybus.com.br` 301s here; its TLS cert has expired);
  - `belohorizonte.rodoviariadebh.com.br`, `rodoviariaportoalegre.com.br`, `rodoviariacuritiba.com.br`, `rodoviariadoriodejaneiro.com/deonibus`.
- `/termos-de-uso`: no scraping clause found (a JS page, so the check may be incomplete).
- **Next step**: extend `pipeline/scrape_deonibus.py` to walk the route sitemaps.
  - Fetch `/passagens-de-onibus/{o}-para-{d}` **without** `?departureDate=` (disallowed).
  - Parse the preloaded state and keep `(company.slug, leg origin, leg destination)`.
  - Start with the `-todos` (city-level) sitemaps and throttle to ≤1 req/s.

### 5.2 Quero Passagem (queropassagem.com.br) — best JSON-LD

- robots:
  - `User-agent: *` disallows only `/cdn-cgi/, /afiliados, /admin/, /imprensa/`, ~113 specific old `/passagens-de-onibus-de-…/` URLs and `/aerea/*-para-*`.
  - Many bot UAs are blocked by name (wget, HTTrack, libwww, AhrefsBot, MJ12bot…). Send a descriptive UA.
  - `Sitemap: https://queropassagem.com.br/sitemap.xml`.
- The index has 9,147 children:
  - `sitemap-viacoes.xml` (**402 companies**, `/auto-viacao-1001`), `sitemap-rodoviarias.xml` (3,891), `sitemap-cidades-para.xml` (6,068);
  - 9,142 per-stop `sitemap-onibus-{stop}.xml`, **≈548k stop-level route URLs** `/onibus/{o}-para-{d}`. Tietê alone has 1,112.
- Route page JSON-LD (verified on `/onibus/abaete-mg-para-belo-horizonte-central-mg`):
  - `Product.offers[].seller` = company;
  - `BusTrip[]` with `provider:{name:"Sertaneja",url:"…/auto-viacao-sertaneja"}`, `departureBusStop`, `arrivalBusStop`, `departureTime`;
  - FAQ "Quais empresas de ônibus fazem a rota…".
- Company page: "Top rotas" + "Rotas … por estado" (58 route links for 1001) + BusTrip JSON-LD.
- ToS `/termo-de-uso`: no scraping clause found.
- **Rodon (ex-Rodoviária Online)** runs on the same backend:
  - `www.rodoviariaonline.com.br` 301s to <https://rodon.com.br>. Its footer says "Grupo QP" and "Rodoviariaonline Turismo e Serviços Online LTDA, CNPJ 13.968.124/0001-07".
  - robots `Disallow:` (empty). `/sitemap.xml` (not declared) has 9,182 children: `sitemap-viacoes.xml` (466 companies) and per-origin `trechos/{city}.xml` (direct) vs `trechos/{city}-conexao.xml` (connections).
  - Some sitemap URLs 404 (stale).
  - Route pages embed a `travels-placeholder` JSON (`company:{id:"3",name:"Andorinha"}`, `from:{id:"ROD_930"}`) and call `/api/b2c/search?from=…&to=…&travelDate=…`.
- **Next step**: `pipeline/scrape_queropassagem.py`.
  - Collapse the stop-level sitemap URLs to city pairs (strip the `-rodoviaria`, `-tiete`… stop suffixes). Fetch one page per city pair at ≤1 req/s.
  - Keep `BusTrip.provider.name` + URL slug as the company key, and crosswalk slug → deonibus slug / ANTT CNPJ.
  - Use it as a gap-filler for states whose regulator is gated (PR, SC, MG) or silent (RN, PI, TO, AM, RO).

### 5.3 ClickBus (clickbus.com.br)

- robots:
  - `Allow: /`. It disallows `/checkout/`, `/cliente/`, `/admin/` and query params (`?departureDate=`, `?page=`, `?sort=`, utm…).
  - It explicitly allows GPTBot, ClaudeBot, CCBot, PerplexityBot etc.
  - `Sitemap: https://www.clickbus.com.br/sitemap/indice.xml`.
- Children:
  - `institucional.xml` (2,437 URLs: 2,026 `/onibus/{city}`, **231 `/viacao/{slug}`**, 63 `/rodoviaria/…`);
  - `passagem-1.xml` (2,453);
  - `routes-1..27.xml`: **261,742 `/onibus/{o}/{d}` city pairs** (counted exactly);
  - `routes-company-a.xml`: 220 `/onibus/{o}/{d}/{company}`.
- Route page (Next.js SSR): "Você pode ir de X para Y com:" followed by company logos, e.g. `<img alt="1001" src="…/travel-company-logos/1001.svg">`.
  - Its JSON-LD is Product/AggregateOffer only (no provider).
  - Trips load client-side from `https://bff.clickbus.com/web/api`.
- `/viacao/{slug}` shows only ~16 top routes with prices.
- **ToS** (<https://www.clickbus.com.br/institucional/termos-de-uso>) forbids "o uso de qualquer software ou
  sistema automatizado para extrair dados deste Website (ou API's integradas) para a exibição /
  comercialização … sem o consentimento expresso". **Do not crawl.** Use only for manual spot checks.

### 5.4 Buson (ex-Guichê Virtual; Busbud white-label)

- `www.guichevirtual.com.br` 301s to <https://www.buson.com.br> ("Guichê Virtual agora é Buson"). Buson merged with Busbud in Mar/2024.
- robots:
  - Blocks named bots (Bytespider, Amazonbot, AhrefsBot, dotbot…).
  - `Crawl-delay: 1` for ClaudeBot/GPTBot/CCBot; `*` disallows only `/admin`.
  - 8 sitemap indexes.
- Sitemaps:
  - `buson-sitemaps/profile/buson_sitemap_pt_operators_0.xml`: **328 operators** (`/viacao/{slug}`).
  - `route/buson_sitemap_pt_routes_{0,1,2}.xml`: 118,318 URLs = **102,269 BR `/passagem-de-onibus/{o}/{d}`** + 16,049 international `/r/…`.
  - `city/…`: 5,270 cities.
- Route page: an HTML table "Operado por" + JSON-LD `BusTrip[]` with `provider:{name:"Aguia Branca"}`, stops and times.
  - Operator pages list only ~19 routes.
- ToS URL not found (404; **unverified**).
- Medium: a second source that is independent of QP and deonibus.

### 5.5 Buser — `llms.txt` and Markdown route files

- robots:
  - `Allow: /` with `Content-Signal: search=yes,ai-input=yes,ai-train=no`.
  - It disallows `/api/, /reserva, /grupos, /perfil…` and **explicitly allows `/ai/`, `/llms.txt`, `/llms-full.txt`**.
- <https://www.buser.com.br/llms-full.txt> lists every origin. Each route is served as Markdown:
  - URL pattern: `https://www.buser.com.br/ai/onibus/{o}/{d}.md`.
  - `sitemap/ai_trechos.xml` and `sitemap/rotas.xml` each have **4,381 pairs**.
  - Each file lists the next-7-day departures, e.g. `### 22:40 - ES Turismo`, price, seat type and boarding address.
- `sitemap/empresas.xml` has **626 partner subdomains**. Example: <https://3-estrelas.buser.com.br> shows
  `CNPJ: 07.241.838/0001-16` and "Todas as rotas".
- Companies here are **charter partners** ("fretamento colaborativo"), not regular-line holders. Keep them as a
  separate `service_class=fretamento` layer, if at all.
- `/termos-de-uso` is 404 (**unverified**).

### 5.6 BuscaOnibus (buscaonibus.com.br) — metasearch

- robots:
  - `Crawl-Delay: 10`.
  - It disallows `/comprar-passagem` and `?dt=/?o=/?d=` query params.
  - The sitemap index has 8,773 children (pt/en/es).
- Sitemaps and pages:
  - `sitemap-pt-bus-companies.xml`: **301 companies**. There are 1,459 `sitemap-pt-timetable-{origin}.xml` files (`/horario/{o}/{d}`).
  - Timetable pages list each trip with the operator and the reseller (e.g. "São Cristóvão Gontijo") + JSON-LD BusTrip. BlaBlaCar is included.
  - Company pages embed a JS `_routeList` of all the company's pairs ("Mapa de Trechos"; Águia Branca has 40).
- **Useful gazetteer**: <https://www.buscaonibus.com.br/dynamic/js/locations.js> (663 KB, 3,878 cities/terminals with
  `lat`/`lng` and terminal slugs).
- ToS: no scraping clause found. Low: the crawl delay makes a full crawl ~4 h per 1.5k pages.

### 5.7 Others

- **FlixBus Brasil**:
  - robots on `www.flixbus.com.br` and `global.flixbus.com` disallows only `/track/*`, `/flux/` and amp URLs.
  - `sitemap/sitemap-v2.xml/network/0` has 6,645 city pages worldwide.
  - Use the GTFS (§4) instead.
- **Wemobi** (JCA group):
  - `www.wemobi.com.br` now serves a 2014 nginx placeholder ("It's working").
  - The live site is <https://www.wemobi.me>: robots allow all (incl. LLM bots), and its sitemap has 408 URLs.
  - Pages are `/passagem-de-onibus-{city}/para-{city}` plus `/viacao-{partner}` for 1001, Catarinense, Cometa, Expresso do Sul, Guanabara, Nova Itapemirim, Planalto and Águia Branca (~"3,000 rotas").
  - Low.
- **Passagem Promo**: `passagempromo.com.br` (and `/sitemap.xml`) 302s to `contatonline.com`, a parked page. **Dead.**
- **Brasil By Bus**: merged into DeÔnibus (see 5.1).
- **Totalbus**: `totalbus.com.br` redirects to RJ Consultores, a ticketing-software vendor (TOTVS). It has no public data.

---

## 6. Bus terminals

Terminals rarely publish a company × destination list. **Belo Horizonte is the only verified one.**

- **Rodoviária de Belo Horizonte** (concessionaire, WordPress; robots disallows only `/wp-admin/`):
  - <https://rodoviariadebelohorizonte.com.br/empresas-de-transportes/> (HTML, 5 pages) lists each company with
    ticket window, hours, phone, site and **"Linhas operadas"**. Example: `AUTO ÔNIBUS SANTA RITA – SARITUR: Alfenas - MG | Boa Esperança - MG | Itajubá - MG | …`.
  - `sitemap_index.xml` → `destination-transport-sitemap{1,2,3}.xml` gives **459 pages
    `/empresas/destino/{city-uf}/`** (companies per destination). There is also `/destinos/` (A–Z list).
  - Medium-low: use it to validate the BH hub.
- **Socicam**, which runs Tietê, Barra Funda, Jabaquara, Brasília and others:
  - <https://socicam.com.br/terminais-rodoviarios/> is corporate text only; robots allow all.
  - Tickets are sold at `passagens.rodoviariasocicam.com.br` (robots `Disallow: /checkout`). Company info is phone/WhatsApp only.
  - <https://www.terminalrodoviariobrasilia.com.br/> (Socicam) has an "Auto viações" menu item, but only offers were seen.
  - No official list was found for Tietê, Barra Funda or Jabaquara. Sites like `rodoviariadotiete.org` and `terminalrodoviariodotiete.com.br` are unofficial.
- **Porto Alegre** (Veppo, <https://rodoviaria-poa.com.br/linhas-interestaduais-internacionais>) is a React SPA.
  - Its bundle `/assets/index-*.js` embeds 14 interstate/international companies with phone, e-mail and site (Ouro e Prata, Penha, Unesul, Brasil Sul, Catarinense, JBL, Flechabus, EGA, Turil, TTL, Real Expresso, Santo Anjo, Nova Itapemirim, Expresso Nordeste).
  - It has **no destinations**. Low.
- **Novo Rio**: `novorio.com.br` does not resolve. **Curitiba**: the URBS rodoferroviária page returns 403, and `rodoviariacuritiba.com.br` is a
  DeÔnibus white-label. **Goiânia**: no official site found (**unverified**). For GO terminals see AGR's CKAN dataset
  `terminais-rodoviarios-de-passageiros` (§3.8).
- Marketplace station pages (QP 3,891, ClickBus 63, Buson, BuscaOnibus) are derivative.

---

## 7. OpenStreetMap

Overpass (`overpass-api.de`, area `ISO3166-1=BR admin_level=2`, 2026-09-22) and Geofabrik taginfo
(<https://taginfo.geofabrik.de/south-america:brazil/>, data until 2026-09-22T20:20Z):

| Query | Count |
|---|---|
| `relation[route=coach]` | **0** (taginfo: 0) |
| `relation[route=bus][bus=intercity]` / `[bus=regional]` / `[service=long_distance]` | 0 / 0 / 0 |
| `relation[route=bus]` | 7,873 (taginfo: 7,944); 66 `route_master=bus`; 6,493 are PTv2 |
| `network=ANTT` | 30 relations (taginfo: 40) |
| intercity-looking `network` values | ≈510: DETRO 179, EMTU (+variants) ~156, Maringá_Metropolitano 73, ANTT 30, Intermunicipal Urbano 19, Rodoviário 11, Intermunicipal Rodoviário 10, SeMOB 7, Consórcio Metropolitano 6, DER-PB 2… plus operator-named networks: "Aguia Branca" 30 (ES, `085 Vitória - São Mateus`), Minastur 4, Itapemirim 2 |
| `nwr[amenity=bus_station]` | **4,438** (1,508 nodes, 2,782 ways, 148 relations); 1,006 with `operator`; 2,040 named "…rodoviári…" |
| `nwr[public_transport=station][bus=yes]` | 3,415 |

- ANTT examples: `Ônibus 08-0080: São Paulo → Rio de Janeiro` (operator `1001`) and `Ônibus 17-0014: Guarapari → Rio de Janeiro` (`Kaissara`).
- Top `operator` values in the intercity-ish networks: Real Rio 58, Blanco 34, Nextmobilidade 28, Ponte Coberta 20,
  1001 14, ABC Sistema 12, Viação Canarinho 11, Mauá 10, Metra 10, Viação Verdes Mares 10, Anhanguera 15, Kaissara 4, Útil 4.
- Verdict: OSM long-distance line coverage is negligible (~40 ANTT relations vs 1,995 ANTT lines).
  OSM is useful for **terminal locations** (~4.4k `amenity=bus_station`) and **road geometry**
  (route segments with OSRM/Valhalla on OSM roads). License ODbL.
- **Next step**: pull `amenity=bus_station` per UF (`out center tags`) to geocode ANTT/state stop names.
  Compute segment geometry by routing between consecutive stops.

---

## 8. IBGE and research datasets

- **IBGE — Ligações Rodoviárias e Hidroviárias 2016.** This is the only edition online; no newer one was found.
  - FTP: <https://geoftp.ibge.gov.br/organizacao_do_territorio/redes_e_fluxos_geograficos/ligacoes_rodoviarias_e_hidroviarias/base_de_dados/>
    (`leiame.txt`, `xls/`, `ods/`; files dated 2017-07-06).
  - Main file: `Base_de_dados_ligacoes_rodoviarias_e_hidroviarias_2016.{xlsx,ods}` (9.2 / 9.9 MB).
  - Columns: `ID, COD_UF_A, UF_A, CODMUNDV_A, NOMEMUN_A, COD_UF_B, UF_B, CODMUNDV_B, NOMEMUN_B, VAR01…VAR14`:
    - VAR01/02: REGIC 2007 hierarchy;
    - VAR03: minimum cost (R$); VAR04: minimum time (min);
    - VAR05/06/07: departures by water / road / total ("número de saídas"; period **unverified**);
    - VAR08–11: coordinates of the municipal seats;
    - VAR12: departures by operators **without CNPJ**;
    - VAR13: imputation flag; VAR14: cost/time.
  - It has **no company**. Rows are unordered municipality pairs with aggregated frequency, 5,423 municipalities.
  - **The XLSX is truncated at 65,535 data rows.** The ODS has all **65,639** (IBGE's published count). Use the ODS.
  - Also in the folder: `Indices_de_centralidade` and `Municipios_sem_objeto_da_pesquisa`.
  - The PGI app <https://www.ibge.gov.br/apps/ligacoes_rodoviarias/> is **unverified**: `www.ibge.gov.br` returns 403 to curl, while geoftp works.
  - Priority medium. Use it as a coverage check (pairs with regular public transport missing from ANTT/state sources)
    and for frequency weights. It is 2016 data.
- **IBGE — REGIC 2018** (<https://geoftp.ibge.gov.br/organizacao_do_territorio/divisao_regional/regioes_de_influencia_das_cidades/Regioes_de_influencia_das_cidades_2018_Resultados_definitivos/base_tabular/>):
  - `REGIC2018_Ligacoes_entre_Cidades.xlsx` (5.2 MB, 32,062 links). `quest_10` is the link order for "transporte público";
    `ligrod_met` is the metropolis-to-metropolis rank in Ligações Rodoviárias.
  - `REGIC2018_Rotas_Brasil.xlsx` (6.3 MB, 71,081 modelled routes): `cod_o, cod_d, modal (Rodoviário/…), km, minutos, kmh`.
    Geometry is in `base_vetorial/REGIC2018_Rotas2021.zip` (**716 MB, not downloaded**).
  - No company. Low: use it for road km/time per pair.
  - `logistica_dos_transportes/2024` is freight OD, so it is not relevant.
- **Amaral lab / Northwestern — "Brazil bus transportation data"**, DOI `10.21985/N2-9R77-P344` (2023):
  - Code: <https://github.com/amarallab/transportation_network_evolution> (Nature Comms 2022).
  - Monthly ANTT interstate O–D 2005–2014 (`ORIGEM, DESTINO, NUMEROVIAGEMIDA, NUMEROLUGAROFERTADOIDA`, per the loader script).
  - The landing page (arch.library.northwestern.edu) answers 405 to curl, so the files were **not downloaded**. Historical only. Low.
- **IPEA**: Nota Técnica Dirur nº 12 "Transporte semiurbano interestadual de passageiros" (repositorio.ipea.gov.br) is methodology; no dataset was found.
  No GitHub/Zenodo/Figshare dataset of the **current** intercity network with companies was found.

---

## 9. Recommended next integrations (ranked)

1. **ANTT SIGMA (§2.1)**: CC-BY monthly CSVs with CNPJ, lines, sections, ordered
   stops and timetables for all 184 interstate operators. Adds ~26k interstate city pairs and
   350 cities missing from deonibus. It is a direct download with no scraping. Do this first.
2. **CETURB-ES SITRIP (§3.8.1)**: open JSON API with no login. One GET to `/api/seccoes`
   returns all 302 ES lines (15 companies) with every section pair, fare and km, refreshed
   daily. 302 more GETs to `/api/pontoseccao/{id}` add ordered stops **with lat/lon**.
3. **DETRO-RJ (§3.3)**: 1,015 lines with company, itinerary by município and timetable,
   from 1 + 1,015 simple GETs. No robots.txt restriction.
4. **AGERBA-BA (§3.7)**: 1,018 lines and 65 companies with ordered localities, from simple
   ASP pages.
5. **ARTESP OrigemDestino (§3.1a)**: every SP intra-state line with company, CNPJ and ordered
   sections, via a public JSON form API.
6. **AGR-GO CKAN (§3.8.4)**: a CC-BY CSV of 285 lines with company and OD, from one datastore
   request. The per-line PDFs linked from the timetable XLSX add ordered seções, road route and
   timetable.
7. **DER-MG SGTI (§3.2)**: the largest intra-state system (~2,341 lines). The JSF form needs a
   snowball crawler, or a LAI request to SEINFRA.
8. **DAER-RS PDFs (§3.4)**: 1,639 lines (2022) plus a 2025 company list, via one-off PDF
   parsing. Request a fresh export by LAI.
9. **Marketplace route pages as a gap-filler (§5)**, for states whose regulator is gated
   (PR, SC, MG) or publishes nothing.
   - First switch the existing deonibus scraper from `/viacao` pages to the route sitemaps (§5.1):
     ≈157k pages with the company per leg.
   - Then use Quero Passagem's `BusTrip.provider` JSON-LD (§5.2), collapsed to city pairs.
   - Scrape at ≤1 req/s on 2–3 dates. **Do not crawl ClickBus** (its ToS forbids it).
10. **LAI requests for DER-PR (§3.5, robots-disallowed) and SIE-SC (§3.6, reCAPTCHA)**. Use the
    SC section-point API (with coordinates) only as a geocoder.
11. Optional layers:
    - ARTESP metropolitan GTFS + operator XLSX (§3.1b);
    - FlixBus Brazil GTFS (§4: 15 interstate routes with shapes, one download);
    - Grande Recife GTFS and the RMBH WFS (§4) as metropolitan layers;
    - OSM `amenity=bus_station` as a stop geocoder (§7);
    - IBGE Ligações 2016 (ODS, §8) as a coverage check;
    - ANTT Monitriip bilhetes as OD demand weights (§2.3).
