const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');

const { 
  getAllPaymentMethods, 
  updatePaymentMethod, 
  addNetwork, 
  deleteNetwork 
} = require('../controllers/paymentMethodController');

// Public or All Logged-in Users
router.get('/list', protect, getAllPaymentMethods);

// Admin Only Routes
router.patch('/update/:id', protect, authorize('admin'), updatePaymentMethod);
router.post('/network/add', protect, authorize('admin'), addNetwork);
router.delete('/network/:id', protect, authorize('admin'), deleteNetwork);

module.exports = router;