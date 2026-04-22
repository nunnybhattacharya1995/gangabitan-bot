import { supabase } from '@/lib/supabase'
import { sendMessage } from '@/lib/whatsapp'
import { getAIReply } from '@/lib/openrouter'

function getTimeGreeting() {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'Good Morning'
  if (hour >= 12 && hour < 17) return 'Good Afternoon'
  if (hour >= 17 && hour < 21) return 'Good Evening'
  return 'Good Night'
}

function detectLanguageChoice(text) {
  const t = (text || '').trim().toLowerCase()
  if (t === '1' || t.includes('english')) return 'english'
  if (t === '2' || t.includes('bengali') || t.includes('bangla') || t.includes('বাংলা')) return 'bengali'
  return null
}

function isBookingComplete(text) {
  if (!text) return false
  const t = text.toLowerCase()
  return (
    t.includes('booking request has been received') ||
    t.includes('বুকিং অনুরোধ পাওয়া গেছে') ||
    t.includes('team will contact you')
  )
}

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

export async function POST(req) {
  try {
    const body = await req.json()
    const entry = body?.entry?.[0]
    const change = entry?.changes?.[0]
    const value = change?.value
    const message = value?.messages?.[0]

    if (!message) {
      return new Response('OK', { status: 200 })
    }

    if (message.type !== 'text') {
      return new Response('OK', { status: 200 })
    }

    const phone = message.from
    const text = message.text?.body || ''

    // Check agent mode
    const { data: modeRow } = await supabase
      .from('agent_mode')
      .select('is_human')
      .eq('phone', phone)
      .maybeSingle()

    if (modeRow?.is_human) {
      // Human handling - just save the inbound message
      await supabase.from('conversations').insert({
        phone,
        role: 'user',
        message: text
      })
      return new Response('OK', { status: 200 })
    }

    // Check if guest exists
    let { data: guest } = await supabase
      .from('guests')
      .select('*')
      .eq('phone', phone)
      .maybeSingle()

    if (!guest) {
      // New guest - create record + agent_mode + send greeting + language choice
      const { data: newGuest } = await supabase
        .from('guests')
        .insert({ phone })
        .select()
        .single()
      guest = newGuest

      await supabase
        .from('agent_mode')
        .upsert({ phone, is_human: false, updated_at: new Date().toISOString() })

      const greeting = getTimeGreeting()
      const welcomeMsg = `${greeting}! 🌿\n\nWelcome to *Ganga Bitan Family Inn* — a luxury riverside resort on the Ganges.\n\nPlease choose your preferred language:\n\n*1*. English\n*2*. বাংলা (Bengali)\n\nReply with 1 or 2.`

      await supabase.from('conversations').insert([
        { phone, role: 'user', message: text },
        { phone, role: 'assistant', message: welcomeMsg }
      ])

      await sendMessage(phone, welcomeMsg)
      return new Response('OK', { status: 200 })
    }

    // Save inbound user message
    await supabase.from('conversations').insert({
      phone,
      role: 'user',
      message: text
    })

    // If guest has no language set, try to detect choice
    if (!guest.language) {
      const lang = detectLanguageChoice(text)
      if (lang) {
        await supabase.from('guests').update({ language: lang }).eq('phone', phone)
        guest.language = lang
      } else {
        const reminder = 'Please reply with *1* for English or *2* for বাংলা (Bengali) to continue.'
        await supabase.from('conversations').insert({ phone, role: 'assistant', message: reminder })
        await sendMessage(phone, reminder)
        return new Response('OK', { status: 200 })
      }
    }

    // Fetch last 20 messages as history
    const { data: historyDesc } = await supabase
      .from('conversations')
      .select('role, message')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(20)

    const history = (historyDesc || [])
      .reverse()
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.message }))

    const aiReply = await getAIReply(history, guest.language)

    await supabase.from('conversations').insert({
      phone,
      role: 'assistant',
      message: aiReply
    })

    await sendMessage(phone, aiReply)

    if (isBookingComplete(aiReply)) {
      const owner = process.env.OWNER_WHATSAPP_NUMBER
      if (owner) {
        const notice = `🔔 New booking request received!\n\nGuest phone: +${phone}\nGuest name: ${guest.name || '(not set)'}\n\nPlease check the dashboard for full details.`
        await sendMessage(owner, notice)
      }
    }

    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error('Webhook error:', err?.message || err)
    return new Response('OK', { status: 200 })
  }
}
