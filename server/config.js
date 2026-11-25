require('dotenv').config();
const prod = process.env.NODE_ENV === 'production';
if (prod && !process.env.JWT_SECRET) throw new Error('JWT_SECRET is required in production');
module.exports = {
  port: +process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  dbFile: process.env.DB_FILE || './data/pulse.db',
  uploadDir: process.env.UPLOAD_DIR || './data/uploads',
  maxUploadMb: +process.env.MAX_UPLOAD_MB || 15,
  authMax: +process.env.AUTH_RATE_LIMIT || 20,   // auth attempts per 15 min per IP
  msgBurst: +process.env.MSG_BURST || 20,         // messages per 10 s per socket
  bcryptRounds: 10,
  ringMs: 30000,                                  // unanswered call -> missed
};
