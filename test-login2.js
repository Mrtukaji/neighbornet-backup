require('dotenv').config({ path: 'server/.env' });
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: WebSocket } }
);

async function test() {
    const email = 'dispatcher1@gmail.com';
    const { data } = await supabase.from('users').select('*').ilike('email', '%dispatcher%');
    console.log("Users found:", data?.map(u => u.email + ` (password: ${u.password})`));
}
test();
