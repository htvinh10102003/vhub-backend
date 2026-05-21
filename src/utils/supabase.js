// src/utils/supabase.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Thiếu cấu hình điều hướng SUPABASE_URL hoặc SUPABASE_KEY trong file .env!");
}

const supabase = createClient(supabaseUrl, supabaseKey);
module.exports = supabase;