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
    const projectId =
      serviceAccount?.project_id ||
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      "promotinsight";

    const appOptions = {};

    if (serviceAccount) {
      appOptions.credential = admin.cert(serviceAccount);
    }

    if (projectId) {
      appOptions.projectId = projectId;
    }

    admin.initializeApp(appOptions);
  }

  return {
    auth: () => getAuth(),
  };
};

module.exports = getFirebaseAdmin();
