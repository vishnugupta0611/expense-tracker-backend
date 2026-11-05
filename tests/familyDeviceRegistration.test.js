const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const calls = [];
const mockUser = {
  updateMany: async (...args) => { calls.push(['many', ...args]); },
  updateOne: async (...args) => { calls.push(['one', ...args]); },
};
const original = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent?.filename.endsWith('routes\\family.js') || parent?.filename.endsWith('routes/family.js')) {
    if (request === '../middleware/auth') return (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.userId = 'account'; next(); };
    if (request === '../models/User') return mockUser;
    if (request === '../models/FamilyMessage') return {};
    if (request === '../services/familyNotificationService') return {};
    if (request === '../controllers/familyController') return { createFamilyLink() {}, addPersonToFamily() {}, getFamilyMembers() {} };
  }
  return original.call(this, request, parent, ...rest);
};
const router = require('../routes/family');
Module._load = original;

test('device registration authenticates, validates and moves a token without returning it', async () => {
  const app = express(); app.use(express.json()); app.use('/family', router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/family/device-token`;
  try {
    let res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fcmtoken: 'device' }) });
    assert.equal(res.status, 401);
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' }, body: JSON.stringify({ fcmtoken: '  ' }) });
    assert.equal(res.status, 400); assert.equal(calls.length, 0);
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' }, body: JSON.stringify({ fcmtoken: 'device' }) });
    assert.equal(res.status, 200); assert.doesNotMatch(await res.text(), /device"/);
    assert.deepEqual(calls, [
      ['many', { _id: { $ne: 'account' }, fcmtoken: 'device' }, { $unset: { fcmtoken: 1 } }],
      ['one', { _id: 'account' }, { $set: { fcmtoken: 'device' } }],
    ]);
  } finally { server.close(); }
});
