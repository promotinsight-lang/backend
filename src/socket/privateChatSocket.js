const pool = require('../config/db');

module.exports = (io, socket) => {
  // ১. ইউজার বা এডমিন চ্যাট রুমে (Room) জয়েন করলে
  socket.on('join_chat_room', (sessionId) => {
    socket.join(`chat_${sessionId}`);
    console.log(`👤 User ${socket.id} joined room: chat_${sessionId}`);
  });

  // ২. নতুন মেসেজ সেন্ড করলে
  socket.on('send_message', async (data) => {
    const { sessionId, senderId, message } = data;

    try {
      // মেসেজটি ডাটাবেসে সেভ করা হচ্ছে
      const result = await pool.query(
        `INSERT INTO private_chat_messages (session_id, sender_user_id, message) 
         VALUES ($1, $2, $3) RETURNING *`,
        [sessionId, senderId, message]
      );

      // সেন্ডারের নাম ও রোল বের করে মেসেজের সাথে যুক্ত করা
      const userResult = await pool.query(`SELECT name, role FROM users WHERE id = $1`, [senderId]);
      const finalMessage = {
        ...result.rows[0],
        sender_name: userResult.rows[0].name,
        sender_role: userResult.rows[0].role
      };

      // ওই নির্দিষ্ট রুমের (সেশনের) সবাইকে মেসেজটি ব্রডকাস্ট করা হচ্ছে
      io.to(`chat_${sessionId}`).emit('receive_message', finalMessage);
    } catch (error) {
      console.error("SOCKET SEND MESSAGE ERROR:", error);
    }
  });

  // ৩. এডমিন চ্যাট ক্লোজ করে দিলে
  socket.on('admin_ends_chat_session', (sessionId) => {
    io.to(`chat_${sessionId}`).emit('chat_closed_event', { sessionId });
  });
};