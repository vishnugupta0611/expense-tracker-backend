// Data-only, best-effort wake-up. The payload intentionally contains no content.
async function sendUpdatePush(token, day, count, getMessaging = () => require('../config/firebase').messaging()) {
  if (typeof token !== 'string' || !token.trim()) return;
  try {
    await getMessaging().send({
      token,
      data: { type: 'today_updates_changed', screen: 'summary', date: day, count: String(count), target: '1500' },
      android: { priority: 'high' },
      apns: { headers: { 'apns-push-type': 'background', 'apns-priority': '5' }, payload: { aps: { contentAvailable: true } } },
    });
  } catch (_) {
    // Push is advisory; do not expose the token or affect a committed update.
  }
}
module.exports = { sendUpdatePush };
