export interface Template {
  name: string;
  description: string;
  perspectives: Array<{
    name: string;
    description: string;
    diagram: string;
    context?: string;
    constraint?: string;
    concern?: string;
  }>;
}

export const TEMPLATES: Record<string, Template> = {
  microservices: {
    name: 'Microservices',
    description: 'Service-oriented architecture with independent deployable services',
    perspectives: [
      {
        name: 'overall-architecture',
        description: 'High-level view of the microservice ecosystem. Each service owns its data and communicates via APIs or message queues.',
        diagram: `graph LR
    gateway["API Gateway\nrouting + auth"]
    svc-a["Service A\nbusiness logic"]
    svc-b["Service B\nbusiness logic"]
    svc-c["Service C\nbusiness logic"]
    db-a["Database A"]
    db-b["Database B"]
    queue["Message Queue\nasync events"]

    gateway -->|"REST"| svc-a
    gateway -->|"REST"| svc-b
    gateway -->|"REST"| svc-c
    svc-a -->|"queries"| db-a
    svc-b -->|"queries"| db-b
    svc-a -->|"events"| queue
    queue -->|"consumes"| svc-c

    classDef entry fill:#89b4fa,stroke:#89b4fa,color:#1e1e2e
    classDef store fill:#a6e3a1,stroke:#a6e3a1,color:#1e1e2e
    class gateway entry
    class db-a,db-b store`,
        context: 'Each service is independently deployable. Shared data is avoided — services communicate through well-defined APIs or async events.',
      },
      {
        name: 'api-gateway',
        description: 'Single entry point for all client requests. Handles routing, authentication, rate limiting, and request aggregation.',
        diagram: `graph TD
    client["Client\nweb/mobile/desktop"]
    auth["Auth Middleware\nJWT validation"]
    router["Router\npath-based routing"]
    rate-limit["Rate Limiter\nper-client throttling"]
    svc-registry["Service Registry\ndiscovery + health"]

    client -->|"HTTPS"| auth
    auth -->|"validates"| router
    router -->|"checks"| rate-limit
    router -->|"discovers"| svc-registry

    classDef entry fill:#89b4fa,stroke:#89b4fa,color:#1e1e2e
    class client,auth entry`,
        constraint: 'All external traffic must go through the gateway. Services should not be directly exposed.',
      },
      {
        name: 'message-queue',
        description: 'Asynchronous event bus connecting services. Enables decoupled communication and eventual consistency.',
        diagram: `graph LR
    producer["Producer\npublishes events"]
    exchange["Exchange\nrouting rules"]
    q-a["Queue A\nhigh priority"]
    q-b["Queue B\nbatch processing"]
    consumer-a["Consumer A\nreal-time"]
    consumer-b["Consumer B\nbatch worker"]

    producer -->|"publish"| exchange
    exchange -->|"route"| q-a
    exchange -->|"route"| q-b
    q-a -->|"consume"| consumer-a
    q-b -->|"consume"| consumer-b

    classDef concern fill:#f38ba8,stroke:#f38ba8,color:#1e1e2e
    class exchange concern`,
        concern: 'Message ordering is not guaranteed across queues. Use idempotent consumers.',
      },
    ],
  },

  monolith: {
    name: 'Monolith',
    description: 'Single deployable unit with modular internal structure',
    perspectives: [
      {
        name: 'overall-architecture',
        description: 'Layered monolith with clear module boundaries. All code deploys as a single unit.',
        diagram: `graph TD
    web["Web Layer\ncontrollers + views"]
    service["Service Layer\nbusiness logic"]
    repo["Repository Layer\ndata access"]
    db["Database\nsingle source of truth"]
    cache["Cache Layer\nRedis/Memcached"]

    web -->|"calls"| service
    service -->|"queries"| repo
    repo -->|"reads/writes"| db
    service -->|"caches"| cache

    classDef entry fill:#89b4fa,stroke:#89b4fa,color:#1e1e2e
    classDef store fill:#a6e3a1,stroke:#a6e3a1,color:#1e1e2e
    class web entry
    class db,cache store`,
        constraint: 'Modules communicate through interfaces, not direct imports. Each module has its own package namespace.',
      },
      {
        name: 'data-model',
        description: 'Core domain entities and their relationships. Single database with clear table boundaries per module.',
        diagram: `graph LR
    user["User\nauthentication + profile"]
    org["Organization\nteam management"]
    project["Project\nwork container"]
    task["Task\nunit of work"]
    comment["Comment\ndiscussion thread"]

    user -->|"belongs to"| org
    org -->|"owns"| project
    project -->|"contains"| task
    task -->|"has"| comment
    user -->|"authors"| comment

    classDef store fill:#a6e3a1,stroke:#a6e3a1,color:#1e1e2e
    class user,org,project,task,comment store`,
      },
    ],
  },

  'web-app': {
    name: 'Web Application',
    description: 'Full-stack web application with frontend, backend, and data layers',
    perspectives: [
      {
        name: 'overall-architecture',
        description: 'Client-server web application with REST API backend and single-page frontend.',
        diagram: `graph TD
    browser["Browser\nSPA frontend"]
    cdn["CDN\nstatic assets"]
    api["REST API\nExpress/Fastify"]
    auth["Auth Service\nJWT + OAuth"]
    db["PostgreSQL\nprimary store"]
    cache["Redis\nsession + cache"]
    storage["Object Storage\nfiles + media"]

    browser -->|"loads"| cdn
    browser -->|"API calls"| api
    api -->|"validates"| auth
    api -->|"queries"| db
    api -->|"caches"| cache
    api -->|"uploads"| storage

    classDef entry fill:#89b4fa,stroke:#89b4fa,color:#1e1e2e
    classDef store fill:#a6e3a1,stroke:#a6e3a1,color:#1e1e2e
    class browser,api entry
    class db,cache,storage store`,
      },
      {
        name: 'frontend',
        description: 'Single-page application structure. Component-based architecture with state management.',
        diagram: `graph TD
    router["Router\npage navigation"]
    auth-guard["Auth Guard\nroute protection"]
    pages["Pages\nroute-level components"]
    components["Components\nreusable UI"]
    store["State Store\nglobal state"]
    api-client["API Client\nHTTP layer"]

    router -->|"checks"| auth-guard
    router -->|"renders"| pages
    pages -->|"compose"| components
    components -->|"read/write"| store
    store -->|"fetches"| api-client

    classDef entry fill:#89b4fa,stroke:#89b4fa,color:#1e1e2e
    class router entry`,
        context: 'Components follow atomic design: atoms → molecules → organisms → templates → pages.',
      },
    ],
  },

  'api-service': {
    name: 'API Service',
    description: 'Backend API service with REST endpoints and data persistence',
    perspectives: [
      {
        name: 'overall-architecture',
        description: 'RESTful API service with layered architecture. Clean separation between transport, business logic, and data access.',
        diagram: `graph TD
    transport["Transport Layer\nHTTP handlers"]
    middleware["Middleware\nauth, logging, validation"]
    domain["Domain Layer\nbusiness rules"]
    persistence["Persistence Layer\nrepositories"]
    db["Database"]
    ext["External APIs\nthird-party services"]

    transport -->|"passes through"| middleware
    middleware -->|"calls"| domain
    domain -->|"uses"| persistence
    persistence -->|"queries"| db
    domain -->|"integrates"| ext

    classDef entry fill:#89b4fa,stroke:#89b4fa,color:#1e1e2e
    class transport entry`,
        constraint: 'Domain layer has zero dependencies on transport or persistence. Testable in isolation.',
      },
    ],
  },

  'data-pipeline': {
    name: 'Data Pipeline',
    description: 'ETL/ELT data processing pipeline with ingestion, transformation, and output stages',
    perspectives: [
      {
        name: 'overall-architecture',
        description: 'Data flows from sources through ingestion, transformation, and storage to consumers.',
        diagram: `graph LR
    sources["Data Sources\nAPIs, files, streams"]
    ingest["Ingestion\nvalidation + dedup"]
    transform["Transformation\nenrichment + mapping"]
    store["Data Store\nwarehouse/lake"]
    serve["Serving Layer\nAPI + views"]
    consumers["Consumers\ndashboards, ML, reports"]

    sources -->|"extract"| ingest
    ingest -->|"clean"| transform
    transform -->|"load"| store
    store -->|"query"| serve
    serve -->|"deliver"| consumers

    classDef entry fill:#89b4fa,stroke:#89b4fa,color:#1e1e2e
    classDef store fill:#a6e3a1,stroke:#a6e3a1,color:#1e1e2e
    class sources entry
    class store store`,
        concern: 'Late-arriving data may cause reprocessing. Design for idempotency in each stage.',
      },
    ],
  },
};

export function listTemplates(): string[] {
  return Object.keys(TEMPLATES);
}

export function getTemplate(name: string): Template | undefined {
  return TEMPLATES[name];
}
