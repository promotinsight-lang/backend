const axios = require('axios');

// ইন-মেমরি ক্যাশ (একই আইপি বারবার চেক করে API লিমিট যেন শেষ না হয়)
const ipCache = new Map(); 

// প্রতি ১ ঘণ্টা পর পর ক্যাশ ক্লিন হবে মেমরি বাঁচাতে
setInterval(() => {
  ipCache.clear();
}, 60 * 60 * 1000);

const blockVPNAndProxy = async (req, res, next) => {
  // লোকালহোস্টে (আপনার পিসিতে) টেস্ট করার সময় এটি চেক স্কিপ করবে
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  try {
    // ইউজারের আইপি বের করা
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (clientIp && clientIp.includes(',')) {
      clientIp = clientIp.split(',')[0].trim();
    }

    // আইপিটি Localhost হলে স্কিপ করবে
    if (clientIp === '::1' || clientIp === '127.0.0.1') {
      return next();
    }

    // ক্যাশ চেক: আইপিটি কি আগেই স্ক্যান করা হয়েছে?
    if (ipCache.has(clientIp)) {
      const isBadIp = ipCache.get(clientIp);
      if (isBadIp) {
        return res.status(403).json({ 
          success: false, 
          message: "Access Denied: VPN, SOCKS5 Proxy, or Tor connection detected. Please use a real residential network." 
        });
      }
      return next(); 
    }

    // 🔥 আপনার API Key দিয়ে Proxycheck কল করা
    const API_KEY = process.env.PROXYCHECK_API_KEY || 'x91h50-h98680-g2g527-rf98n4'; 
    const url = `http://proxycheck.io/v2/${clientIp}?key=${API_KEY}&vpn=1&asn=1`;

    const response = await axios.get(url);
    const data = response.data;

    if (data[clientIp] && data[clientIp].proxy === 'yes') {
      ipCache.set(clientIp, true);
      return res.status(403).json({ 
        success: false, 
        message: "Security Alert: Commercial VPN, SOCKS5, or Proxy network detected. You cannot use this platform with a masked IP." 
      });
    }

    ipCache.set(clientIp, false);
    next();

  } catch (error) {
    console.error("VPN Check Error:", error.message);
    next(); 
  }
};

module.exports = { blockVPNAndProxy };