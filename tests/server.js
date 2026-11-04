'use strict';
// Tiny local web server for tests: serves index.html and runs the /api functions
// against stand-in Redis and Resend. Not used in production.
const http = require('http'), fs = require('fs'), path = require('path');
const fakes = require('./fakes');
process.env.KV_REST_API_URL = 'https://fake.upstash.io';
process.env.KV_REST_API_TOKEN = 'tok';
process.env.RESEND_API_KEY = 're_fake';
process.env.APP_PASSWORD = 'test-pass';
process.env.CRON_SECRET = 'cronsecret';
const routes = {
  '/api/ping': require('../api/ping'), '/api/state': require('../api/state'), '/api/status': require('../api/status'),
  '/api/test-email': require('../api/test-email'), '/api/reminders': require('../api/reminders'),
  '/api/cron/send-reminders': require('../api/cron/send-reminders')
};
function start(port) {
  const srv = http.createServer(function (req, res) {
    const p = req.url.split('?')[0];
    if (routes[p]) {
      let data = '';
      req.on('data', function (c) { data += c; });
      req.on('end', function () {
        try { req.body = data ? JSON.parse(data) : undefined; } catch (e) { req.body = undefined; }
        routes[p](req, res);
      });
      return;
    }
    if (p === '/' || p === '/index.html') { res.setHeader('Content-Type', 'text/html'); return res.end(fs.readFileSync(path.join(__dirname, '..', 'index.html'))); }
    res.statusCode = 404; res.end('not found');
  });
  return new Promise(function (ok) { srv.listen(port || 0, '127.0.0.1', function () { ok({ srv: srv, port: srv.address().port, fakes: fakes }); }); });
}
module.exports = { start: start };
