const test = require('node:test');
const assert = require('node:assert/strict');
const { verifiedPrimaryEmail } = require('../services/clerkIdentity');

test('links only a verified primary Clerk email', () => {
  const user = { primaryEmailAddressId: 'primary', emailAddresses: [
    { id: 'other', emailAddress: 'other@example.com', verification: { status: 'verified' } },
    { id: 'primary', emailAddress: ' User@Example.com ', verification: { status: 'verified' } },
  ] };
  assert.equal(verifiedPrimaryEmail(user), 'user@example.com');
  user.emailAddresses[1].verification.status = 'unverified';
  assert.equal(verifiedPrimaryEmail(user), null);
  assert.equal(verifiedPrimaryEmail({}), null);
});
