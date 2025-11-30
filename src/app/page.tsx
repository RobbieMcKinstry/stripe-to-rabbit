export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Stripe to RabbitMQ Webhook Server</h1>
      <p>This server is running and ready to receive Stripe webhooks.</p>

      <section style={{ marginTop: '2rem' }}>
        <h2>Webhook Endpoint</h2>
        <p>
          <strong>POST</strong> <code>/api/webhooks/stripe</code>
        </p>
        <p>Configure this endpoint in your Stripe dashboard to start receiving webhooks.</p>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Health Check</h2>
        <p>
          <strong>GET</strong> <code>/api/webhooks/stripe</code>
        </p>
        <p>
          <a href="/api/webhooks/stripe">Check endpoint status</a>
        </p>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Documentation</h2>
        <p>See the README.md file for complete setup and usage instructions.</p>
      </section>
    </main>
  );
}
