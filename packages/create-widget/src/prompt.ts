import { createInterface } from 'node:readline/promises'

export async function askTitle(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Promise<string> {
  const rl = createInterface({ input, output })
  try {
    return (await rl.question('Widget title: ')).trim()
  } finally {
    rl.close()
  }
}
