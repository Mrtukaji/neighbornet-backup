require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const WebSocket = require('ws');

// Create a Supabase admin client using the SERVICE ROLE KEY
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: WebSocket } }
);

async function makeAdmin() {
    const email = process.argv[2];
    const newPassword = 'adminpassword123'; // Hardcoded password so we are 100% sure what it is
    
    if (!email) {
        console.log('❌ Error: Please provide an email address.');
        console.log('   Example: node make-admin.js "admin@example.com"');
        process.exit(1);
    }
    
    console.log(`🔍 Searching for user with email: ${email}...`);
    
    // Find the user first
    const { data: users, error: selectError } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .limit(1);
        
    if (selectError) {
        console.error('❌ Database error:', selectError.message);
        process.exit(1);
    }
    
    if (!users || users.length === 0) {
        console.error(`❌ User not found with email: ${email}`);
        process.exit(1);
    }
    
    const user = users[0];
    console.log(`✅ Found user: ${user.name} (Role: ${user.role}). Updating to admin...`);
    
    // Hash the known password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update role and password
    const { error: updateError } = await supabase
        .from('users')
        .update({ 
            role: 'admin',
            password: hashedPassword
        })
        .eq('id', user.id);
        
    if (updateError) {
        console.error('❌ Failed to update role and password:', updateError.message);
        process.exit(1);
    }
    
    console.log(`🎉 Success! ${user.name} is now an ADMIn.`);
    console.log(`   You can now log in at /auth (it will redirect to /admin) using:`);
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${newPassword}`);
    process.exit(0);
}

makeAdmin();
