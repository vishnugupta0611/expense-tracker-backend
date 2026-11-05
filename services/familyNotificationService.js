const User = require('../models/User');

// Firebase is loaded only when there is a recipient, so missing credentials do not
// prevent family posts and messages from being saved.
async function notifyFamily({ familyKey, actorId, recipientId, title, body, type, itemId }) {
  if (!familyKey || !actorId) return;
  const query = { familyKey, _id: recipientId ? { $eq: recipientId, $ne: actorId } : { $ne: actorId }, fcmtoken: { $type: 'string', $ne: '' } };
  const recipients = await User.find(query).select('_id fcmtoken').lean();
  if (!recipients.length) return;
  const messaging = require('../config/firebase').messaging();
  const seen = new Set();
  let failed = 0;
  await Promise.allSettled(recipients.map(async ({ _id, fcmtoken }) => {
    if (seen.has(fcmtoken)) return;
    seen.add(fcmtoken);
    try {
      await messaging.send({
        token: fcmtoken,
        notification: { title, body: (body || '').slice(0, 200) },
        data: { screen: 'social', section: type === 'family_message' ? 'chat' : 'posts', type, itemId: String(itemId) },
      });
    } catch (error) {
      failed += 1;
      if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(error.code)) {
        // Do not erase a replacement token registered while this send was in flight.
        await User.updateOne({ _id, fcmtoken }, { $unset: { fcmtoken: 1 } });
      }
    }
  }));
  if (failed) console.warn(`Family notification delivery failed for ${failed} device(s)`);
}

module.exports = { notifyFamily };
