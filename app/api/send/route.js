import { sendMessage } from '@/lib/whatsapp'

export async function POST(req) {
  try {
    const { phone, message } = await req.json()
    await sendMessage(phone, message)
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}
