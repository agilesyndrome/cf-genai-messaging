export function createFeature(options = {}) {
  const name = options.name || "cf-genai-feature";
  return {
    name,
    middleware: async (request, env, ctx, next, state) => {
      if (options.boot) await options.boot(env, { request, ctx, state });
      return options.handle ? options.handle(request, env, ctx, next, state) : next();
    }
  };
}
