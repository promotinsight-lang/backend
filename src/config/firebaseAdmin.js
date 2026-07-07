const admin = require("firebase-admin");
const { getAuth } = require("firebase-admin/auth");

const parseServiceAccount = () => {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return null;

  const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  return parsed;
};

const getFirebaseAdmin = () => {
  if (admin.getApps().length === 0) {
    const serviceAccount = parseServiceAccount();
    admin.initializeApp({
      credential: serviceAccount
        ? admin.cert(serviceAccount)
        : admin.applicationDefault(),
    });
  }

  return {
    auth: () => getAuth(),
  };
};

module.exports = getFirebaseAdmin();
