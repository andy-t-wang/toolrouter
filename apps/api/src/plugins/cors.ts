// CORS hook installer. Plain Fastify plugins are encapsulated by default —
// hooks added inside `app.register(corsPlugin)` would only apply to that
// plugin's scope, not to sibling plugins. We call `applyCors(app)` inline in
// `createApiApp` BEFORE any other plugin is registered so the hook applies
// to every route in the tree.

export function applyCors(app: any) {
  app.addHook("onRequest", (request: any, reply: any, done: any) => {
    const origin = process.env.TOOLROUTER_CORS_ORIGIN || "*";
    reply.header("access-control-allow-origin", origin);
    reply.header(
      "access-control-allow-headers",
      "authorization,content-type,x-requested-with,payment-signature,agentkit,settlement-overrides",
    );
    reply.header(
      "access-control-expose-headers",
      "payment-required,payment-response,x-payment-response",
    );
    reply.header("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
    if (request.method === "OPTIONS") {
      reply.status(204).send();
      return;
    }
    done();
  });
}
