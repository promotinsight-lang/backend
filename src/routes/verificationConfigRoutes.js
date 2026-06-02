const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');
const {
  getVerificationFormConfig,
  getGlobalVerificationFields,
  updateGlobalVerificationFields,
} = require('../controllers/verificationConfigController');

router.get('/', getVerificationFormConfig);
router.get('/global', protect, authorize('admin'), getGlobalVerificationFields);
router.put('/global', protect, authorize('admin'), updateGlobalVerificationFields);

module.exports = router;
