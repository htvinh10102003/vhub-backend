// src/routes/upload.js
const { v4: uuidv4 } = require('uuid');
const supabase = require('../utils/supabase');

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function uploadRoute(fastify, options) {
  fastify.post('/upload', async (request, reply) => {
    const sessionId = `VH-${uuidv4().split('-')[0].toUpperCase()}`;
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    const androidFiles = [];
    let expiresInMinutes = 60;
    let userId = null;

    const parts = request.parts();
    for await (const part of parts) {
      if (part.file) {
        // Hứng toàn bộ dữ liệu file vào bộ nhớ đệm (Buffer)
        const fileBuffer = await part.toBuffer();
        const fileSize = fileBuffer.length;
        
        // Tạo đường dẫn phân tách thư mục theo cấu trúc: sessionId/filename trên Cloud
        const cloudPath = `${sessionId}/${part.filename}`;

        // 1. ĐẨY FILE LÊN SUPABASE STORAGE BUCKET
        const { error: storageError } = await supabase.storage
          .from('vhub-storage')
          .upload(cloudPath, fileBuffer, {
            contentType: part.mimetype,
            upsert: true
          });

        if (storageError) {
          fastify.log.error(storageError);
          return reply.code(500).send({ error: 'Không thể đẩy dữ liệu lên Cloud Storage!' });
        }

        androidFiles.push({
          filename: part.filename,
          size: formatBytes(fileSize)
        });
      } else {
        console.log("BACKEND NHẬN FIELD:", part.fieldname, " GIÁ TRỊ:", part.value);
        if (part.fieldname === 'expiresIn') {
          expiresInMinutes = parseInt(part.value) || 60;
        }
        if (part.fieldname === 'userId') {
          userId = part.value;
        }
      }
    }

    if (androidFiles.length === 0) {
      return reply.code(400).send({ error: 'Danh sách tệp tin tải lên trống!' });
    }

    const expireAt = new Date(Date.now() + (expiresInMinutes * 60 * 1000)).toISOString();

    // 2. LƯU THÔNG TIN PHÒNG CHAT VÀO DATABASE POSTGRESQL
    const { error: dbError } = await supabase
      .from('sessions')
      .insert([
        { 
          id: sessionId, 
          verification_code: verificationCode, 
          expire_at: expireAt, 
          android_files: androidFiles,
          user_id: "09b2ee7d-54ba-400b-a888-74458eb48871",
          web_files: []
        }
      ]);

    if (dbError) {
      console.error("LỖI SUPABASE INSERT:", dbError);
      fastify.log.error(dbError);
      return reply.code(500).send({ error: 'Lỗi khởi tạo phiên dữ liệu hệ thống!' });
    }

    return {
      sessionId,
      verificationCode,
      expireAt,
      files: androidFiles,
      // URL này lát nữa Next.js được deploy lên Vercel sẽ nhận diện
      downloadUrl: `https://vinhstudio.site/s/${sessionId}` 
    };
  });
}

module.exports = uploadRoute;