const multer = require("multer");

// Configure memory storage instead of disk storage
// এর ফলে ফাইল লোকাল হার্ডডিস্কে সেভ হবে না, সরাসরি বাফার (Buffer) হিসেবে মেমোরিতে থাকবে
const storage = multer.memoryStorage();

// Create the upload middleware
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // Optional: Max file size set to 5MB
});

module.exports = upload;