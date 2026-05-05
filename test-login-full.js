require('dotenv').config({ path: 'server/.env' });
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
    const email = 'dispatcher1@gmail.com'.toLowerCase().trim();
    console.log("Looking for:", email);
    
    // Exact copy of the auth logic
    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, role, points, password")
      .eq("email", email)
      .maybeSingle();
      
    if (error) {
        console.error("Supabase Error:", error);
        return;
    }
    
    if (!user) {
        console.log("User is null! Searching by maybeSingle returned nothing.");
        // Let's see what happens if we don't use maybeSingle
        const { data: allUsers } = await supabase.from('users').select('*').eq('email', email);
        console.log("Non-maybeSingle returns:", allUsers?.map(u => u.email));
        return;
    }
    
    console.log("Found user:", user.email, "Password starts with:", user.password?.substring(0, 5));
    
    // Check password
    const isMatch = await bcrypt.compare('password123', user.password);
    console.log("Password matches 'password123'?", isMatch);
    
    // Let's test what password they actually might have used? No way to know.
}
test();
