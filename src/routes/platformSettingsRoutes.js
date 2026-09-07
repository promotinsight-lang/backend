const express = require("express");
const router = express.Router();

const { getPublicPlatformSettings } = require("../controllers/platformSettingsController");

router.get("/", getPublicPlatformSettings);

module.exports = router;
