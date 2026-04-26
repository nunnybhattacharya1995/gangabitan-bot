CREATE TABLE IF NOT EXISTS guests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  language TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  role TEXT NOT NULL,
  message TEXT NOT NULL,
  wa_message_id TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS conversations_phone_created_idx ON conversations(phone, created_at DESC);

CREATE TABLE IF NOT EXISTS bookings (
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

CREATE TABLE IF NOT EXISTS agent_mode (
  phone TEXT PRIMARY KEY,
  is_human BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Enable Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_mode;
ALTER PUBLICATION supabase_realtime ADD TABLE guests;
