const express = require('express');
const router = express.Router();

// কন্ট্রোলার ইম্পোর্ট
const {
  requestChat,
  getMyChatStatus,
  getPendingChatRequests,
  approveChatRequest,
  rejectChatRequest,
  adminStartChatWithUser,
  adminEndChat,
  getSessionMessages
} = require('../controllers/privateChatController');

// ⚠️ আপনার প্রজেক্টের Auth Middleware ইম্পোর্ট করুন
// (এখানে আমি ডেমো হিসেবে verifyToken এবং isAdmin ব্যবহার করেছি, আপনি আপনার প্রজেক্টের সঠিক মিডলওয়্যারের নাম ও পাথ বসিয়ে নেবেন)
const { verifyToken, isAdmin } = require('../middleware/authMiddleware'); 

// ==========================================
// User Routes (লগইন করা এবং ভেরিফাইড ইউজারদের জন্য)
// ==========================================
// নতুন চ্যাটের রিকোয়েস্ট পাঠানো
router.post('/request', verifyToken, requestChat);

// ইউজারের বর্তমান চ্যাট স্ট্যাটাস চেক করা
router.get('/me/status', verifyToken, getMyChatStatus);

// যেকোনো সেশনের মেসেজ হিস্ট্রি দেখা (ইউজার এবং এডমিন উভয়ের জন্য)
router.get('/sessions/:sessionId/messages', verifyToken, getSessionMessages);


// ==========================================
// Admin Routes (শুধুমাত্র এডমিনদের জন্য)
// ==========================================
// পেন্ডিং রিকোয়েস্টের লিস্ট দেখা
router.get('/admin/requests', verifyToken, isAdmin, getPendingChatRequests);

// কোনো রিকোয়েস্ট একসেপ্ট বা রিজেক্ট করা
router.post('/admin/requests/:id/approve', verifyToken, isAdmin, approveChatRequest);
router.post('/admin/requests/:id/reject', verifyToken, isAdmin, rejectChatRequest);

// এডমিন নিজে থেকে কোনো ইউজারের সাথে চ্যাট শুরু করলে
router.post('/admin/start', verifyToken, isAdmin, adminStartChatWithUser);

// চ্যাট সেশন ক্লোজ করে দেওয়া
router.post('/admin/sessions/:sessionId/end', verifyToken, isAdmin, adminEndChat);

module.exports = router;