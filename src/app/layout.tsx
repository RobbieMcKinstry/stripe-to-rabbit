import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Stripe to RabbitMQ',
  description: 'Stripe webhook handler that publishes events to RabbitMQ',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
