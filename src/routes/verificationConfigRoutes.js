const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');
const {
  getVerificationFormConfig,
  getGlobalVerificationFields,
  updateGlobalVerificationFields,
  getPlatformVerificationFields,
  updatePlatformVerificationFields,
} = require('../controllers/verificationConfigController');

router.get('/', getVerificationFormConfig);
router.get('/global', protect, authorize('admin'), getGlobalVerificationFields);
router.put('/global', protect, authorize('admin'), updateGlobalVerificationFields);
router.post('/global', protect, authorize('admin'), updateGlobalVerificationFields);
router.get('/platform', protect, authorize('admin'), getPlatformVerificationFields);
router.post('/platform', protect, authorize('admin'), updatePlatformVerificationFields);

module.exports = router;
