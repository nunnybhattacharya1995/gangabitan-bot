import axios from 'axios'
import { getSystemPrompt } from './systemPrompt'

export async function getAIReply(messages, language) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'anthropic/claude-haiku',
        messages: [
          { role: 'system', content: getSystemPrompt(language) },
          ...messages
        ],
        max_tokens: 500
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://gangabitanfamilyinn.com',
          'X-Title': 'Ganga Bitan Booking Bot'
        }
      }
    )
    return response.data.choices[0].message.content
  } catch (err) {
    console.error('OpenRouter error:', err?.response?.data || err.message)
    return 'Sorry, I am having trouble responding right now. Please try again in a moment.'
  }
}
