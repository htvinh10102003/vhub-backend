// src/index.js
const Fastify = require('fastify');
const multipart = require('@fastify/multipart');
const cors = require('@fastify/cors');
const socketIo = require('socket.io');
const supabase = require('./utils/supabase'); // MỚI: Import ống kết nối Supabase
require('dotenv').config();

const fastify = Fastify({ logger: true });

fastify.register(cors, { origin: '*' });

fastify.register(multipart, {
  limits: { fileSize: 100 * 1024 * 1024 } // Giới hạn 100MB cho thoải mái
});

fastify.register(require('./routes/upload'));
fastify.register(require('./routes/verify'));
fastify.register(require('./routes/uploadBack')); 
fastify.get('/ping', async (request, reply) => {
  return { status: 'Server vẫn đang thức nha!', time: new Date().toISOString() };
});

const start = async () => {
  try {
    await fastify.ready();
    const io = socketIo(fastify.server, { cors: { origin: "*" } });

    io.on('connection', (socket) => {
      fastify.log.info(`Kết nối socket mới: ${socket.id}`);
      
      socket.on('join-session', (data) => {
        const room = data.sessionId || data;
        const name = data.deviceName || 'Khách Web';
        socket.join(room);
        socket.to(room).emit('device-connected', { deviceName: name });
      });

      socket.on('file-uploaded-back', (data) => {
        socket.to(data.sessionId).emit('incoming-file', {
          filename: data.fileInfo.originalName,
          size: data.fileInfo.size,
          sender: data.fileInfo.sender,
          downloadUrl: data.downloadUrl
        });
      });
    });

    // BỘ DỌN DẸP CHẠY NGẦM TRÊN CLOUD (QUÉT MỖI 60 GIÂY)
    setInterval(async () => {
      const now = new Date().toISOString();
      console.log(`[Hệ thống Cloud] Đang quét các phiên hết hạn lúc: ${new Date().toLocaleTimeString()}`);

      try {
        // 1. Tìm các phiên có thời gian expire_at nhỏ hơn thời gian hiện tại
        const { data: expiredSessions, error: fetchError } = await supabase
          .from('sessions')
          .select('*')
          .lt('expire_at', now);

        if (fetchError) {
          console.error('Lỗi khi quét phiên hết hạn từ Database:', fetchError);
          return;
        }

        if (!expiredSessions || expiredSessions.length === 0) {
          console.log(' -> Không có phiên nào hết hạn.');
          return;
        }

        // Đống phòng hết hạn cần dọn dẹp
        for (const session of expiredSessions) {
          console.log(`🔥 Phát hiện phiên quá hạn: ${session.id}. Tiến hành hủy bỏ...`);

          // 2. Gom toàn bộ danh sách đường dẫn file cần xóa trên Supabase Storage (cấu hình: sessionId/filename)
          const filesToDelete = [];
          
          if (session.android_files && Array.isArray(session.android_files)) {
            session.android_files.forEach(f => {
              filesToDelete.push(`${session.id}/${f.filename}`);
            });
          }
          
          if (session.web_files && Array.isArray(session.web_files)) {
            session.web_files.forEach(f => {
              // file của web lưu tên gốc hoặc tên clean tùy cấu hình ở route uploadBack
              filesToDelete.push(`${session.id}/${f.filename}`);
            });
          }

          // 3. Tiến hành xóa tệp vật lý trên Cloud Storage Bucket
          if (filesToDelete.length > 0) {
            const { error: storageError } = await supabase.storage
              .from('vhub-storage')
              .remove(filesToDelete);

            if (storageError) {
              console.error(` -> Lỗi xóa tệp trong Storage của phiên ${session.id}:`, storageError);
            } else {
              console.log(` -> Đã xóa sạch ${filesToDelete.length} tệp trên Cloud Storage.`);
            }
          }

          // 4. Xóa hàng nhật ký phòng chat trong bảng sessions của Postgres
          const { error: dbError } = await supabase
            .from('sessions')
            .delete()
            .eq('id', session.id);

          if (dbError) {
            console.error(` -> Lỗi xóa hàng dữ liệu của phiên ${session.id}:`, dbError);
          } else {
            console.log(`✨ [Hoàn tất] Đã xóa hoàn toàn dữ liệu phòng ${session.id} khỏi Cloud!`);
          }
        }
      } catch (err) {
        console.error('Lỗi hệ thống bất ngờ trong bộ dọn dẹp chạy ngầm:', err);
      }
    }, 60 * 1000); // 1 phút quét một lần

    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();