// Only a verified primary email may link an existing account.
function verifiedPrimaryEmail(user) {
  const address = user?.emailAddresses?.find(item =>
    item.id === user.primaryEmailAddressId && item.verification?.status === 'verified');
  return address?.emailAddress?.trim().toLowerCase() || null;
}

module.exports = { verifiedPrimaryEmail };
