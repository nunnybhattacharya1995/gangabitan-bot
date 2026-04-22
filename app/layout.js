import './globals.css'

export const metadata = {
  title: 'Ganga Bitan Bot',
  description: 'Ganga Bitan Family Inn WhatsApp Booking Bot'
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
