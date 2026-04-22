/*
Run this SQL in Supabase SQL Editor before starting:

CREATE TABLE guests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  language TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  role TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  guest_name TEXT,
  check_in DATE,
  check_out DATE,
  num_guests INTEGER,
  room_preference TEXT,
  meal_plan TEXT,
  special_requirements TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE agent_mode (
  phone TEXT PRIMARY KEY,
  is_human BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Enable realtime for conversations and agent_mode tables
-- Do this in Supabase Dashboard > Database > Replication
*/

import { createClient } from '@supabase/supabase-js'

let _client = null

function getClient() {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
  }
  return _client
}

export const supabase = new Proxy(
  {},
  {
    get(_, prop) {
      const client = getClient()
      const value = client[prop]
      return typeof value === 'function' ? value.bind(client) : value
    }
  }
)
