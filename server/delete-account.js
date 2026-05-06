require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

// Create a Supabase admin client using the SERVICE ROLE KEY
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: WebSocket } }
);

async function deleteUserAccount() {
    const email = process.argv[2];
    
    if (!email) {
        console.log('❌ Error: Please provide an email address.');
        console.log('   Example: node delete-account.js "baduser@example.com"');
        process.exit(1);
    }
    
    console.log(`🔍 Searching for user with email: ${email}...`);
    
    // Find the user first to make sure they exist
    const { data: users, error: selectError } = await supabase
        .from('users')
        .select('id, name, role')
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
    console.log(`⚠️  Found user: ${user.name} (Role: ${user.role}).`);
    
    // Delete the user
    // Note: Due to Postgres cascading deletes (if configured) or our isolated schema,
    // this will remove the user entry. 
    const { error: deleteError } = await supabase
        .from('users')
        .delete()
        .eq('id', user.id);
        
    if (deleteError) {
        console.error('❌ Failed to delete account:', deleteError.message);
        process.exit(1);
    }
    
    console.log(`🗑️  Success! The account for ${email} has been permanently deleted from the database.`);
    process.exit(0);
}

deleteUserAccount();
