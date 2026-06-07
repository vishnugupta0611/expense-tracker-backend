const admin = require("firebase-admin");
const path = require("path");

if (!admin.apps.length) {
  let credential;

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    // Use individual env vars (production / CI)
    credential = admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });
  } else {
    // Fall back to local JSON file (development)
    const serviceAccount = require(path.join(__dirname, "../firebase-admin.json"));
    credential = admin.credential.cert(serviceAccount);
  }

  admin.initializeApp({ credential });
  console.log("🔥 Firebase Admin Initialized");
}

module.exports = admin;
