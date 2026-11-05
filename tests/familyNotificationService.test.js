const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let query, recipients, sent, updates, failures;
const User = {
  find(q) { query = q; return { select() { return { lean: async () => recipients }; } }; },
  async updateOne(filter, change) { updates.push({ filter, change }); },
};
const firebase = { messaging: () => ({ send: async message => {
  sent.push(message);
  if (failures[message.token]) throw { code: failures[message.token] };
} }) };
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent?.filename.endsWith('familyNotificationService.js')) {
    if (request === '../models/User') return User;
    if (request === '../config/firebase') return firebase;
  }
  return load.call(this, request, parent, ...rest);
};
const { notifyFamily } = require('../services/familyNotificationService');
Module._load = load;
// Lazy Firebase import uses Module._load at send time.
const firebasePath = require.resolve('../config/firebase');
require.cache[firebasePath] = { id: firebasePath, filename: firebasePath, loaded: true, exports: firebase };

test('family messages target other family members with routable data and no duplicate sends', async () => {
  recipients = [{ _id: 'a', fcmtoken: 'one' }, { _id: 'b', fcmtoken: 'one' }, { _id: 'c', fcmtoken: 'two' }]; sent = []; updates = []; failures = {};
  await notifyFamily({ familyKey: 'family', actorId: 'actor', title: 'Message', body: 'hello', type: 'family_message', itemId: 'msg' });
  assert.equal(query.familyKey, 'family');
  assert.equal(query._id.$ne, 'actor');
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].data, { screen: 'social', section: 'chat', type: 'family_message', itemId: 'msg' });
});

test('post activity is scoped to its owner, excludes actor, and only clears invalid tokens conditionally', async () => {
  recipients = [{ _id: 'owner', fcmtoken: 'bad' }, { _id: 'other', fcmtoken: 'temporary' }]; sent = []; updates = [];
  failures = { bad: 'messaging/registration-token-not-registered', temporary: 'messaging/internal-error' };
  await notifyFamily({ familyKey: 'family', actorId: 'actor', recipientId: 'owner', title: 'Post', body: 'x'.repeat(300), type: 'family_post', itemId: 'post' });
  assert.deepEqual(query._id, { $eq: 'owner', $ne: 'actor' });
  assert.equal(sent[0].notification.body.length, 200);
  assert.equal(sent[0].data.section, 'posts');
  assert.deepEqual(updates, [{ filter: { _id: 'owner', fcmtoken: 'bad' }, change: { $unset: { fcmtoken: 1 } } }]);
});

test('no recipients means no Firebase delivery', async () => {
  recipients = []; sent = []; failures = {}; updates = [];
  await notifyFamily({ familyKey: 'family', actorId: 'actor', type: 'family_post', itemId: 'post' });
  assert.equal(sent.length, 0);
});
