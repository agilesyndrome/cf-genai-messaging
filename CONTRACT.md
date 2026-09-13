# Feature contract

- createFeature(options) returns name and middleware.
- Middleware may return a response or call next().
- Request state belongs in the state object supplied by cf-genai-base.
- Cloudflare bindings are supplied by the consuming Worker environment.
- Feature-owned migrations and schemas must be versioned with the feature.
