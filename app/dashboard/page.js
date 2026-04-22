'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

let _supabase = null
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
  }
  return _supabase
}
const supabase = new Proxy(
  {},
  {
    get(_, prop) {
      const c = getSupabase()
      const v = c[prop]
      return typeof v === 'function' ? v.bind(c) : v
    }
  }
)

export const dynamic = 'force-dynamic'

export default function Dashboard() {
  const [guests, setGuests] = useState([])
  const [modes, setModes] = useState({}) // { phone: is_human }
  const [selectedPhone, setSelectedPhone] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef(null)

  // Load guests + agent_modes
  useEffect(() => {
    async function load() {
      const { data: g } = await supabase
        .from('guests')
        .select('*')
        .order('created_at', { ascending: false })
      setGuests(g || [])

      const { data: m } = await supabase.from('agent_mode').select('*')
      const map = {}
      ;(m || []).forEach((row) => {
        map[row.phone] = !!row.is_human
      })
      setModes(map)
    }
    load()

    const guestsChannel = supabase
      .channel('guests-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guests' }, () => load())
      .subscribe()

    const modeChannel = supabase
      .channel('agent-mode-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_mode' }, (payload) => {
        const row = payload.new || payload.old
        if (!row?.phone) return
        setModes((prev) => ({ ...prev, [row.phone]: !!payload.new?.is_human }))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(guestsChannel)
      supabase.removeChannel(modeChannel)
    }
  }, [])

  // Load conversation when guest selected + subscribe to realtime
  useEffect(() => {
    if (!selectedPhone) {
      setMessages([])
      return
    }

    let active = true
    async function loadMessages() {
      const { data } = await supabase
        .from('conversations')
        .select('*')
        .eq('phone', selectedPhone)
        .order('created_at', { ascending: true })
      if (active) setMessages(data || [])
    }
    loadMessages()

    const channel = supabase
      .channel(`conv-${selectedPhone}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversations',
          filter: `phone=eq.${selectedPhone}`
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new])
        }
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [selectedPhone])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const selectedGuest = useMemo(
    () => guests.find((g) => g.phone === selectedPhone),
    [guests, selectedPhone]
  )
  const isHuman = !!modes[selectedPhone]

  async function toggleMode(phone) {
    const next = !modes[phone]
    setModes((prev) => ({ ...prev, [phone]: next })) // optimistic
    await supabase
      .from('agent_mode')
      .upsert({ phone, is_human: next, updated_at: new Date().toISOString() })
  }

  async function sendReply() {
    if (!input.trim() || !selectedPhone) return
    setSending(true)
    const text = input.trim()
    setInput('')
    try {
      await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: selectedPhone, message: text })
      })
      await supabase.from('conversations').insert({
        phone: selectedPhone,
        role: 'assistant',
        message: text
      })
    } catch (e) {
      console.error(e)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="w-80 bg-white border-r overflow-y-auto">
        <div className="p-4 border-b bg-emerald-700 text-white">
          <h1 className="font-bold text-lg">Ganga Bitan</h1>
          <p className="text-xs opacity-80">Owner Dashboard</p>
        </div>
        <ul>
          {guests.length === 0 && (
            <li className="p-4 text-sm text-gray-500">No guests yet.</li>
          )}
          {guests.map((g) => {
            const human = !!modes[g.phone]
            const active = g.phone === selectedPhone
            return (
              <li
                key={g.phone}
                className={`p-3 border-b cursor-pointer hover:bg-gray-50 ${active ? 'bg-emerald-50' : ''}`}
                onClick={() => setSelectedPhone(g.phone)}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{g.name || g.phone}</div>
                    <div className="text-xs text-gray-500">+{g.phone}</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleMode(g.phone)
                    }}
                    className={`text-xs px-2 py-1 rounded ${human ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'}`}
                  >
                    {human ? '👤 Human' : '🤖 Bot'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </aside>

      {/* Chat */}
      <main className="flex-1 flex flex-col">
        {!selectedPhone ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Select a guest to view conversation
          </div>
        ) : (
          <>
            <div className="p-4 bg-white border-b flex items-center justify-between">
              <div>
                <div className="font-semibold">{selectedGuest?.name || selectedPhone}</div>
                <div className="text-xs text-gray-500">+{selectedPhone} · {selectedGuest?.language || 'language not set'}</div>
              </div>
              <button
                onClick={() => toggleMode(selectedPhone)}
                className={`text-xs px-3 py-1.5 rounded ${isHuman ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'}`}
              >
                {isHuman ? '👤 Human Mode' : '🤖 Bot Mode'}
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 bg-[#e5ddd5]">
              {messages.map((m) => {
                const isAssistant = m.role === 'assistant'
                return (
                  <div
                    key={m.id || `${m.created_at}-${m.role}`}
                    className={`flex mb-2 ${isAssistant ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-md px-3 py-2 rounded-lg text-sm whitespace-pre-wrap shadow ${
                        isAssistant ? 'bg-emerald-100' : 'bg-white'
                      }`}
                    >
                      {m.message}
                      <div className="text-[10px] text-gray-500 mt-1">
                        {m.created_at ? new Date(m.created_at).toLocaleString() : ''}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {isHuman ? (
              <div className="p-3 bg-white border-t flex gap-2">
                <input
                  className="flex-1 border rounded px-3 py-2 text-sm focus:outline-none focus:ring focus:ring-emerald-200"
                  placeholder="Type a message..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendReply()
                    }
                  }}
                  disabled={sending}
                />
                <button
                  onClick={sendReply}
                  disabled={sending || !input.trim()}
                  className="px-4 py-2 bg-emerald-600 text-white rounded text-sm disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            ) : (
              <div className="p-3 bg-yellow-50 border-t text-sm text-center text-yellow-800">
                🤖 Bot is handling this conversation. Toggle to Human mode to reply manually.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
