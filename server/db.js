const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

// Supabase client with WebSocket transport for real-time support in Node.js
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
        realtime: {
            transport: WebSocket,
        },
    }
);

console.log('✅ Supabase client initialized');

module.exports = { supabase };