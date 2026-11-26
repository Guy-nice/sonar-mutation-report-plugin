# 4. Dynamic views (UML)

## 4.1 Scan: report to measures

```mermaid
sequenceDiagram
  title Scan - report to measures
  autonumber
  participant CI as CI + SonarScanner
  participant S as MutationReportSensor
  participant P as ReportParser
  participant SQ as Sonar server (CE)
  participant C as Computers

  CI->>S: execute() when sonar.mutation.reportPath is set
  S->>S: resolve path against project base dir
  alt file missing
    S-->>CI: warn, publish nothing
  else file found
    S->>P: parse(reader)
    alt invalid or schema major not 1
      P-->>S: IllegalArgumentException
      S-->>CI: IllegalStateException, scan fails
    else valid
      P-->>S: Report
      S->>SQ: project measures (overall + new_), threshold, score_before, duration
      S->>SQ: per-language measures (merged into buckets)
      S->>SQ: per-file measures (files in analysis only)
      S->>SQ: ad hoc rules + one external issue per mutant
    end
  end
  CI->>SQ: upload analysis
  SQ->>C: CountsComputer: sum children
  C->>C: PercentComputer: derive percentages
  C->>SQ: derived measures
```

## 4.2 Overview page load

```mermaid
sequenceDiagram
  title Overview page load (manager)
  autonumber
  actor M as Manager
  participant UI as ui/overview
  participant ST as store (localStorage)
  participant API as SonarApi
  participant W as Sonar web API

  M->>UI: open More > Mutation overview
  par parallel
    UI->>API: listProjects()
    API->>W: /api/components/search (TRK, paged)
  and
    UI->>API: listPortfolios()
    API->>W: /api/views/list, fallback /api/components/search (VW)
    API->>W: /api/components/tree, fallback /api/measures/component_tree
  end
  UI->>ST: knownAdopters, dormantProjects
  Note over UI: order: known adopters first, skip dormant (24 h)
  loop each project, max 6 in flight
    UI->>API: loadProject(p)
    API->>W: /api/project_pull_requests/list
    API->>W: /api/measures/component per PR in 30 days
    API-->>UI: ProjectResult (or error)
    UI->>ST: remember adopter or dormant
    UI->>UI: repaint in batches, progress bar
  end
  UI->>UI: loading = false, show Data ready mark
```

Notes:
- A load id drops results of an older load after Refresh or leave.
- Refresh clears the API cache and the dormant list.
- A failed project becomes `ProjectResult.error`. It is not counted in adoption.

## 4.3 Portfolio read

```mermaid
sequenceDiagram
  title Portfolio read with fallbacks
  participant API as SonarApi.listPortfolios
  participant W as Sonar web API

  API->>W: GET /api/views/list
  alt call fails
    API->>W: GET /api/components/search?qualifiers=VW
  end
  loop each portfolio
    API->>W: GET /api/components/tree (TRK, strategy all)
    alt call fails
      API->>W: GET /api/measures/component_tree
    end
    Note over API: project key = refKey if present, else key
  end
  Note over API: any total failure returns [] so every component shows under No portfolio
```

## 4.4 Overview load states

```mermaid
stateDiagram-v2
  [*] --> Loading: page mounted
  Loading --> Ready: all projects done
  Loading --> Failed: project list fails
  Ready --> Loading: Refresh
  Loading --> [*]: dispose (older results dropped)
  Ready --> [*]: dispose
```

Loading shows a progress bar and a "partial" mark on the adoption card. Ready shows a "Data ready" mark with count and time.

## 4.5 Component status in the overview

```mermaid
stateDiagram-v2
  [*] --> Unknown: load error
  [*] --> Inactive: no PR in 30 days
  [*] --> ActiveNoData: PR in 30 days, no mutation data
  [*] --> Live: PR in 30 days with mutation data
  Unknown: Not counted (state unknown)
  Inactive: Not counted
  ActiveNoData: In the 100% of adoption
  Live: In 100% and in adopted. Listed in table.
```
