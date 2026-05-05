require('dotenv').config({ path: 'server/.env' });
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
    const email = 'dispatcher1@gmail.com';
    const password = 'password123'; // Guessing common password or we will just check if user exists

    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .maybeSingle();

    if (error) console.error("Error:", error);
    if (!user) console.log("User not found!");
    else {
        console.log("Found user:", user.name, "Role:", user.role, "Email:", user.email);
        console.log("Has password field?", !!user.password);
    }
}
test();
