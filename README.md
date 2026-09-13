# @agilesyndrome/cf-genai-feature

Use this repository as the starting point for a composable Cloudflare Worker
feature such as passport stamps or LLM access.

A feature exports an object with middleware(request, env, ctx, next, state).
Applications layer it into @agilesyndrome/cf-genai-base:

    import { createWorker } from "@agilesyndrome/cf-genai-base";
    import { createFeature } from "@agilesyndrome/cf-genai-feature";

    const feature = createFeature();
    export default createWorker({ features: [feature], fetch: router });

Keep migrations, binding names, API clients, schemas, and route policy in the
feature package. The site supplies only its D1/R2 bindings and domain handlers.
Do not use module-level mutable request state.
