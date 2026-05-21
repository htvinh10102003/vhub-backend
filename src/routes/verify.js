// src/routes/verify.js
const supabase = require('../utils/supabase');

async function verifyRoute(fastify, options) {
  
  // API Xác thực: Đọc dữ liệu từ bảng sessions trên Supabase
  fastify.post('/verify', async (request, reply) => {
    const { sessionId, code } = request.body;

    // Truy vấn Database
    const { data: session, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error || !session) {
      return reply.code(404).send({ error: 'Phiên giao dịch không tồn tại hoặc đã bị hệ thống tự động xóa!' });
    }

    // Kiểm tra thời hạn
    if (new Date() > new Date(session.expire_at)) {
      return reply.code(410).send({ error: 'Phiên kết nối này đã hết thời gian hiệu lực!' });
    }

    if (session.verification_code !== code) {
      return reply.code(400).send({ error: 'Mã xác thực không chính xác!' });
    }

    // Đóng gói data trả về chuẩn form cũ để Web Client không bị vỡ giao diện
    const chatRoom = {
      createdAt: new Date(session.created_at).getTime(),
      expireAt: new Date(session.expire_at).getTime(),
      androidFiles: session.android_files,
      webFiles: session.web_files
    };

    return { success: true, chatRoom };
  });

  // API Download: Trỏ thẳng link tải về public url của Supabase Storage
  fastify.get('/download/:sessionId/:filename', async (request, reply) => {
    const { sessionId, filename } = request.params;
    
    // Lấy link public từ Cloud
    const { data } = supabase.storage.from('vhub-storage').getPublicUrl(`${sessionId}/${filename}`);

    if (data && data.publicUrl) {
      // Chuyển hướng người dùng sang link tải của Supabase (Băng thông cực cao)
      return reply.redirect(data.publicUrl);
    }
    
    return reply.code(404).send({ error: 'File không tồn tại trên Cloud!' });
  });
}

module.exports = verifyRoute;