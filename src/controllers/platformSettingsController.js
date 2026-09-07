const pool = require("../config/db");

const DEFAULT_FACEBOOK_GROUP_URL = "https://www.facebook.com/promotinsight";
const FACEBOOK_GROUP_URL_KEY = "facebook_group_url";

const isValidURL = (string) => {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
};

const ensurePlatformSettingsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const getSettingValue = async (key, fallback = "") => {
  await ensurePlatformSettingsTable();
  const result = await pool.query("SELECT value FROM platform_settings WHERE key = $1", [key]);
  return result.rows[0]?.value || fallback;
};

const getPublicPlatformSettings = async (req, res) => {
  try {
    const facebookGroupUrl = await getSettingValue(FACEBOOK_GROUP_URL_KEY, DEFAULT_FACEBOOK_GROUP_URL);
    return res.status(200).json({
      success: true,
      data: {
        facebook_group_url: facebookGroupUrl,
      },
    });
  } catch (error) {
    console.error("GET PLATFORM SETTINGS ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const updatePlatformSettings = async (req, res) => {
  try {
    const facebookGroupUrl = String(req.body.facebook_group_url || "").trim();

    if (!facebookGroupUrl) {
      return res.status(400).json({ success: false, message: "Facebook group URL is required." });
    }
    if (!isValidURL(facebookGroupUrl)) {
      return res.status(400).json({ success: false, message: "Facebook group URL must be a valid URL." });
    }

    await ensurePlatformSettingsTable();
    await pool.query(
      `INSERT INTO platform_settings (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [FACEBOOK_GROUP_URL_KEY, facebookGroupUrl]
    );

    return res.status(200).json({
      success: true,
      message: "Platform settings saved.",
      data: {
        facebook_group_url: facebookGroupUrl,
      },
    });
  } catch (error) {
    console.error("UPDATE PLATFORM SETTINGS ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  DEFAULT_FACEBOOK_GROUP_URL,
  getPublicPlatformSettings,
  updatePlatformSettings,
};
