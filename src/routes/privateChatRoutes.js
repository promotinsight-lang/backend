const express = require('express');
const router = express.Router();

// 🟢 ডাটাবেস কানেকশন ইম্পোর্ট করা হলো (সরাসরি কোয়েরি চালানোর জন্য)
const pool = require('../config/db'); 

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

// 👈 আপনার প্রজেক্টের সঠিক মিডলওয়্যারগুলো ইম্পোর্ট করা হলো
const { protect, isAdmin } = require('../middleware/authMiddleware'); 

// ==========================================
// User Routes (লগইন করা এবং ভেরিফাইড ইউজারদের জন্য)
// ==========================================
// নতুন চ্যাটের রিকোয়েস্ট পাঠানো
router.post('/request', protect, requestChat);

// ইউজারের বর্তমান চ্যাট স্ট্যাটাস চেক করা
router.get('/me/status', protect, getMyChatStatus);

// যেকোনো সেশনের মেসেজ হিস্ট্রি দেখা (ইউজার এবং এডমিন উভয়ের জন্য)
router.get('/sessions/:sessionId/messages', protect, getSessionMessages);


// ==========================================
// Admin Routes (শুধুমাত্র এডমিনদের জন্য)
// ==========================================
// পেন্ডিং রিকোয়েস্টের লিস্ট দেখা
router.get('/admin/requests', protect, isAdmin, getPendingChatRequests);

// 🟢 নতুন যুক্ত করা হলো: Active Sessions Fetch API (For Admin Sidebar)
router.get('/admin/sessions', protect, isAdmin, async (req, res) => {
    try {
        const query = `
            SELECT s.*, u.name, u.email 
            FROM private_chat_sessions s
            LEFT JOIN users u ON s.user_id = u.id
            WHERE s.status = 'active'
        `;
        const result = await pool.query(query);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error("Error fetching active sessions:", error);
        res.status(500).json({ success: false, message: "Server error fetching sessions" });
    }
});

// কোনো রিকোয়েস্ট একসেপ্ট বা রিজেক্ট করা
router.post('/admin/requests/:id/approve', protect, isAdmin, approveChatRequest);
router.post('/admin/requests/:id/reject', protect, isAdmin, rejectChatRequest);

// এডমিন নিজে থেকে কোনো ইউজারের সাথে চ্যাট শুরু করলে
router.post('/admin/start', protect, isAdmin, adminStartChatWithUser);

// চ্যাট সেশন ক্লোজ করে দেওয়া
router.post('/admin/sessions/:sessionId/end', protect, isAdmin, adminEndChat);

module.exports = router;