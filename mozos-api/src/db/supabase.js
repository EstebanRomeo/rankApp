const { createClient } = require('@supabase/supabase-js');

// En Node.js con CommonJS usamos process.env (ya inicializado por dotenv en index.js)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Faltan las variables de entorno de Supabase en el Backend");
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = { supabase };