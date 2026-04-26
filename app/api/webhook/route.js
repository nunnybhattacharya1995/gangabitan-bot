import { supabase } from '@/lib/supabase'
import { sendMessage } from '@/lib/whatsapp'
import { getAIReply } from '@/lib/openrouter'

export const dynamic = 'force-dynamic'

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

    if (!message) return new Response('OK', { status: 200 })
    if (message.type !== 'text') return new Response('OK', { status: 200 })

    const phone = message.from
    const text = message.text?.body || ''
    const waMessageId = message.id

    // ---- Deduplication: skip if we've already processed this WhatsApp message ID ----
    // (Meta retries the webhook if it doesn't get a fast 200, which causes duplicate replies.)
    if (waMessageId) {
      const { data: existing, error: dupErr } = await supabase
        .from('conversations')
        .select('id')
        .eq('wa_message_id', waMessageId)
        .maybeSingle()
      if (dupErr) console.error('[dedupe lookup error]', dupErr.message)
      if (existing) {
        console.log('[dedupe] skipping already-processed message', waMessageId)
        return new Response('OK', { status: 200 })
      }
    }

    // ---- Check agent mode ----
    const { data: modeRow, error: modeErr } = await supabase
      .from('agent_mode')
      .select('is_human')
      .eq('phone', phone)
      .maybeSingle()
    if (modeErr) console.error('[agent_mode lookup error]', modeErr.message)

    if (modeRow?.is_human) {
      const { error: convErr } = await supabase.from('conversations').insert({
        phone,
        role: 'user',
        message: text,
        wa_message_id: waMessageId
      })
      if (convErr) console.error('[conversations insert error]', convErr.message)
      return new Response('OK', { status: 200 })
    }

    // ---- Get or create guest (upsert handles race conditions) ----
    const { data: upsertedGuest, error: upsertErr } = await supabase
      .from('guests')
      .upsert({ phone }, { onConflict: 'phone', ignoreDuplicates: false })
      .select()
      .single()
    if (upsertErr) console.error('[guests upsert error]', upsertErr.message)

    let guest = upsertedGuest
    if (!guest) {
      // Fallback: re-select
      const { data: refetched } = await supabase
        .from('guests')
        .select('*')
        .eq('phone', phone)
        .maybeSingle()
      guest = refetched
    }

    if (!guest) {
      console.error('[guest unavailable] DB likely missing tables. Run the SQL in lib/supabase.js.')
      return new Response('OK', { status: 200 })
    }

    // Detect "new conversation" by whether language was already set
    const isFirstContact = !guest.language

    // ---- Save inbound user message ----
    const { error: userMsgErr } = await supabase.from('conversations').insert({
      phone,
      role: 'user',
      message: text,
      wa_message_id: waMessageId
    })
    if (userMsgErr) console.error('[user message insert error]', userMsgErr.message)

    // ---- First contact: send welcome + language picker, then return ----
    if (isFirstContact) {
      // Try to detect language from this very first message — saves a round trip
      const detectedLang = detectLanguageChoice(text)
      if (detectedLang) {
        await supabase.from('guests').update({ language: detectedLang }).eq('phone', phone)
        guest.language = detectedLang
        // Fall through to AI reply
      } else {
        await supabase
          .from('agent_mode')
          .upsert({ phone, is_human: false, updated_at: new Date().toISOString() })

        const welcomeMsg = `Welcome to *Ganga Bitan Family Inn* 🌿\nA luxury riverside resort on the Ganges.\n\nPlease choose your preferred language:\n\n*1*. English\n*2*. বাংলা (Bengali)\n\nReply with 1 or 2.`

        await supabase.from('conversations').insert({
          phone,
          role: 'assistant',
          message: welcomeMsg
        })
        await sendMessage(phone, welcomeMsg)
        return new Response('OK', { status: 200 })
      }
    }

    // ---- AI reply ----
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
