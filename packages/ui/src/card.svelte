<script lang="ts">
  import { clsx, type ClassValue } from 'clsx'
  import { twMerge } from 'tailwind-merge'
  import type { Snippet } from 'svelte'

  let {
    children,
    className,
    title,
    href,
    ...restProps
  }: {
    children: Snippet
    className?: string
    title: string
    href: string
    [key: string]: any
  } = $props()

  function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
  }

  const cardClass = $derived(
    cn(
      'rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:bg-accent/50',
      className
    )
  )
</script>

<a {...restProps} class={cardClass} {href} rel="noopener noreferrer" target="_blank">
  <h2 class="text-xl font-semibold">
    {title} <span class="ml-1">→</span>
  </h2>
  <p class="mt-2 text-sm text-muted-foreground">
    {@render children()}
  </p>
</a>
