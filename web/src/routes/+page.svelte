<svelte:head>
	<title>tasksync</title>
</svelte:head>

<main class="hero">
	<section>
		<h1>tasksync</h1>
		<p>Local-first task manager scaffold. Client runs offline-first; server is a single Axum binary.</p>
		<ul>
			<li>SharedWorker-friendly layout is ready in <code>src/lib</code>.</li>
			<li>Testing hooks: <code>npm run lint</code>, <code>npm run test</code>, <code>npm run check</code>.</li>
			<li>Performance budgets: keep UI work under 16 ms.</li>
		</ul>
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: "Inter", system-ui, -apple-system, sans-serif;
		background: radial-gradient(circle at 10% 20%, #0f172a, #0b1221 40%, #050a1a);
		color: #e2e8f0;
	}

	main.hero {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 3rem 1.5rem;
	}

	section {
		max-width: 720px;
		background: #0b1224;
		border: 1px solid #1f2937;
		border-radius: 16px;
		padding: 32px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
	}

	h1 {
		margin: 0 0 12px;
		font-size: 2.4rem;
		letter-spacing: -0.03em;
	}

	p {
		margin: 0 0 16px;
		color: #cbd5e1;
		line-height: 1.6;
	}

	ul {
		margin: 0;
		padding-left: 20px;
		display: grid;
		gap: 8px;
		color: #dbeafe;
	}

	code {
		padding: 2px 6px;
		border-radius: 6px;
		background: #0f172a;
		color: #bfdbfe;
	}
</style>
