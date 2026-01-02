<script lang="ts">
  import { clsx, type ClassValue } from 'clsx'
  import { twMerge } from 'tailwind-merge'
  import type { Snippet } from 'svelte'

  let {
    children,
    className,
    ...restProps
  }: {
    children: Snippet
    className?: string
    [key: string]: any
  } = $props()

  function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
  }

  $: codeClass = cn(
    'relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold',
    className
  )
</script>

<code {...restProps} class={codeClass}>
  {@render children()}
</code>
