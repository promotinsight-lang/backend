const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { protect } = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');

const {
  createTicket,
  getMyTickets,
  getAllTickets,
  getTicketDetails,
  replyToTicket,
  closeTicket
} = require('../controllers/supportController');

// ==========================================
// 🛡️ Rate Limiters (Defense in Depth)
// ==========================================
// Prevent ticket spamming from malicious users or bots
const ticketCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 new tickets per window
  message: { success: false, message: "Too many support tickets created. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Prevent flooding a ticket with rapid-fire replies
const replyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 replies per window
  message: { success: false, message: "Too many replies sent. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==========================
// 👤 User Routes (Buyer & Seller)
// ==========================
// Create a new ticket
router.post('/create', protect, ticketCreationLimiter, createTicket);

// Get own tickets
router.get('/my', protect, getMyTickets);

// ==========================
// 👑 Admin Route
// ==========================
// View all tickets across the platform
router.get('/all', protect, authorize('admin'), getAllTickets);

// ==========================
// 🤝 Shared Routes (Admin & Ticket Owner)
// ==========================
// View specific ticket details and conversation
router.get('/:id', protect, getTicketDetails);

// Reply to a ticket
router.post('/:id/reply', protect, replyLimiter, replyToTicket);

// Close a ticket
router.patch('/:id/close', protect, closeTicket);

module.exports = router;