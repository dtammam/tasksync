<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import Sidebar from '$lib/components/Sidebar.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>tasksync</title>
</svelte:head>

<div class="app-shell">
	<Sidebar />
	<main>{@render children()}</main>
</div>

<style>
	:global(body) {
		margin: 0;
		background: radial-gradient(circle at 10% 20%, #0f172a, #0b1221 40%, #050a1a);
		color: #e2e8f0;
		font-family: 'Inter', system-ui, -apple-system, sans-serif;
	}

	.app-shell {
		display: grid;
		grid-template-columns: 240px 1fr;
		min-height: 100vh;
	}

	main {
		padding: 28px 32px;
	}
</style>
