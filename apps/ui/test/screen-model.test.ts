import type { ScreenBoard, SpaceBoard } from '@lifedashboard/contracts/board'
import { createRenderer, defineComponent, h, nextTick, ref, useModel, type Ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { screenNamed, useScreenModel } from '../app/board/screen-model'
import type { LoadOutcome } from '../app/board/space-sync'

// The model needs a component instance (useModel), not a DOM: a renderer whose operations do nothing.
const noop = () => {}
const { createApp } = createRenderer({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText: noop,
  setElementText: noop,
  insert: noop,
  remove: noop,
  patchProp: noop,
  parentNode: () => null,
  nextSibling: () => null,
})

function board(spaceId: string, screenIds: string[]): SpaceBoard {
  const screen = (id: string): ScreenBoard => ({ id, rows: 12, instances: [], layout: [] })
  return { spaceId, revision: 1, screens: screenIds.map(screen) }
}

const A = board('space-a', ['a0', 'a1'])
const B = board('space-b', ['b0', 'b1'])
const BOARDS: Record<string, SpaceBoard> = { A, B }

interface Harness {
  parentSpaceId: Ref<string | null>
  parentScreenId: Ref<string | null>
  screenId: Ref<string | null>
  doc: Ref<ScreenBoard | null>
  working: Ref<ScreenBoard | null>
  // Edit mode opens the working copy from the screen the switch returns, as WidgetBoard does.
  switchSpace(target: string, remembered: string | null, outcome?: LoadOutcome): Promise<{ outcome: LoadOutcome; screenId: string | null }>
}

// Mounts a parent that holds the ids (as app.vue does) and a child that holds the model (as WidgetBoard does).
function mount(start: { spaceId: string; screenId: string }): Harness {
  const parentSpaceId = ref<string | null>(start.spaceId)
  const parentScreenId = ref<string | null>(start.screenId)
  let harness!: Omit<Harness, 'parentSpaceId' | 'parentScreenId'>
  const Child = defineComponent({
    props: { spaceId: String, screenId: String },
    emits: ['update:spaceId', 'update:screenId'],
    setup(props) {
      const spaceId = useModel(props, 'spaceId')
      const screenId = useModel(props, 'screenId')
      const space = ref<SpaceBoard | null>(BOARDS[start.spaceId] ?? null)
      const { doc, switchTo } = useScreenModel({ space, spaceId, screenId })
      const working = ref<ScreenBoard | null>(null)
      harness = {
        screenId,
        doc,
        working,
        async switchSpace(target, remembered, outcome = 'loaded') {
          const result = await switchTo(target, remembered, async () => {
            // The GET takes a macrotask.
            await new Promise((done) => setTimeout(done, 0))
            if (outcome === 'loaded') space.value = BOARDS[target] ?? null
            return outcome
          })
          working.value = screenNamed(space.value?.screens ?? [], result.screenId)
          return result
        },
      }
      return () => null
    },
  })
  createApp({
    render: () =>
      h(Child, {
        spaceId: parentSpaceId.value,
        screenId: parentScreenId.value,
        'onUpdate:spaceId': (value: string | null) => (parentSpaceId.value = value),
        'onUpdate:screenId': (value: string | null) => (parentScreenId.value = value),
      }),
  }).mount({})
  return { parentSpaceId, parentScreenId, ...harness }
}

describe('space switch keeps one screen', () => {
  it('opens the remembered second screen of the target, not its first', async () => {
    const h = mount({ spaceId: 'A', screenId: 'a1' })
    const result = await h.switchSpace('B', 'b1')
    await nextTick()
    expect(result).toEqual({ outcome: 'loaded', screenId: 'b1' })
    expect({ screenId: h.parentScreenId.value, doc: h.doc.value?.id, working: h.working.value?.id }).toEqual({
      screenId: 'b1',
      doc: 'b1',
      working: 'b1',
    })
  })

  it('falls back to the first screen of the target when the remembered id is gone', async () => {
    const h = mount({ spaceId: 'A', screenId: 'a1' })
    await h.switchSpace('B', 'gone')
    await nextTick()
    expect({ screenId: h.parentScreenId.value, doc: h.doc.value?.id, working: h.working.value?.id }).toEqual({
      screenId: 'b0',
      doc: 'b0',
      working: 'b0',
    })
  })

  it('keeps the target screen when the switch starts on the first screen', async () => {
    const h = mount({ spaceId: 'A', screenId: 'a0' })
    await h.switchSpace('B', 'b1')
    await nextTick()
    expect({ screenId: h.parentScreenId.value, doc: h.doc.value?.id, working: h.working.value?.id }).toEqual({
      screenId: 'b1',
      doc: 'b1',
      working: 'b1',
    })
  })

  it('leaves the space and screen as they were when the load fails', async () => {
    const h = mount({ spaceId: 'A', screenId: 'a1' })
    const result = await h.switchSpace('B', 'b1', 'unavailable')
    await nextTick()
    expect(result).toEqual({ outcome: 'unavailable', screenId: null })
    expect({ spaceId: h.parentSpaceId.value, screenId: h.parentScreenId.value, doc: h.doc.value?.id }).toEqual({
      spaceId: 'A',
      screenId: 'a1',
      doc: 'a1',
    })
  })
})
