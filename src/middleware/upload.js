const multer = require("multer");
const path = require("path");

// Configure storage for uploaded images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Make sure an 'uploads' folder exists in your root directory
  },
  filename: (req, file, cb) => {
    // Generate a unique filename using the current timestamp
    cb(null, `blog-${Date.now()}${path.extname(file.originalname)}`);
  }
});

// Create the upload middleware
const upload = multer({ storage });

module.exports = upload;