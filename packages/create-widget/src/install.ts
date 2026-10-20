/** Package manager that started the CLI, read from npm_config_user_agent; npm when unknown. */
export function packageManager(userAgent: string | undefined): 'npm' | 'pnpm' | 'yarn' {
  const name = userAgent?.split(' ')[0]?.split('/')[0]
  return name === 'pnpm' || name === 'yarn' ? name : 'npm'
}
