// Serialize content imports/exports/restores against update installation and all
// personal mutations. Release after the handler finishes, including aborted uploads.
export function registerLocalWriteGate(app, updates) {
  app.decorate('localActiveWrites', 0);
  let exclusive = null;
  const mutates = method => !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const content = /\/local\/(import-pack|import-answers|restore|export-pack|export-answers)(?:\?|$)/;
  const busy = () => Object.assign(new Error('\u6b63\u5728\u4fdd\u5b58\u3001\u5bfc\u5165\u5bfc\u51fa\u6216\u5b89\u88c5\u66f4\u65b0\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5'), { statusCode: 409 });
  function release(req) {
    if (exclusive === req) exclusive = null;
    if (req.localWriteActive) { req.localWriteActive = false; app.localActiveWrites--; }
  }
  app.addHook('onRequest', async req => {
    if (!mutates(req.method)) return;
    if (exclusive || updates.pauseWrites) throw busy();
    if (content.test(req.url)) {
      if (updates.busy || app.localActiveWrites > 0) throw busy();
      exclusive = req;
    }
    req.localWriteActive = true; app.localActiveWrites++;
  });
  app.addHook('onRoute', route => {
    if (![route.method].flat().some(mutates)) return;
    const handler = route.handler;
    route.handler = async function (req, reply) {
      req.localHandlerActive = true;
      try { return await handler.call(this, req, reply); }
      finally { req.localHandlerActive = false; release(req); }
    };
  });
  app.addHook('onResponse', async req => { if (!req.localHandlerActive) release(req); });
  app.addHook('onError', async req => { if (!req.localHandlerActive) release(req); });
  for (const hook of ['onRequestAbort', 'onTimeout'])
    app.addHook(hook, async req => { if (!req.localHandlerActive) release(req); });
}
