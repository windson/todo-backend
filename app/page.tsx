export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Todo API Server</h1>
      <p>Welcome to the Todo API. Available endpoints:</p>
      <ul>
        <li><a href="/api/doc">API Documentation (JSON)</a></li>
        <li><a href="/api-doc">Swagger UI</a></li>
      </ul>
    </main>
  );
}
