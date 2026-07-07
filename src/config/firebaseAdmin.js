const admin = require("firebase-admin");

const parseServiceAccount = () => {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return null;

  const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  return parsed;
};

const getFirebaseAdmin = () => {
  if (admin.apps.length > 0) return admin;

  const serviceAccount = parseServiceAccount();
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return admin;
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
  return admin;
};

module.exports = getFirebaseAdmin();
