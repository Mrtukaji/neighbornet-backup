// Run this script using: node make-dispatcher.js "user@email.com"
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

// Create a Supabase admin client using the SERVICE ROLE KEY (bypasses RLS)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY, // Critical: Must use service key to edit roles directly
    {
        realtime: {
            transport: WebSocket,
        },
    }
);

async function makeDispatcher() {
    const email = process.argv[2];
    
    if (!email) {
        console.log('❌ Error: Please provide an email address.');
        console.log('   Example: node make-dispatcher.js "john@example.com"');
        process.exit(1);
    }
    
    console.log(`🔍 Searching for user with email: ${email}...`);
    
    // First find the user ID for this email
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
    
    // Now update their role
    console.log(`✅ Found user: ${user.name} (Role: ${user.role}). Updating to dispatcher...`);
    
    const { error: updateError } = await supabase
        .from('users')
        .update({ role: 'dispatcher' })
        .eq('id', user.id);
        
    if (updateError) {
        console.error('❌ Failed to update role:', updateError.message);
        process.exit(1);
    }
    
    console.log(`🎉 Success! ${user.name} is now a dispatcher.`);
    console.log(`   They can now log in at /admin to access the dispatcher dashboard!`);
    process.exit(0);
}

makeDispatcher();
