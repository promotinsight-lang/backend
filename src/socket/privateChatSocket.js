const pool = require('../config/db');
const { getAuthorizedChatSession } = require('../utils/chatAuthorization');

module.exports = (io, socket) => {
  socket.on('join_chat_room', async (sessionId) => {
    try {
      const session = await getAuthorizedChatSession(sessionId, socket.user, {
        requireAssignedAdmin: true,
      });

      if (!session) {
        return socket.emit('chat_error', { message: 'Not authorized for this chat session.' });
      }

      socket.join(`chat_${session.id}`);
      console.log(`User ${socket.user.id} joined room: chat_${session.id}`);
    } catch (error) {
      console.error('SOCKET JOIN CHAT ERROR:', error);
      socket.emit('chat_error', { message: 'Unable to join chat session.' });
    }
  });

  socket.on('send_message', async (data) => {
    const { sessionId, message } = data || {};
    const safeMessage = typeof message === 'string' ? message.trim() : '';

    try {
      if (!safeMessage) {
        return socket.emit('chat_error', { message: 'Message cannot be empty.' });
      }

      const session = await getAuthorizedChatSession(sessionId, socket.user, {
        requireActive: true,
        requireAssignedAdmin: true,
      });

      if (!session) {
        return socket.emit('chat_error', { message: 'Not authorized for this chat session.' });
      }

      const result = await pool.query(
        `INSERT INTO private_chat_messages (session_id, sender_user_id, message)
         VALUES ($1, $2, $3) RETURNING *`,
        [session.id, socket.user.id, safeMessage]
      );

      const userResult = await pool.query(
        'SELECT name, role FROM users WHERE id = $1',
        [socket.user.id]
      );

      const finalMessage = {
        ...result.rows[0],
        sender_name: userResult.rows[0].name,
        sender_role: userResult.rows[0].role,
      };

      io.to(`chat_${session.id}`).emit('receive_message', finalMessage);
    } catch (error) {
      console.error('SOCKET SEND MESSAGE ERROR:', error);
      socket.emit('chat_error', { message: 'Unable to send message.' });
    }
  });

  socket.on('admin_ends_chat_session', async (sessionId) => {
    try {
      const session = await getAuthorizedChatSession(sessionId, socket.user, {
        requireAssignedAdmin: true,
      });

      if (!session || socket.user.role !== 'admin') {
        return socket.emit('chat_error', { message: 'Not authorized to close this chat session.' });
      }

      io.to(`chat_${session.id}`).emit('chat_closed_event', { sessionId: session.id });
    } catch (error) {
      console.error('SOCKET END CHAT ERROR:', error);
    }
  });
};
