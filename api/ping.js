'use strict';
// Public health check. Says only whether each setting exists, never its value.
const L = require('./_lib');
module.exports = async function (req, res) {
  L.send(res, 200, {
    ok: true,
    redis: !!L.redisConf(),
    resend: !!L.env('RESEND_API_KEY'),
    password: !!L.env('APP_PASSWORD'),
    cron: !!L.env('CRON_SECRET'),
    sender: L.env('RESEND_FROM') ? 'custom' : 'resend-test-address'
  });
};
