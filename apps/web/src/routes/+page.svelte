<script>
  import Button from '@repo/ui/button.svelte'
  import Card from '@repo/ui/card.svelte'
  import Code from '@repo/ui/code.svelte'
</script>

<h1>Welcome to SvelteKit</h1>
<p>Visit <a href="https://svelte.dev/docs/kit">svelte.dev/docs/kit</a> to read the documentation</p>

<div class="flex flex-col gap-4 mt-8">
  <Button appName="Taurus">Click me</Button>

  <Card title="Svelte" href="https://svelte.dev">Cybernetically enhanced web apps</Card>

  <Card title="SvelteKit" href="https://kit.svelte.dev">The fastest way to build Svelte apps</Card>

  <p>
    Install: <Code>npm create svelte@latest</Code>
  </p>
</div>
