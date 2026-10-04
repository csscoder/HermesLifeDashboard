import { readdirSync, readFileSync } from 'node:fs'
import postcss from 'postcss'
import { parse } from 'vue/compiler-sfc'
import { describe, expect, it } from 'vitest'
import { checkClasses } from '../app/theme/vocabulary'

describe('checkClasses', () => {
  it('accepts semantic and layout classes', async () => {
    const classes = [
      'text-primary', 'text-accent', 'text-on-accent', 'text-danger', 'bg-surface-2', 'bg-accent-subtle',
      'bg-success-subtle', 'hover:bg-state-hover', 'border-default', 'focus-visible:ring-focus', 'fill-accent',
      'rounded-card', 'rounded-none', 'font-ui', 'font-mono', 'font-strong', 'shadow-raised', 'text-sm', 'text-3xl',
      'flex', 'grid', 'gap-3', 'p-2', 'w-1/2', 'h-full', 'truncate', 'line-clamp-2', 'tabular-nums', 'z-10',
      '@sm:flex', 'motion-safe:transition', 'aria-selected:bg-state-selected', 'disabled:text-disabled', 'border',
    ]
    expect(await checkClasses(classes)).toEqual({ unknown: [], blocked: [] })
  })

  it('reports palette, opacity-modified and theme-owned classes as unknown', async () => {
    const result = await checkClasses(['text-slate-200', 'bg-zinc-950', 'text-primary/50', 'leading-tight', 'font-sans', 'text-4xl'])
    expect(result).toEqual({
      unknown: ['text-slate-200', 'bg-zinc-950', 'text-primary/50', 'leading-tight', 'font-sans', 'text-4xl'],
      blocked: [],
    })
  })

  it.each([
    ['text-[#f00]', /Arbitrary values/],
    ['bg-(--x)', /Arbitrary values/],
    ['dark:text-primary', /dark: is not allowed/],
    ['!p-2', /Important/],
    ['p-2!', /Important/],
    ['fixed', /fixed is not allowed/],
    ['z-50', /z-index above 10/],
    ['font-600', /font-regular, font-medium or font-strong/],
    ['rounded', /rounded-control/],
    ['rounded-lg', /rounded-control/],
    ['shadow-xl', /shadow-raised/],
  ])('blocks %s with a message', async (cls, message) => {
    const { blocked } = await checkClasses([cls])
    expect(blocked).toHaveLength(1)
    expect(blocked[0]!.message).toMatch(message)
  })
})

type AstNode = {
  props?: { type: number; name: string; value?: { content: string }; arg?: { content?: string }; exp?: { content?: string } }[]
  children?: AstNode[]
}

// Static class values and string literals inside :class (objects, arrays, ternaries).
function collectClasses(node: AstNode, out: string[]) {
  for (const prop of node.props ?? []) {
    if (prop.type === 6 && prop.name === 'class' && prop.value) out.push(...prop.value.content.split(/\s+/).filter(Boolean))
    if (prop.type === 7 && prop.name === 'bind' && prop.arg?.content === 'class' && prop.exp?.content)
      for (const m of prop.exp.content.matchAll(/'([^']*)'|"([^"]*)"/g)) out.push(...(m[1] ?? m[2]!).split(/\s+/).filter(Boolean))
  }
  for (const child of node.children ?? []) collectClasses(child, out)
}

const widgetsDir = new URL('../app/widgets/', import.meta.url)
const widgetFiles = [
  ...readdirSync(new URL('builtin/', widgetsDir))
    .filter((file) => file.endsWith('.vue'))
    .map((file) => `builtin/${file}`),
  'WidgetHost.vue',
]

describe.each(widgetFiles)('%s', (file) => {
  const { descriptor } = parse(readFileSync(new URL(file, widgetsDir), 'utf8'))

  it('uses vocabulary classes only', async () => {
    const classes: string[] = []
    collectClasses(descriptor.template!.ast as unknown as AstNode, classes)
    expect(await checkClasses(classes)).toEqual({ unknown: [], blocked: [] })
  })

  it('keeps scoped styles in @layer ld.widget without !important', () => {
    for (const style of descriptor.styles) {
      expect(style.scoped).toBe(true)
      const root = postcss.parse(style.content)
      for (const node of root.nodes)
        if (node.type !== 'comment') expect(node.type === 'atrule' && node.name === 'layer' && node.params).toBe('ld.widget')
      root.walkDecls((decl) => expect(decl.important).toBe(false))
    }
  })
})
