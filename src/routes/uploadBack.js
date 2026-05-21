// src/routes/uploadBack.js
const supabase = require('../utils/supabase');

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function uploadBackRoute(fastify, options) {
  fastify.post('/upload-back/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;

    // 1. Kiểm tra xem phòng còn tồn tại trong Database không
    const { data: session, error: fetchError } = await supabase
      .from('sessions')
      .select('web_files')
      .eq('id', sessionId)
      .single();

    if (fetchError || !session) {
      return reply.code(404).send({ error: 'Phòng chat đã đóng hoặc không tồn tại!' });
    }

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'Không tìm thấy file gửi trả!' });

    let senderName = 'Khách';
    if (request.headers['x-device-name']) {
      senderName = decodeURIComponent(request.headers['x-device-name']);
    }

    // 2. Đẩy file của Web lên Supabase Storage
    const cleanFileName = `web_${Date.now()}_${data.filename}`;
    const cloudPath = `${sessionId}/${cleanFileName}`;
    const fileBuffer = await data.toBuffer();
    
    const { error: storageError } = await supabase.storage
      .from('vhub-storage')
      .upload(cloudPath, fileBuffer, {
        contentType: data.mimetype,
        upsert: true
      });

    if (storageError) {
      return reply.code(500).send({ error: 'Lỗi đẩy file lên Cloud Storage!' });
    }

    const newWebFile = {
      filename: cleanFileName,
      originalName: data.filename,
      size: formatBytes(fileBuffer.length),
      sender: senderName,
      uploadedAt: Date.now()
    };

    // 3. Cập nhật lại lịch sử phòng chat vào PostgreSQL
    const updatedWebFiles = [...session.web_files, newWebFile];
    const { error: updateError } = await supabase
      .from('sessions')
      .update({ web_files: updatedWebFiles })
      .eq('id', sessionId);

    if (updateError) {
      return reply.code(500).send({ error: 'Lỗi cập nhật lịch sử chat!' });
    }

    return {
      success: true,
      fileInfo: newWebFile,
      downloadUrl: `http://192.168.0.102:3000/download/${sessionId}/${encodeURIComponent(cleanFileName)}`
    };
  });
}

module.exports = uploadBackRoute;