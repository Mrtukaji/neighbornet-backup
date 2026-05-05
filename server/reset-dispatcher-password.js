require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const WebSocket = require('ws');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: WebSocket } }
);

async function resetPassword() {
    const email = 'dispatcher1@gmail.com';
    const newPassword = 'password123';
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    const { data, error } = await supabase
        .from('users')
        .update({ password: hashedPassword })
        .eq('email', email)
        .select();
        
    if (error) {
        console.error("Error setting password:", error.message);
    } else {
        console.log(`Successfully reset password for ${email} to '${newPassword}'`);
    }
}

resetPassword();
